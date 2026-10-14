const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const config = require('../config');
const { parseProperties } = require('../utils/propertyParser');

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Determine active worlds directory
 */
function getWorldsDirectory() {
  return config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
}

/**
 * createBackup(worldName)
 * Determine active world from server.properties if worldName not given.
 * Create zip archive of the world folder + server.properties + allowlist.json + permissions.json.
 * Save to BACKUPS_DIR with timestamp filename. Return backup info.
 */
async function createBackup(worldName) {
  ensureDir(config.BACKUPS_DIR);

  let targetWorldName = worldName;
  const propsPath = path.join(config.BDS_DIR, 'server.properties');

  if (!targetWorldName) {
    const props = parseProperties(propsPath);
    targetWorldName = props['level-name'] || 'Bedrock level';
  }

  const worldsDir = getWorldsDirectory();
  const worldPath = path.join(worldsDir, targetWorldName);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeWorldName = targetWorldName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `backup-${safeWorldName}-${timestamp}.zip`;
  const destZipPath = path.join(config.BACKUPS_DIR, filename);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', () => {
      resolve({
        success: true,
        filename,
        path: destZipPath,
        worldName: targetWorldName,
        size: archive.pointer(),
        createdAt: new Date().toISOString()
      });
    });

    archive.on('error', (err) => {
      reject(new Error(`Archiving backup failed: ${err.message}`));
    });

    archive.pipe(output);

    // Archive world folder if exists
    if (fs.existsSync(worldPath)) {
      archive.directory(worldPath, path.join('worlds', targetWorldName));
    }

    // Archive config files if they exist in BDS_DIR
    const configFiles = ['server.properties', 'allowlist.json', 'permissions.json', 'whitelist.json'];
    for (const cf of configFiles) {
      const fullPath = path.join(config.BDS_DIR, cf);
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: cf });
      }
    }

    archive.finalize();
  });
}

/**
 * listBackups()
 * Scan BACKUPS_DIR for zip files, return metadata (name, size, date).
 */
async function listBackups() {
  ensureDir(config.BACKUPS_DIR);

  const files = fs.readdirSync(config.BACKUPS_DIR);
  const backups = [];

  for (const file of files) {
    if (file.toLowerCase().endsWith('.zip')) {
      const filePath = path.join(config.BACKUPS_DIR, file);
      try {
        const stats = fs.statSync(filePath);
        backups.push({
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime,
          modifiedAt: stats.mtime
        });
      } catch (err) {
        console.warn(`[BackupService] Failed reading stats for backup file: ${file}`, err.message);
      }
    }
  }

  // Sort descending by date
  backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return backups;
}

/**
 * restoreBackup(filename)
 * Extract backup zip to BDS directory (worlds directory + config files).
 * Return success.
 */
async function restoreBackup(filename) {
  ensureDir(config.BACKUPS_DIR);
  const backupPath = path.join(config.BACKUPS_DIR, filename);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  const worldsDir = getWorldsDirectory();
  ensureDir(worldsDir);
  ensureDir(config.BDS_DIR);

  return new Promise((resolve, reject) => {
    fs.createReadStream(backupPath)
      .pipe(unzipper.Parse())
      .on('entry', async (entry) => {
        const entryPath = entry.path;
        const type = entry.type; // 'Directory' or 'File'

        try {
          if (entryPath.startsWith('worlds/')) {
            // Restore world content to worlds directory
            // e.g., worlds/MyWorld/level.dat -> getWorldsDirectory()/MyWorld/level.dat
            const relativeToWorlds = entryPath.slice('worlds/'.length);
            if (!relativeToWorlds) {
              entry.autodrain();
              return;
            }
            const targetFullPath = path.join(worldsDir, relativeToWorlds);
            if (type === 'Directory') {
              ensureDir(targetFullPath);
              entry.autodrain();
            } else {
              ensureDir(path.dirname(targetFullPath));
              entry.pipe(fs.createWriteStream(targetFullPath));
            }
          } else {
            // Top-level config files (server.properties, allowlist.json, etc.)
            const targetFullPath = path.join(config.BDS_DIR, entryPath);
            if (type === 'Directory') {
              ensureDir(targetFullPath);
              entry.autodrain();
            } else {
              ensureDir(path.dirname(targetFullPath));
              entry.pipe(fs.createWriteStream(targetFullPath));
            }
          }
        } catch (err) {
          entry.autodrain();
          reject(err);
        }
      })
      .on('close', () => {
        resolve({
          success: true,
          message: `Backup ${filename} restored successfully.`
        });
      })
      .on('error', (err) => {
        reject(new Error(`Failed extracting backup zip: ${err.message}`));
      });
  });
}

/**
 * deleteBackup(filename)
 * Delete the zip file from BACKUPS_DIR.
 */
async function deleteBackup(filename) {
  ensureDir(config.BACKUPS_DIR);
  const backupPath = path.join(config.BACKUPS_DIR, filename);

  // Safety check against path traversal
  const relative = path.relative(config.BACKUPS_DIR, backupPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid backup filename traversal.');
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  fs.unlinkSync(backupPath);
  return {
    success: true,
    message: `Backup ${filename} deleted successfully.`
  };
}

/**
 * Get auto backup configuration settings
 */
function getBackupSettings() {
  const db = require('../database');
  const autoBackup = db.getSetting('auto_backup_enabled', 'false') === 'true';
  const frequencyHours = parseFloat(db.getSetting('backup_frequency_hours', '6')) || 6;
  const lastBackupTime = db.getSetting('last_backup_time', null);

  let nextBackupEstimate = null;
  if (autoBackup) {
    if (lastBackupTime) {
      const nextMs = new Date(lastBackupTime).getTime() + (frequencyHours * 3600 * 1000);
      nextBackupEstimate = new Date(nextMs).toISOString();
    } else {
      nextBackupEstimate = new Date().toISOString();
    }
  }

  return {
    autoBackup,
    frequencyHours,
    lastBackupTime,
    nextBackupEstimate
  };
}

/**
 * Update auto backup configuration settings
 */
function updateBackupSettings(autoBackup, frequencyHours) {
  const db = require('../database');
  db.setSetting('auto_backup_enabled', autoBackup ? 'true' : 'false');
  if (frequencyHours && !isNaN(frequencyHours)) {
    db.setSetting('backup_frequency_hours', String(frequencyHours));
  }
  return getBackupSettings();
}

let _schedulerTimer = null;

/**
 * Start recurring background scheduler to execute auto-backups according to configured frequency
 */
function initAutoBackupScheduler(serverProcess) {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
  }

  console.log('[BackupService] Initializing Auto-Backup Scheduler...');

  // Check every 60 seconds
  _schedulerTimer = setInterval(async () => {
    try {
      const db = require('../database');
      const autoBackup = db.getSetting('auto_backup_enabled', 'false') === 'true';
      if (!autoBackup) return;

      const frequencyHours = parseFloat(db.getSetting('backup_frequency_hours', '6')) || 6;
      const lastBackupStr = db.getSetting('last_backup_time', null);
      const now = Date.now();

      const lastBackupMs = lastBackupStr ? new Date(lastBackupStr).getTime() : 0;
      const intervalMs = frequencyHours * 3600 * 1000;

      if (now - lastBackupMs >= intervalMs) {
        console.log(`[BackupService] Running scheduled automatic backup (Frequency: every ${frequencyHours}h)...`);
        
        // If BDS is running, flush chunks safely
        if (serverProcess && serverProcess.state === 'running') {
          try {
            serverProcess.sendCommand('save hold');
            await new Promise((r) => setTimeout(r, 1000));
          } catch (_) {}
        }

        try {
          const res = await createBackup();
          const backupTime = new Date().toISOString();
          db.setSetting('last_backup_time', backupTime);
          console.log(`[BackupService] Auto-backup completed successfully: ${res.filename}`);
        } finally {
          if (serverProcess && serverProcess.state === 'running') {
            try {
              serverProcess.sendCommand('save resume');
            } catch (_) {}
          }
        }
      }
    } catch (err) {
      console.error('[BackupService] Scheduled auto-backup failed:', err.message);
    }
  }, 60 * 1000);
}

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  getBackupSettings,
  updateBackupSettings,
  initAutoBackupScheduler
};
