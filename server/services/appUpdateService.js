const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const unzipper = require('unzipper');
const db = require('../database');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const GITHUB_REPO = 'tywentghxst/FatGoats-Bedrock-Server-Manager-Plus';
const GITHUB_BRANCH = 'main';

/**
 * Locate any installed Git binaries on Windows or in system PATH.
 */
function getGitPaths() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd'),
    path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Programs', 'Git', 'cmd'),
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files (x86)\\Git\\cmd',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin'),
    'C:\\Program Files\\Git\\bin',
  ];

  const foundDirs = candidates.filter((dir) => {
    try {
      return fs.existsSync(path.join(dir, 'git.exe'));
    } catch (_) {
      return false;
    }
  });

  return foundDirs;
}

function getGitEnv() {
  const foundDirs = getGitPaths();
  const pathPrefix = foundDirs.join(';');
  return {
    ...process.env,
    PATH: pathPrefix ? `${pathPrefix};${process.env.PATH || ''}` : process.env.PATH || '',
  };
}

function hasGit() {
  try {
    const env = getGitEnv();
    execSync('git --version', { env, windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function hasGitRepo() {
  return fs.existsSync(path.join(ROOT_DIR, '.git'));
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

/**
 * Handle Windows file locks on running executables (e.g. BedrockServerManager.exe).
 * On NTFS, a running executable cannot be overwritten or deleted, but it CAN be renamed.
 * Renaming the locked file allows the new file to be created in its original path.
 */
function prepareLockedFileForReplacement(filePath) {
  if (!fs.existsSync(filePath)) return true;
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return true; // Not locked
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      const backupPath = `${filePath}.old`;
      try {
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
          } catch (_) {
            fs.renameSync(backupPath, `${filePath}.old-${Date.now()}`);
          }
        }
        fs.renameSync(filePath, backupPath);
        console.log(`[AppUpdateService] Renamed busy file ${path.basename(filePath)} -> ${path.basename(backupPath)} to allow replacement.`);
        return true;
      } catch (renameErr) {
        console.warn(`[AppUpdateService] Could not rename busy file ${path.basename(filePath)}:`, renameErr.message);
        return false;
      }
    }
    return false;
  }
}

function safeWriteFile(targetFilePath, buffer) {
  try {
    fs.writeFileSync(targetFilePath, buffer);
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      const backupPath = `${targetFilePath}.old`;
      try {
        if (fs.existsSync(backupPath)) {
          try {
            fs.unlinkSync(backupPath);
          } catch (_) {
            fs.renameSync(backupPath, `${targetFilePath}.old-${Date.now()}`);
          }
        }
        fs.renameSync(targetFilePath, backupPath);
        fs.writeFileSync(targetFilePath, buffer);
        console.log(`[AppUpdateService] Renamed busy file and wrote new: ${path.basename(targetFilePath)}`);
      } catch (retryErr) {
        console.warn(`[AppUpdateService] Could not write busy file ${path.basename(targetFilePath)}, saving to .new:`, retryErr.message);
        try {
          fs.writeFileSync(`${targetFilePath}.new`, buffer);
        } catch (_) {}
      }
    } else {
      throw err;
    }
  }
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
    this.updatePercent = 0;
    this.updateStage = 0;
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

  /**
   * Determine the current local version from version.json, git HEAD, or SQLite DB.
   */
  getCurrentVersion() {
    // 1. Try reading ROOT_DIR/version.json
    try {
      const vPath = path.join(ROOT_DIR, 'version.json');
      if (fs.existsSync(vPath)) {
        const data = JSON.parse(fs.readFileSync(vPath, 'utf8'));
        if (data && data.commit) {
          return {
            commit: data.commit.slice(0, 7),
            commitFull: data.commitFull || data.commit,
            date: data.date || '',
            subject: data.subject || '',
          };
        }
      }
    } catch (_) {}

    // 2. Try git rev-parse HEAD if .git is available
    if (hasGitRepo() && hasGit()) {
      try {
        const commit = execGit('git rev-parse --short HEAD');
        const commitFull = execGit('git rev-parse HEAD');
        const date = execGit('git log -1 --format=%cd --date=relative');
        const subject = execGit('git log -1 --format=%s');
        return { commit, commitFull, date, subject };
      } catch (_) {}
    }

    // 3. Try reading from SQLite settings table
    const dbCommit = getSetting('app_current_commit', null);
    if (dbCommit) {
      return {
        commit: dbCommit.slice(0, 7),
        commitFull: dbCommit,
        date: getSetting('app_current_commit_date', ''),
        subject: getSetting('app_current_commit_subject', ''),
      };
    }

    return {
      commit: 'unknown',
      commitFull: 'unknown',
      date: '',
      subject: '',
    };
  }

  /**
   * Save version metadata to version.json and database settings.
   */
  saveCurrentVersion(commitInfo) {
    try {
      const vPath = path.join(ROOT_DIR, 'version.json');
      fs.writeFileSync(vPath, JSON.stringify(commitInfo, null, 2), 'utf8');
    } catch (err) {
      console.warn('[AppUpdateService] Failed to write version.json:', err.message);
    }

    if (commitInfo.commitFull || commitInfo.commit) {
      setSetting('app_current_commit', commitInfo.commitFull || commitInfo.commit);
      if (commitInfo.date) setSetting('app_current_commit_date', commitInfo.date);
      if (commitInfo.subject) setSetting('app_current_commit_subject', commitInfo.subject);
    }
  }

  /**
   * Fetch latest commits directly from the GitHub REST API.
   */
  async fetchGitHubCommits() {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/commits?per_page=30&sha=${GITHUB_BRANCH}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'BedrockServerManager-AppUpdate',
        Accept: 'application/vnd.github.v3+json',
      },
      timeout: 12000,
    });

    if (!res.ok) {
      throw new Error(`GitHub API HTTP ${res.status}: ${res.statusText}`);
    }

    const commits = await res.json();
    if (!Array.isArray(commits) || commits.length === 0) {
      throw new Error('Invalid response from GitHub commits API');
    }

    return commits;
  }

  /**
   * Check for updates using GitHub REST API first, falling back to Git CLI.
   */
  async checkUpdates(forceFetch = false) {
    const prefs = this.getPreferences();
    const current = this.getCurrentVersion();

    let remoteCommit = current.commit;
    let remoteCommitFull = current.commitFull;
    let remoteCommitDate = current.date;
    let remoteCommitSubject = current.subject;
    let commitsBehind = 0;
    const changelog = [];
    let gitHubApiSucceeded = false;

    // METHOD 1: Direct GitHub REST API query (works without git.exe or .git directory)
    try {
      const commits = await this.fetchGitHubCommits();
      if (commits && commits.length > 0) {
        gitHubApiSucceeded = true;
        const latest = commits[0];
        remoteCommit = latest.sha.slice(0, 7);
        remoteCommitFull = latest.sha;
        remoteCommitDate = latest.commit?.author?.date
          ? new Date(latest.commit.author.date).toLocaleString()
          : '';
        remoteCommitSubject = latest.commit?.message?.split('\n')[0] || '';

        // Compare current commit with remote
        const isExactMatch =
          current.commitFull &&
          current.commitFull !== 'unknown' &&
          (latest.sha === current.commitFull || latest.sha.startsWith(current.commit));

        if (isExactMatch) {
          commitsBehind = 0;
        } else {
          // Look for local commit in the remote history list
          const localIndex = commits.findIndex(
            (c) =>
              c.sha === current.commitFull ||
              (current.commit !== 'unknown' && c.sha.startsWith(current.commit))
          );

          if (localIndex > 0) {
            commitsBehind = localIndex;
            for (let i = 0; i < Math.min(localIndex, 15); i++) {
              const c = commits[i];
              changelog.push({
                hash: c.sha.slice(0, 7),
                author: c.commit?.author?.name || 'Developer',
                date: c.commit?.author?.date
                  ? new Date(c.commit.author.date).toLocaleDateString()
                  : '',
                subject: c.commit?.message?.split('\n')[0] || '',
              });
            }
          } else {
            // Local commit is older than the last 30 commits or 'unknown'
            commitsBehind = Math.max(1, commits.length);
            for (let i = 0; i < Math.min(commits.length, 10); i++) {
              const c = commits[i];
              changelog.push({
                hash: c.sha.slice(0, 7),
                author: c.commit?.author?.name || 'Developer',
                date: c.commit?.author?.date
                  ? new Date(c.commit.author.date).toLocaleDateString()
                  : '',
                subject: c.commit?.message?.split('\n')[0] || '',
              });
            }
          }
        }

        const nowIso = new Date().toISOString();
        setSetting('app_update_last_checked', nowIso);
        prefs.lastChecked = nowIso;
      }
    } catch (apiErr) {
      console.warn('[AppUpdateService] GitHub API check error:', apiErr.message);
    }

    // METHOD 2: Fallback to Git CLI (if .git folder and git binary exist)
    if (!gitHubApiSucceeded && hasGitRepo() && hasGit()) {
      try {
        if (forceFetch) {
          console.log('[AppUpdateService] Running git fetch origin...');
          execGit('git fetch origin', { timeout: 25000 });
          const nowIso = new Date().toISOString();
          setSetting('app_update_last_checked', nowIso);
          prefs.lastChecked = nowIso;
        }

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
      } catch (gitErr) {
        console.warn('[AppUpdateService] Git CLI check fallback error:', gitErr.message);
      }
    }

    const updateAvailable = commitsBehind > 0;
    const isIgnored = Boolean(
      prefs.ignoredCommit &&
        (prefs.ignoredCommit === remoteCommit || prefs.ignoredCommit === remoteCommitFull)
    );
    const isSnoozed = Boolean(prefs.askLaterUntil && Date.now() < prefs.askLaterUntil);
    const shouldPrompt = updateAvailable && !isIgnored && !isSnoozed;

    return {
      currentCommit: current.commit,
      currentCommitFull: current.commitFull,
      currentCommitDate: current.date,
      currentCommitSubject: current.subject,
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

  /**
   * Universal Update Application:
   * Mode A: Uses Git pull / reset if .git repository exists.
   * Mode B: Downloads latest repository ZIP directly from GitHub, safely extracts over ROOT_DIR,
   *         while completely preserving all user data, database, worlds, and custom configs.
   */
  async applyUpdate() {
    if (this.isUpdating) {
      throw new Error('An update is already in progress.');
    }

    this.isUpdating = true;
    this.updateProgress = 'Starting update process...';
    this.updatePercent = 5;
    this.updateStage = 1;

    try {
      // ------------------------------------------------------------------------
      // STEP 1: Safeguard User Data & Database
      // ------------------------------------------------------------------------
      this.updatePercent = 15;
      this.updateStage = 1;
      this.updateProgress = 'Creating pre-update safety backup of database and user data...';
      const dbPath = path.join(ROOT_DIR, 'data', 'db', 'manager.db');
      const dbBackupPath = path.join(
        ROOT_DIR,
        'data',
        'db',
        `manager.db.pre-update-${Date.now()}.bak`
      );
      if (fs.existsSync(dbPath)) {
        try {
          fs.copyFileSync(dbPath, dbBackupPath);
          console.log(`[AppUpdateService] Created safety backup: ${dbBackupPath}`);
        } catch (err) {
          console.warn('[AppUpdateService] Failed to create db backup:', err.message);
        }
      }

      let newCommitInfo = null;
      let usedGit = false;

      // ------------------------------------------------------------------------
      // STEP 2: Fetch and Apply Latest Code Changes
      // ------------------------------------------------------------------------
      this.updatePercent = 35;
      this.updateStage = 2;
      this.updateProgress = 'Pulling latest code changes from GitHub (main)...';

      // Unlock running Windows binaries out of the way so Git or Zip can write new ones cleanly
      prepareLockedFileForReplacement(path.join(ROOT_DIR, 'BedrockServerManager.exe'));
      prepareLockedFileForReplacement(path.join(ROOT_DIR, 'BedrockServerManager-Setup.exe'));

      if (hasGitRepo() && hasGit()) {
        try {
          console.log('[AppUpdateService] Attempting Git pull from origin...');
          execGit('git fetch origin', { timeout: 35000 });
          // Wipe unstaged changes in tracked files to prevent merge conflicts
          try {
            execGit('git reset --hard origin/main', { timeout: 15000 });
          } catch (_) {
            execGit('git pull --rebase=false origin main', { timeout: 35000 });
          }
          usedGit = true;
          const shortHash = execGit('git rev-parse --short HEAD');
          const fullHash = execGit('git rev-parse HEAD');
          const date = execGit('git log -1 --format=%cd --date=relative');
          const subject = execGit('git log -1 --format=%s');
          newCommitInfo = {
            commit: shortHash,
            commitFull: fullHash,
            date,
            subject,
          };
          console.log(`[AppUpdateService] Git sync complete: #${shortHash}`);
        } catch (gitErr) {
          console.warn(
            '[AppUpdateService] Git pull failed, falling back to direct GitHub download:',
            gitErr.message
          );
        }
      }

      // If Git was not used or failed, download and extract main.zip directly
      if (!usedGit) {
        console.log('[AppUpdateService] Downloading latest repository archive from GitHub...');
        const zipUrl = `https://github.com/${GITHUB_REPO}/archive/refs/heads/${GITHUB_BRANCH}.zip`;
        const tempZip = path.join(os.tmpdir(), `bedrock-mgr-update-${Date.now()}.zip`);

        const res = await fetch(zipUrl, {
          headers: { 'User-Agent': 'BedrockServerManager-Updater' },
          timeout: 45000,
        });

        if (!res.ok) {
          throw new Error(`Failed to download repository archive: HTTP ${res.status}`);
        }

        const destFile = fs.createWriteStream(tempZip);
        await new Promise((resolve, reject) => {
          res.body.pipe(destFile);
          res.body.on('error', reject);
          destFile.on('finish', resolve);
        });

        this.updateProgress = 'Extracting updated files while safeguarding data...';
        const zipDirectory = await unzipper.Open.file(tempZip);

        // Find the root folder prefix inside the zip (e.g. 'FatGoats-Bedrock-Server-Manager-Plus-main/')
        const topDir = zipDirectory.files[0]?.path?.split('/')?.[0] || '';

        for (const entry of zipDirectory.files) {
          if (entry.type === 'Directory') continue;

          // Strip top-level zip folder prefix
          let relPath = entry.path;
          if (topDir && relPath.startsWith(`${topDir}/`)) {
            relPath = relPath.substring(topDir.length + 1);
          }

          if (!relPath) continue;

          // CRITICAL: NEVER overwrite user data, worlds, database, nodejs runtime, or jre runtime
          const lower = relPath.toLowerCase().replace(/\\/g, '/');
          if (
            lower.startsWith('data/') ||
            lower.startsWith('bds/') ||
            lower.startsWith('nodejs/') ||
            lower.startsWith('jre/')
          ) {
            continue;
          }

          const targetFilePath = path.join(ROOT_DIR, relPath);
          const targetDir = path.dirname(targetFilePath);

          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          const buffer = await entry.buffer();
          safeWriteFile(targetFilePath, buffer);
        }

        try {
          fs.unlinkSync(tempZip);
        } catch (_) {}

        // Fetch latest commit metadata from GitHub to record accurate version
        try {
          const commits = await this.fetchGitHubCommits();
          if (commits && commits.length > 0) {
            const latest = commits[0];
            newCommitInfo = {
              commit: latest.sha.slice(0, 7),
              commitFull: latest.sha,
              date: latest.commit?.author?.date || new Date().toISOString(),
              subject: latest.commit?.message?.split('\n')[0] || 'Latest version from GitHub',
            };
          }
        } catch (_) {}
      }

      // ------------------------------------------------------------------------
      // STEP 3: Dependencies Verification
      // ------------------------------------------------------------------------
      this.updatePercent = 60;
      this.updateStage = 3;
      this.updateProgress = 'Verifying and updating application dependencies...';
      const execEnv = {
        ...process.env,
        PATH: `${path.join(ROOT_DIR, 'nodejs')};${process.env.PATH || ''}`,
      };
      try {
        execSync('cmd /c "npm install --no-audit --no-fund"', {
          cwd: ROOT_DIR,
          env: execEnv,
          windowsHide: true,
          timeout: 60000,
        });
      } catch (err) {
        console.warn('[AppUpdateService] npm install note:', err.message);
      }

      // ------------------------------------------------------------------------
      // STEP 4: Build React Frontend Assets
      // ------------------------------------------------------------------------
      this.updatePercent = 80;
      this.updateStage = 4;
      this.updateProgress = 'Verifying production frontend build assets...';
      try {
        execSync('cmd /c "cd client && npm run build"', {
          cwd: ROOT_DIR,
          env: execEnv,
          windowsHide: true,
          timeout: 60000,
        });
        console.log('[AppUpdateService] Frontend build complete.');
      } catch (err) {
        console.warn('[AppUpdateService] Client build note (using repository dist):', err.message);
      }

      // ------------------------------------------------------------------------
      // STEP 5: Recompile Windows Native Tray Launcher Binary
      // ------------------------------------------------------------------------
      this.updatePercent = 95;
      this.updateStage = 5;
      this.updateProgress = 'Recompiling BedrockServerManager.exe Windows tray launcher...';
      const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
      if (fs.existsSync(cscPath) && fs.existsSync(path.join(ROOT_DIR, 'tray', 'Program.cs'))) {
        try {
          prepareLockedFileForReplacement(path.join(ROOT_DIR, 'BedrockServerManager.exe'));
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
          console.warn('[AppUpdateService] Tray recompile note:', err.message);
        }
      }

      // ------------------------------------------------------------------------
      // STEP 6: Save Version Metadata & Reset Preferences
      // ------------------------------------------------------------------------
      if (newCommitInfo) {
        this.saveCurrentVersion(newCommitInfo);
      }

      setSetting('app_update_ignored_commit', '');
      setSetting('app_update_ask_later_until', '0');

      this.updatePercent = 100;
      this.updateProgress = 'Update successfully applied!';
      const finalCommit = newCommitInfo?.commit || this.getCurrentVersion().commit;

      return {
        success: true,
        newCommit: finalCommit,
        message: `App successfully updated to commit #${finalCommit}. All worlds, player databases, and configurations were safely preserved.`,
      };
    } finally {
      this.isUpdating = false;
    }
  }

  getProgress() {
    return {
      isUpdating: Boolean(this.isUpdating),
      progress: this.updateProgress || '',
      percent: this.updatePercent || 0,
      stage: this.updateStage || 0,
    };
  }
}

module.exports = new AppUpdateService();
