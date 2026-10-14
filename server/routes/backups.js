const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const backupService = require('../services/backupService');
const serverProcess = require('../services/serverProcess');
const { logAudit } = require('../services/auditService');

const router = express.Router();

/**
 * GET /
 * (authenticate) list backups
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const backups = await backupService.listBackups();
    return res.json({ backups });
  } catch (err) {
    console.error('[BackupsRoute] Error listing backups:', err);
    return res.status(500).json({ error: 'Failed to list backups', details: err.message });
  }
});

/**
 * POST /
 * (authenticate, requireAdmin) create backup, logAudit
 */
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { worldName } = req.body;
    const backupInfo = await backupService.createBackup(worldName);
    logAudit(req.user.id, req.user.username, 'CREATE_BACKUP', backupInfo);
    return res.status(201).json(backupInfo);
  } catch (err) {
    console.error('[BackupsRoute] Error creating backup:', err);
    logAudit(req.user.id, req.user.username, 'CREATE_BACKUP_FAILED', err.message);
    return res.status(500).json({ error: 'Failed to create backup', details: err.message });
  }
});

/**
 * GET /settings
 * (authenticate) get auto-backup settings
 */
router.get('/settings', authenticate, (req, res) => {
  try {
    const settings = backupService.getBackupSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[BackupsRoute] Error getting backup settings:', err);
    return res.status(500).json({ error: 'Failed to retrieve backup settings', details: err.message });
  }
});

/**
 * POST /settings
 * (authenticate, requireAdmin) update auto-backup settings
 */
router.post('/settings', authenticate, requireAdmin, (req, res) => {
  try {
    const { autoBackup, frequencyHours } = req.body;
    const updated = backupService.updateBackupSettings(Boolean(autoBackup), frequencyHours);
    logAudit(req.user.id, req.user.username, 'UPDATE_BACKUP_SETTINGS', { autoBackup, frequencyHours });
    return res.json(updated);
  } catch (err) {
    console.error('[BackupsRoute] Error updating backup settings:', err);
    return res.status(500).json({ error: 'Failed to update backup settings', details: err.message });
  }
});

/**
 * POST /:filename/restore
 * (authenticate, requireAdmin) stop server if running, restore backup, logAudit
 */
router.post('/:filename/restore', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Stop server if running or starting
    let serverWasRunning = false;
    if (serverProcess.state === 'running' || serverProcess.state === 'starting') {
      serverWasRunning = true;
      await serverProcess.stop();
    }

    const result = await backupService.restoreBackup(filename);
    logAudit(req.user.id, req.user.username, 'RESTORE_BACKUP', {
      filename,
      serverWasStopped: serverWasRunning
    });

    return res.json({
      ...result,
      serverWasStopped: serverWasRunning
    });
  } catch (err) {
    console.error('[BackupsRoute] Error restoring backup:', err);
    logAudit(req.user.id, req.user.username, 'RESTORE_BACKUP_FAILED', {
      filename: req.params.filename,
      error: err.message
    });
    return res.status(500).json({ error: 'Failed to restore backup', details: err.message });
  }
});

/**
 * DELETE /:filename
 * (authenticate, requireAdmin) delete backup, logAudit
 */
router.delete('/:filename', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filename } = req.params;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    const result = await backupService.deleteBackup(filename);
    logAudit(req.user.id, req.user.username, 'DELETE_BACKUP', { filename });
    return res.json(result);
  } catch (err) {
    console.error('[BackupsRoute] Error deleting backup:', err);
    return res.status(500).json({ error: 'Failed to delete backup', details: err.message });
  }
});

module.exports = router;
