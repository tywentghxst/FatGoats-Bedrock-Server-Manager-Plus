const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const appUpdateService = require('../services/appUpdateService');
const { logAudit } = require('../services/auditService');

const router = express.Router();

router.use(authenticate);

/**
 * GET /status
 * Retrieve current app update state and preferences.
 */
router.get('/status', async (req, res) => {
  try {
    const forceFetch = req.query.fetch === 'true';
    const status = await appUpdateService.checkUpdates(forceFetch);
    return res.json(status);
  } catch (err) {
    console.error('[UpdatesRoute] Error getting update status:', err);
    return res.status(500).json({ error: 'Failed to check app updates', details: err.message });
  }
});

/**
 * POST /check
 * Force fetch origin and return fresh update status.
 */
router.post('/check', async (req, res) => {
  try {
    const status = await appUpdateService.checkUpdates(true);
    return res.json(status);
  } catch (err) {
    console.error('[UpdatesRoute] Error checking updates:', err);
    return res.status(500).json({ error: 'Failed to fetch updates from GitHub', details: err.message });
  }
});

/**
 * POST /preferences
 * Update user prompt preferences (autoCheck, ignoredCommit, askLater).
 */
router.post('/preferences', (req, res) => {
  try {
    const { autoCheck, ignoredCommit, askLater, clearSnooze } = req.body || {};
    const updated = appUpdateService.setPreferences({ autoCheck, ignoredCommit, askLater, clearSnooze });
    return res.json({ success: true, preferences: updated });
  } catch (err) {
    console.error('[UpdatesRoute] Error updating preferences:', err);
    return res.status(500).json({ error: 'Failed to update preferences', details: err.message });
  }
});

/**
 * POST /apply
 * Execute safe git pull, build, and recompile without deleting any user data.
 * Requires admin privileges.
 */
router.post('/apply', requireAdmin, async (req, res) => {
  try {
    const result = await appUpdateService.applyUpdate();
    logAudit(req.user.id, req.user.username, 'APP_UPDATE_APPLIED', `App updated to commit #${result.newCommit}`);
    return res.json(result);
  } catch (err) {
    console.error('[UpdatesRoute] Error applying update:', err);
    return res.status(500).json({ error: 'Failed to apply update', details: err.message });
  }
});

module.exports = router;
