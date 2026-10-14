const express = require('express');
const path = require('path');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseProperties, writeProperties, sanitizeProperties, getDefaultProperties } = require('../utils/propertyParser');
const { logAudit } = require('../services/auditService');

const router = express.Router();

/**
 * GET /
 * Parse and return server.properties from BDS_DIR/server.properties, return defaults if file doesn't exist
 */
router.get('/', authenticate, (req, res) => {
  try {
    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    return res.json({ properties });
  } catch (err) {
    console.error('[PropertiesRoute] Error reading properties:', err);
    return res.status(500).json({ error: 'Failed to read server properties', details: err.message });
  }
});

/**
 * PUT /
 * Sanitize properties, write to BDS_DIR/server.properties, logAudit
 */
router.put('/', authenticate, requireAdmin, (req, res) => {
  try {
    const properties = req.body.properties || req.body;

    if (!properties || typeof properties !== 'object') {
      return res.status(400).json({ error: 'Properties object is required.' });
    }

    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const sanitized = sanitizeProperties(properties);
    writeProperties(propsPath, sanitized);

    logAudit(req.user.id, req.user.username, 'UPDATE_PROPERTIES', {
      updatedKeys: Object.keys(properties)
    });

    return res.json({
      success: true,
      message: 'Server properties updated successfully',
      properties: sanitized
    });
  } catch (err) {
    console.error('[PropertiesRoute] Error writing properties:', err);
    return res.status(500).json({ error: 'Failed to update server properties', details: err.message });
  }
});

module.exports = router;
