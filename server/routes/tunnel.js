const express = require('express');
const { authenticate, requireOperatorOrAdmin } = require('../middleware/auth');
const playitService = require('../services/playitService');
const { logAudit } = require('../services/auditService');

const router = express.Router();

// Require auth
router.use(authenticate);

/**
 * GET /status
 * Get current Playit.gg tunnel status, public address, claim state
 */
router.get('/status', (req, res) => {
  try {
    const status = playitService.getStatus();
    return res.json(status);
  } catch (err) {
    console.error('[TunnelRoute] Status error:', err);
    return res.status(500).json({ error: 'Failed to retrieve tunnel status', details: err.message });
  }
});

/**
 * POST /start
 * Start tunnel daemon or start claim flow if not claimed
 */
router.post('/start', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await playitService.start();
    logAudit(req.user.id, req.user.username, 'TUNNEL_START', 'Started Playit.gg internet tunnel');
    return res.json({ success: true, message: 'Playit tunnel started.', ...result });
  } catch (err) {
    console.error('[TunnelRoute] Start error:', err);
    return res.status(400).json({ error: err.message || 'Failed to start tunnel.' });
  }
});

/**
 * POST /stop
 * Stop tunnel daemon
 */
router.post('/stop', requireOperatorOrAdmin, (req, res) => {
  try {
    const result = playitService.stop();
    logAudit(req.user.id, req.user.username, 'TUNNEL_STOP', 'Stopped Playit.gg internet tunnel');
    return res.json({ success: true, message: 'Playit tunnel stopped.', ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to stop tunnel.' });
  }
});

/**
 * POST /restart
 * Restart tunnel daemon
 */
router.post('/restart', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await playitService.restart();
    logAudit(req.user.id, req.user.username, 'TUNNEL_RESTART', 'Restarted Playit.gg internet tunnel');
    return res.json({ success: true, message: 'Playit tunnel restarted.', ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to restart tunnel.' });
  }
});

/**
 * POST /claim/start
 * Generate a fresh 1-click claim URL
 */
router.post('/claim/start', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await playitService.startClaimFlow();
    return res.json({ success: true, message: 'Claim code and URL generated.', ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to generate claim URL.' });
  }
});

/**
 * POST /claim/secret
 * Manually submit a Secret Key from the Playit.gg dashboard
 */
router.post('/claim/secret', requireOperatorOrAdmin, async (req, res) => {
  try {
    const { secret } = req.body;
    if (!secret || typeof secret !== 'string') {
      return res.status(400).json({ error: 'Please provide a valid Playit secret key.' });
    }
    const result = await playitService.setSecretKey(secret);
    logAudit(req.user.id, req.user.username, 'TUNNEL_SECRET_UPDATE', 'Saved Playit secret key');
    return res.json({ success: true, message: 'Secret key saved and tunnel initialized.', ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to save secret key.' });
  }
});

/**
 * POST /reset
 * Reset the agent (removes secret to allow re-claiming)
 */
router.post('/reset', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await playitService.reset();
    logAudit(req.user.id, req.user.username, 'TUNNEL_RESET', 'Reset Playit.gg agent configuration');
    return res.json({ success: true, message: 'Agent configuration reset.', ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to reset agent.' });
  }
});

/**
 * PUT /config
 * Update tunnel settings (autoStart, targetPort, showInPortal)
 */
router.put('/config', requireOperatorOrAdmin, (req, res) => {
  try {
    const newConfig = playitService.updateConfig(req.body);
    logAudit(req.user.id, req.user.username, 'TUNNEL_CONFIG_UPDATE', 'Updated Playit tunnel configuration');
    return res.json({ success: true, message: 'Tunnel settings saved.', config: newConfig });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Failed to update tunnel config.' });
  }
});

module.exports = router;
