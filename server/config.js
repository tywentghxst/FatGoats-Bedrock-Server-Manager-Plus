const path = require('path');

const config = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
  JWT_SECRET: process.env.JWT_SECRET || 'bedrock-manager-secret-key-change-in-production',
  BDS_DIR: process.env.BDS_DIR || path.join(__dirname, '..', 'bds'),
  BACKUPS_DIR: process.env.BACKUPS_DIR || path.join(__dirname, '..', 'data', 'backups'),
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'db', 'manager.db'),
  WORLDS_DIR: process.env.WORLDS_DIR || null,
  MAX_CONSOLE_LINES: 500,
  BACKUP_ON_START: process.env.BACKUP_ON_START === 'true',
  UPLOAD_DIR: path.join(__dirname, '..', 'data', 'uploads')
};

module.exports = config;
