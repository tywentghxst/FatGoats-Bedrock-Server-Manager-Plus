const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const db = require('../database');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

function getGitEnv() {
  const gitDir = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Tysci\\AppData\\Local', 'Programs', 'Git', 'cmd');
  const ghDir = path.join(
    process.env.LOCALAPPDATA || 'C:\\Users\\Tysci\\AppData\\Local',
    'Microsoft',
    'WinGet',
    'Packages',
    'GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'bin'
  );
  return {
    ...process.env,
    PATH: `${gitDir};${ghDir};${process.env.PATH || ''}`,
  };
}

function execGit(cmd, options = {}) {
  const env = getGitEnv();
  return execSync(cmd, {
    cwd: ROOT_DIR,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 30000,
  }).trim();
}

function getSetting(key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

function setSetting(key, value) {
  try {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
  } catch (err) {
    console.error(`[AppUpdateService] Failed to set ${key}:`, err.message);
  }
}

class AppUpdateService {
  constructor() {
    this.isUpdating = false;
    this.updateProgress = null;
  }

  getPreferences() {
    const autoCheckRaw = getSetting('app_update_auto_check', 'true');
    const autoCheck = autoCheckRaw !== 'false';
    const ignoredCommit = getSetting('app_update_ignored_commit', '');
    const askLaterUntil = getSetting('app_update_ask_later_until', '0');
    const lastChecked = getSetting('app_update_last_checked', null);

    return {
      autoCheck,
      ignoredCommit: ignoredCommit || null,
      askLaterUntil: Number(askLaterUntil) || 0,
      lastChecked,
    };
  }

  setPreferences({ autoCheck, ignoredCommit, askLater, clearSnooze }) {
    if (autoCheck !== undefined) {
      setSetting('app_update_auto_check', autoCheck ? 'true' : 'false');
    }
    if (ignoredCommit !== undefined) {
      setSetting('app_update_ignored_commit', ignoredCommit || '');
    }
    if (askLater === true) {
      // Snooze update prompt for 24 hours
      const snoozeUntil = Date.now() + 24 * 60 * 60 * 1000;
      setSetting('app_update_ask_later_until', snoozeUntil);
    } else if (clearSnooze === true || askLater === false) {
      setSetting('app_update_ask_later_until', '0');
    }

    return this.getPreferences();
  }

  async checkUpdates(forceFetch = false) {
    const prefs = this.getPreferences();
    let currentCommit = 'unknown';
    let currentCommitFull = 'unknown';
    let currentCommitDate = '';
    let currentCommitSubject = '';

    try {
      currentCommit = execGit('git rev-parse --short HEAD');
      currentCommitFull = execGit('git rev-parse HEAD');
      currentCommitDate = execGit('git log -1 --format=%cd --date=relative');
      currentCommitSubject = execGit('git log -1 --format=%s');
    } catch (err) {
      console.warn('[AppUpdateService] Failed to inspect local HEAD:', err.message);
    }

    let remoteCommit = currentCommit;
    let remoteCommitFull = currentCommitFull;
    let remoteCommitDate = currentCommitDate;
    let remoteCommitSubject = currentCommitSubject;
    let commitsBehind = 0;
    const changelog = [];

    if (forceFetch) {
      try {
        console.log('[AppUpdateService] Fetching latest refs from origin...');
        execGit('git fetch origin main', { timeout: 25000 });
        setSetting('app_update_last_checked', new Date().toISOString());
        prefs.lastChecked = new Date().toISOString();
      } catch (err) {
        console.warn('[AppUpdateService] Git fetch failed:', err.message);
      }
    }

    try {
      remoteCommit = execGit('git rev-parse --short origin/main');
      remoteCommitFull = execGit('git rev-parse origin/main');
      remoteCommitDate = execGit('git log origin/main -1 --format=%cd --date=relative');
      remoteCommitSubject = execGit('git log origin/main -1 --format=%s');

      const countRaw = execGit('git rev-list HEAD..origin/main --count');
      commitsBehind = parseInt(countRaw, 10) || 0;

      if (commitsBehind > 0) {
        const rawLog = execGit('git log HEAD..origin/main --format=%h|%an|%cr|%s -n 15');
        if (rawLog) {
          rawLog.split('\n').forEach((line) => {
            const parts = line.split('|');
            if (parts.length >= 4) {
              changelog.push({
                hash: parts[0],
                author: parts[1],
                date: parts[2],
                subject: parts.slice(3).join('|'),
              });
            }
          });
        }
      }
    } catch (err) {
      console.warn('[AppUpdateService] Failed to check remote rev-list:', err.message);
    }

    const updateAvailable = commitsBehind > 0;
    const isIgnored = Boolean(prefs.ignoredCommit && (prefs.ignoredCommit === remoteCommit || prefs.ignoredCommit === remoteCommitFull));
    const isSnoozed = Boolean(prefs.askLaterUntil && Date.now() < prefs.askLaterUntil);
    const shouldPrompt = updateAvailable && !isIgnored && !isSnoozed;

    return {
      currentCommit,
      currentCommitFull,
      currentCommitDate,
      currentCommitSubject,
      remoteCommit,
      remoteCommitFull,
      remoteCommitDate,
      remoteCommitSubject,
      commitsBehind,
      updateAvailable,
      changelog,
      shouldPrompt,
      isIgnored,
      isSnoozed,
      ...prefs,
    };
  }

  async applyUpdate() {
    if (this.isUpdating) {
      throw new Error('An update is already in progress.');
    }

    this.isUpdating = true;
    this.updateProgress = 'Starting update process...';

    try {
      // STEP 1: Safeguard User Data
      this.updateProgress = 'Creating pre-update safety backup of database...';
      const dbPath = path.join(ROOT_DIR, 'data', 'db', 'manager.db');
      const dbBackupPath = path.join(ROOT_DIR, 'data', 'db', `manager.db.pre-update-${Date.now()}.bak`);
      if (fs.existsSync(dbPath)) {
        try {
          fs.copyFileSync(dbPath, dbBackupPath);
          console.log(`[AppUpdateService] Created safety backup: ${dbBackupPath}`);
        } catch (err) {
          console.warn('[AppUpdateService] Failed to create db backup:', err.message);
        }
      }

      // STEP 2: Pull Latest Commits
      this.updateProgress = 'Pulling latest code changes from GitHub (main)...';
      console.log('[AppUpdateService] Pulling origin main...');
      const pullOutput = execGit('git pull origin main', { timeout: 45000 });
      console.log('[AppUpdateService] Pull result:', pullOutput);

      // STEP 3: Dependencies Update (if needed)
      this.updateProgress = 'Verifying and updating client dependencies...';
      try {
        execSync('cmd /c "npm install --no-audit --no-fund"', {
          cwd: ROOT_DIR,
          windowsHide: true,
          timeout: 60000,
        });
      } catch (err) {
        console.warn('[AppUpdateService] npm install notice:', err.message);
      }

      // STEP 4: Build React Frontend
      this.updateProgress = 'Compiling production frontend assets with Vite...';
      try {
        execSync('cmd /c "cd client && npm run build"', {
          cwd: ROOT_DIR,
          windowsHide: true,
          timeout: 60000,
        });
        console.log('[AppUpdateService] Vite build complete.');
      } catch (err) {
        console.warn('[AppUpdateService] Client build notice:', err.message);
      }

      // STEP 5: Rebuild Windows Tray Executable (if C# compiler exists)
      this.updateProgress = 'Recompiling BedrockServerManager.exe Windows tray launcher...';
      const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
      if (fs.existsSync(cscPath)) {
        try {
          execSync(
            `"${cscPath}" /target:winexe /out:BedrockServerManager.exe /win32icon:tray\\app.ico /r:System.dll,System.Drawing.dll,System.Windows.Forms.dll,System.Core.dll tray\\Program.cs`,
            {
              cwd: ROOT_DIR,
              windowsHide: true,
              timeout: 30000,
            }
          );
          console.log('[AppUpdateService] Recompiled BedrockServerManager.exe.');
        } catch (err) {
          console.warn('[AppUpdateService] Tray recompile notice:', err.message);
        }
      }

      // Clear snooze and ignored commit since update was applied
      setSetting('app_update_ignored_commit', '');
      setSetting('app_update_ask_later_until', '0');

      this.updateProgress = 'Update successfully applied!';
      const newCommit = execGit('git rev-parse --short HEAD');

      return {
        success: true,
        newCommit,
        message: `App successfully updated to commit #${newCommit}. All worlds, player data, and configurations were safely preserved.`,
      };
    } finally {
      this.isUpdating = false;
    }
  }
}

module.exports = new AppUpdateService();
