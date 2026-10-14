const express = require('express');
const { authenticate, requireOperatorOrAdmin } = require('../middleware/auth');
const broadcasterService = require('../services/broadcasterService');
const { logAudit } = require('../services/auditService');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /status
 * Returns current Xbox Live connection status, bot state, and config
 */
router.get('/status', (req, res) => {
  try {
    const status = broadcasterService.getStatus();
    return res.json(status);
  } catch (err) {
    console.error('[XboxRoute] Error getting status:', err);
    return res.status(500).json({ error: 'Failed to retrieve Xbox status', details: err.message });
  }
});

/**
 * POST /login/start
 * Initiate 1-click Microsoft Device Code Flow via MCXboxBroadcast Standalone
 */
router.post('/login/start', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await broadcasterService.startLogin();
    logAudit(req.user.id, req.user.username, 'XBOX_LOGIN_START', 'Initiated MCXboxBroadcast device code login');
    return res.json(result);
  } catch (err) {
    console.error('[XboxRoute] Error starting login:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /login/cancel
 * Cancel pending device code login
 */
router.post('/login/cancel', requireOperatorOrAdmin, (req, res) => {
  try {
    const result = broadcasterService.cancelLogin();
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /login/token
 * Manual token submission
 */
router.post('/login/token', requireOperatorOrAdmin, async (req, res) => {
  try {
    return res.json({ success: true, message: 'Please use the 1-click Microsoft link code above.' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /logout
 * Unlink Microsoft Xbox Live account
 */
router.post('/logout', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await broadcasterService.logout();
    logAudit(req.user.id, req.user.username, 'XBOX_LOGOUT', 'Unlinked MCXboxBroadcast account');
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /start
 * Start MCXboxBroadcast Standalone
 */
router.post('/start', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await broadcasterService.start();
    logAudit(req.user.id, req.user.username, 'XBOX_BOT_START', 'Started MCXboxBroadcast Standalone');
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /stop
 * Stop MCXboxBroadcast Standalone
 */
router.post('/stop', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await broadcasterService.stop();
    logAudit(req.user.id, req.user.username, 'XBOX_BOT_STOP', 'Stopped MCXboxBroadcast Standalone');
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /restart
 * Restart MCXboxBroadcast Standalone
 */
router.post('/restart', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await broadcasterService.restart();
    logAudit(req.user.id, req.user.username, 'XBOX_BOT_RESTART', 'Restarted MCXboxBroadcast Standalone');
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /config
 * Update bot target IP, port, autoAcceptFriends toggle, etc.
 */
router.put('/config', requireOperatorOrAdmin, async (req, res) => {
  try {
    const updated = await broadcasterService.updateConfig(req.body);
    logAudit(req.user.id, req.user.username, 'XBOX_CONFIG_UPDATE', req.body);
    return res.json({ success: true, config: updated, message: 'Configuration saved. Bot reloaded with new destination!' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /friends
 * Fetch Xbox Live friends and incoming requests
 */
router.get('/friends', async (req, res) => {
  try {
    const data = await broadcasterService.getFriends();
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch friends list', details: err.message });
  }
});

/**
 * POST /friends/sync
 * Manually trigger friend request check and force refresh from PeopleHub
 */
router.post('/friends/sync', requireOperatorOrAdmin, async (req, res) => {
  try {
    const data = await broadcasterService.getFriends(true);
    return res.json(data);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /friends/accept
 * Accept an incoming friend request or follow an Xbox user back
 */
router.post('/friends/accept', requireOperatorOrAdmin, async (req, res) => {
  try {
    const { xuid } = req.body;
    if (!xuid) return res.status(400).json({ error: 'xuid is required' });
    const result = await broadcasterService.acceptFriend(xuid);
    logAudit(req.user.id, req.user.username, 'XBOX_FRIEND_ACCEPT', { xuid });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
