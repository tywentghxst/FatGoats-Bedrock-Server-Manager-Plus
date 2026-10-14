const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const serverProcess = require('../services/serverProcess');
const { logAudit } = require('../services/auditService');

const router = express.Router();

/**
 * GET /
 * Return server console logs
 */
router.get('/', authenticate, (req, res) => {
  try {
    const logs = serverProcess.getConsoleLogs();
    return res.json({ logs });
  } catch (err) {
    console.error('[ConsoleRoute] Error retrieving console logs:', err);
    return res.status(500).json({ error: 'Failed to retrieve console logs', details: err.message });
  }
});

/**
 * POST /command
 * Send command to server stdin (admin only)
 */
router.post('/command', authenticate, requireAdmin, (req, res) => {
  try {
    const { command } = req.body;

    if (!command || typeof command !== 'string' || !command.trim()) {
      return res.status(400).json({ error: 'Command string is required.' });
    }

    const result = serverProcess.sendCommand(command);
    logAudit(req.user.id, req.user.username, 'SERVER_COMMAND', { command: result.command });

    return res.json(result);
  } catch (err) {
    console.error('[ConsoleRoute] Error sending command:', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
