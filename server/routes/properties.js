const express = require('express');
const path = require('path');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseProperties, writeProperties, sanitizeProperties } = require('../utils/propertyParser');
const { logAudit } = require('../services/auditService');
const serverProcess = require('../services/serverProcess');
const {
  getWorldExperiments,
  saveWorldExperiments,
  getActiveWorldName,
  getAvailableWorlds,
} = require('../services/worldExperimentService');

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

/**
 * GET /experiments
 * Inspect experimental features for the active or requested world
 */
router.get('/experiments', authenticate, async (req, res) => {
  try {
    const worldName = req.query.worldName || req.query.world;
    const data = await getWorldExperiments(worldName);
    const serverRunning = serverProcess.state === 'running' || serverProcess.state === 'starting';

    return res.json({
      ...data,
      serverRunning,
    });
  } catch (err) {
    console.error('[PropertiesRoute] Error reading world experiments:', err);
    return res.status(500).json({
      error: 'Failed to read world experimental features',
      details: err.message,
    });
  }
});

/**
 * PUT /experiments
 * Toggle and save experimental features in the world level.dat
 */
router.put('/experiments', authenticate, requireAdmin, async (req, res) => {
  try {
    const { worldName, experiments } = req.body;

    if (!experiments || typeof experiments !== 'object') {
      return res.status(400).json({ error: 'Experiments object is required.' });
    }

    const updated = await saveWorldExperiments(worldName, experiments);
    const serverRunning = serverProcess.state === 'running' || serverProcess.state === 'starting';

    logAudit(req.user.id, req.user.username, 'UPDATE_WORLD_EXPERIMENTS', {
      world: updated.targetWorld,
      experiments: Object.keys(experiments).filter((k) => Boolean(experiments[k])),
    });

    return res.json({
      success: true,
      message: serverRunning
        ? `Experimental features saved for world "${updated.targetWorld}"! Note: Restart the Bedrock server for changes to take effect.`
        : `Experimental features saved successfully for world "${updated.targetWorld}"!`,
      data: {
        ...updated,
        serverRunning,
      },
    });
  } catch (err) {
    console.error('[PropertiesRoute] Error updating world experiments:', err);
    return res.status(500).json({
      error: 'Failed to update world experimental features',
      details: err.message,
    });
  }
});

module.exports = router;
