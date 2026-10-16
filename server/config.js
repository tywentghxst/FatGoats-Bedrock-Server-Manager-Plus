const fs = require('fs');
const path = require('path');

const defaultBds = process.env.BDS_DIR || path.join(__dirname, '..', 'bds');

const config = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  JWT_SECRET: process.env.JWT_SECRET || 'bedrock-manager-secret-key-change-in-production',
  _defaultBdsDir: defaultBds,
  _bdsDirOverride: null,
  _defaultWorldsDir: process.env.WORLDS_DIR || path.join(defaultBds, 'worlds'),
  _worldsDirOverride: null,
  BACKUPS_DIR: process.env.BACKUPS_DIR || path.join(__dirname, '..', 'data', 'backups'),
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db', 'manager.db'),
  MAX_CONSOLE_LINES: 500,
  BACKUP_ON_START: process.env.BACKUP_ON_START === 'true',
  UPLOAD_DIR: path.join(__dirname, '..', 'data', 'uploads'),

  get BDS_DIR() {
    if (this._bdsDirOverride) return this._bdsDirOverride;
    try {
      const db = require('./database');
      const custom = db.getSetting ? db.getSetting('custom_bds_dir') : null;
      if (custom && typeof custom === 'string' && custom.trim() && fs.existsSync(custom.trim())) {
        return path.resolve(custom.trim());
      }
    } catch (_) {}
    return this._defaultBdsDir;
  },

  set BDS_DIR(val) {
    this._bdsDirOverride = val ? path.resolve(val) : null;
  },

  get WORLDS_DIR() {
    if (this._worldsDirOverride) return this._worldsDirOverride;
    try {
      const db = require('./database');
      const custom = db.getSetting ? db.getSetting('custom_worlds_dir') : null;
      if (custom && typeof custom === 'string' && custom.trim() && fs.existsSync(custom.trim())) {
        return path.resolve(custom.trim());
      }
    } catch (_) {}
    return process.env.WORLDS_DIR || path.join(this.BDS_DIR, 'worlds');
  },

  set WORLDS_DIR(val) {
    this._worldsDirOverride = val ? path.resolve(val) : null;
  }
};

module.exports = config;
