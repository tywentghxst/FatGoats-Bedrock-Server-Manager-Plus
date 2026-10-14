const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseProperties, writeProperties } = require('../utils/propertyParser');
const { logAudit } = require('../services/auditService');

const router = express.Router();

function getWorldsDirectory() {
  return config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        totalSize += getDirectorySize(fullPath);
      } else if (entry.isFile()) {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
  } catch (_) {}
  return totalSize;
}

/**
 * GET /
 * Scan worlds directory, return list with name, path, size, active flag.
 * Determine active world from server.properties level-name.
 */
router.get('/', authenticate, (req, res) => {
  try {
    const worldsDir = getWorldsDirectory();
    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    const activeWorldName = properties['level-name'] || 'Bedrock level';

    if (!fs.existsSync(worldsDir)) {
      return res.json({
        activeWorld: activeWorldName,
        worlds: []
      });
    }

    const entries = fs.readdirSync(worldsDir, { withFileTypes: true });
    const worlds = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(worldsDir, entry.name);
        const stats = fs.statSync(fullPath);
        const size = getDirectorySize(fullPath);
        worlds.push({
          name: entry.name,
          path: fullPath,
          size,
          isActive: entry.name === activeWorldName,
          lastModified: stats.mtime
        });
      }
    }

    return res.json({
      activeWorld: activeWorldName,
      worlds
    });
  } catch (err) {
    console.error('[WorldsRoute] Error listing worlds:', err);
    return res.status(500).json({ error: 'Failed to list worlds', details: err.message });
  }
});

/**
 * POST /active
 * Set active world by updating level-name in server.properties, logAudit
 */
router.post('/active', authenticate, requireAdmin, (req, res) => {
  try {
    const { worldName } = req.body;

    if (!worldName || typeof worldName !== 'string' || !worldName.trim()) {
      return res.status(400).json({ error: 'worldName is required.' });
    }

    const trimmedWorldName = worldName.trim();
    const worldsDir = getWorldsDirectory();
    const targetWorldDir = path.join(worldsDir, trimmedWorldName);

    // Verify world exists or notify that it will be generated on startup
    const exists = fs.existsSync(targetWorldDir);

    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    const prevWorld = properties['level-name'];
    properties['level-name'] = trimmedWorldName;
    writeProperties(propsPath, properties);

    logAudit(req.user.id, req.user.username, 'SET_ACTIVE_WORLD', {
      previousWorld: prevWorld,
      newWorld: trimmedWorldName,
      directoryExists: exists
    });

    return res.json({
      success: true,
      activeWorld: trimmedWorldName,
      message: exists
        ? `Active world set to "${trimmedWorldName}". Restart the server for changes to take effect.`
        : `Active world set to "${trimmedWorldName}". World directory does not exist yet; Bedrock server will generate it upon restart.`
    });
  } catch (err) {
    console.error('[WorldsRoute] Error setting active world:', err);
    return res.status(500).json({ error: 'Failed to set active world', details: err.message });
  }
});

/**
 * DELETE /:name
 * Delete world directory, logAudit. Prevent deletion of active world.
 */
router.delete('/:name', authenticate, requireAdmin, (req, res) => {
  try {
    const worldName = req.params.name;
    if (!worldName) {
      return res.status(400).json({ error: 'World name is required.' });
    }

    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    const activeWorldName = properties['level-name'] || 'Bedrock level';

    if (worldName === activeWorldName) {
      return res.status(400).json({
        error: `Cannot delete active world "${worldName}". Change the active world before deleting.`
      });
    }

    const worldsDir = getWorldsDirectory();
    const targetWorldDir = path.join(worldsDir, worldName);

    // Safety check against path traversal
    const relative = path.relative(worldsDir, targetWorldDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return res.status(400).json({ error: 'Invalid world path traversal detected.' });
    }

    if (!fs.existsSync(targetWorldDir)) {
      return res.status(404).json({ error: `World "${worldName}" does not exist.` });
    }

    fs.rmSync(targetWorldDir, { recursive: true, force: true });

    logAudit(req.user.id, req.user.username, 'DELETE_WORLD', { worldName });

    return res.json({
      success: true,
      message: `World "${worldName}" deleted successfully.`
    });
  } catch (err) {
    console.error('[WorldsRoute] Error deleting world:', err);
    return res.status(500).json({ error: 'Failed to delete world', details: err.message });
  }
});

module.exports = router;
