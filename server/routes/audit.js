const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { getAuditLogs } = require('../services/auditService');

const router = express.Router();

/**
 * GET /
 * (authenticate, requireAdmin) return audit logs with optional limit/offset query params
 */
router.get('/', authenticate, requireAdmin, (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;

    const logs = getAuditLogs(limit, offset);
    return res.json({ logs });
  } catch (err) {
    console.error('[AuditRoute] Error fetching audit logs:', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs', details: err.message });
  }
});

module.exports = router;
