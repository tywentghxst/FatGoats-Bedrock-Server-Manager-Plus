const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const versionService = require('../services/versionService');
const serverProcess = require('../services/serverProcess');
const { logAudit } = require('../services/auditService');

const router = express.Router();

// Ensure upload directory exists
if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `bds-package-${uniqueSuffix}.zip`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

/**
 * GET /current
 * (authenticate) get current installed version
 */
router.get('/current', authenticate, (req, res) => {
  try {
    const versionInfo = versionService.getCurrentVersion();
    return res.json(versionInfo);
  } catch (err) {
    console.error('[VersionsRoute] Error getting current version:', err);
    return res.status(500).json({ error: 'Failed to retrieve current version', details: err.message });
  }
});

/**
 * GET /available
 * (authenticate) fetch available versions from official source
 */
router.get('/available', authenticate, async (req, res) => {
  try {
    const versions = await versionService.fetchAvailableVersions();
    return res.json({ versions });
  } catch (err) {
    console.error('[VersionsRoute] Error fetching available versions:', err);
    return res.status(500).json({ error: 'Failed to fetch available versions', details: err.message });
  }
});

/**
 * POST /install
 * (authenticate, requireAdmin) install from URL, logAudit
 */
router.post('/install', authenticate, requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Download URL is required.' });
    }

    // Stop server if running
    let wasRunning = false;
    if (serverProcess.state === 'running' || serverProcess.state === 'starting') {
      wasRunning = true;
      await serverProcess.stop();
    }

    const result = await versionService.installVersion(url);
    logAudit(req.user.id, req.user.username, 'INSTALL_VERSION_URL', { url, wasRunning });

    return res.json(result);
  } catch (err) {
    console.error('[VersionsRoute] Error installing version from URL:', err);
    logAudit(req.user.id, req.user.username, 'INSTALL_VERSION_URL_FAILED', {
      url: req.body.url,
      error: err.message
    });
    return res.status(500).json({ error: 'Failed to install version', details: err.message });
  }
});

/**
 * POST /upload
 * (authenticate, requireAdmin) multer upload of zip, install from upload, logAudit
 */
router.post('/upload', authenticate, requireAdmin, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    try {
      // Stop server if running
      let wasRunning = false;
      if (serverProcess.state === 'running' || serverProcess.state === 'starting') {
        wasRunning = true;
        await serverProcess.stop();
      }

      const result = await versionService.installFromUpload(req.file.path);
      logAudit(req.user.id, req.user.username, 'INSTALL_VERSION_UPLOAD', {
        filename: req.file.originalname,
        wasRunning
      });

      return res.json(result);
    } catch (installErr) {
      if (fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      console.error('[VersionsRoute] Error installing from upload:', installErr);
      logAudit(req.user.id, req.user.username, 'INSTALL_VERSION_UPLOAD_FAILED', {
        filename: req.file.originalname,
        error: installErr.message
      });
      return res.status(500).json({ error: 'Failed to install version from upload', details: installErr.message });
    }
  });
});

/**
 * POST /install-latest
 * (authenticate, requireAdmin) automatically download and install the latest official release for the host OS
 */
router.post('/install-latest', authenticate, requireAdmin, async (req, res) => {
  try {
    let wasRunning = false;
    if (serverProcess.state === 'running' || serverProcess.state === 'starting') {
      wasRunning = true;
      await serverProcess.stop();
    }

    const result = await versionService.installLatest();
    logAudit(req.user.id, req.user.username, 'INSTALL_LATEST_VERSION', {
      installedVersion: result.installedVersion,
      wasRunning
    });

    return res.json(result);
  } catch (err) {
    console.error('[VersionsRoute] Error installing latest version:', err);
    logAudit(req.user.id, req.user.username, 'INSTALL_LATEST_VERSION_FAILED', {
      error: err.message
    });
    return res.status(500).json({ error: 'Failed to install latest version', details: err.message });
  }
});

/**
 * GET /settings
 * (authenticate) get server version update settings
 */
router.get('/settings', authenticate, (req, res) => {
  try {
    const db = require('../database');
    const autoUpdate = db.getSetting('auto_update_server', 'false') === 'true';
    return res.json({ autoUpdate });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get version settings', details: err.message });
  }
});

/**
 * POST /settings
 * (authenticate, requireAdmin) update auto update toggle
 */
router.post('/settings', authenticate, requireAdmin, (req, res) => {
  try {
    const { autoUpdate } = req.body;
    const db = require('../database');
    db.setSetting('auto_update_server', autoUpdate ? 'true' : 'false');

    logAudit(req.user.id, req.user.username, 'UPDATE_VERSION_SETTINGS', {
      autoUpdate: !!autoUpdate
    });

    return res.json({ success: true, autoUpdate: !!autoUpdate });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update version settings', details: err.message });
  }
});

module.exports = router;
