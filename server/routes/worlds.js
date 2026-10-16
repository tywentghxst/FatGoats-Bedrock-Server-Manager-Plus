const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseProperties, writeProperties } = require('../utils/propertyParser');
const { logAudit } = require('../services/auditService');
const serverProcess = require('../services/serverProcess');
const worldService = require('../services/worldService');
const {
  getWorldExperiments,
  saveWorldExperiments,
} = require('../services/worldExperimentService');

const router = express.Router();

// Ensure upload directory exists
if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}

// Multer storage and file filter configuration (.mcworld, .zip)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `world-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.mcworld', '.zip'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid world file type "${ext}". Allowed formats: .mcworld, .zip`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max for large world saves
});

/**
 * GET /
 * Scan worlds directory, return list with metadata, size, active flag, iconUrl.
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const data = await worldService.listWorlds();
    return res.json(data);
  } catch (err) {
    console.error('[WorldsRoute] Error listing worlds:', err);
    return res.status(500).json({ error: 'Failed to list worlds', details: err.message });
  }
});

/**
 * GET /:name/icon
 * Public thumbnail streamer for world_icon.jpeg or world_icon.png
 */
router.get('/:name/icon', (req, res) => {
  try {
    const iconPath = worldService.getWorldIconPath(req.params.name);
    if (!iconPath) {
      return res.status(404).send('World icon not found');
    }
    const ext = path.extname(iconPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
    return fs.createReadStream(iconPath).pipe(res);
  } catch (err) {
    console.error('[WorldsRoute] Error serving world icon:', err);
    return res.status(500).send('Error serving icon');
  }
});

/**
 * GET /:name/export
 * Export and download the world folder as a standard .mcworld file
 */
router.get('/:name/export', (req, res) => {
  try {
    // Support either Bearer header or ?token=... in URL for direct browser downloads
    const authHeader = req.headers.authorization;
    const queryToken = req.query.token;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication required to export worlds.' });
    }

    try {
      jwt.verify(token, config.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }

    worldService.exportWorld(req.params.name, res);
  } catch (err) {
    console.error('[WorldsRoute] Error exporting world:', err);
    return res.status(500).json({ error: 'Failed to export world', details: err.message });
  }
});

/**
 * POST /import and POST /upload
 * Upload and extract a .mcworld or .zip world archive
 */
const handleImportWorld = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No world file was uploaded (.mcworld or .zip required).' });
  }

  try {
    const targetName = req.body.name || req.body.targetName || '';
    const overwrite = req.body.overwrite === 'true' || req.body.overwrite === true;
    const setActive = req.body.setActive === 'true' || req.body.setActive === true;

    const result = await worldService.importWorld(req.file.path, req.file.originalname, {
      targetName,
      overwrite,
      setActive,
    });

    logAudit(req.user.id, req.user.username, 'IMPORT_WORLD', {
      originalFilename: req.file.originalname,
      worldName: result.world?.name,
      displayName: result.world?.displayName,
      setActive,
      overwrite,
    });

    return res.json({
      success: true,
      message: result.message,
      world: result.world,
      wasActivated: result.wasActivated,
    });
  } catch (err) {
    console.error('[WorldsRoute] Error importing world:', err);
    // Cleanup file if remaining
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    return res.status(500).json({
      error: err.message || 'Failed to import Minecraft world',
    });
  }
};

router.post('/import', authenticate, requireAdmin, upload.single('world'), handleImportWorld);
router.post('/upload', authenticate, requireAdmin, upload.single('world'), handleImportWorld);

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
    const worldsDir = worldService.getWorldsDirectory();
    const targetWorldDir = path.join(worldsDir, trimmedWorldName);

    const exists = fs.existsSync(targetWorldDir);

    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    const prevWorld = properties['level-name'];
    properties['level-name'] = trimmedWorldName;
    writeProperties(propsPath, properties);

    logAudit(req.user.id, req.user.username, 'SET_ACTIVE_WORLD', {
      previousWorld: prevWorld,
      newWorld: trimmedWorldName,
      directoryExists: exists,
    });

    return res.json({
      success: true,
      activeWorld: trimmedWorldName,
      message: exists
        ? `Active world set to "${trimmedWorldName}". Restart the server for changes to take effect.`
        : `Active world set to "${trimmedWorldName}". World directory does not exist yet; Bedrock server will generate it upon restart.`,
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
    const activeWorld = properties['level-name'] || 'Bedrock level';

    if (worldName === activeWorld) {
      return res.status(400).json({
        error: `Cannot delete active world "${worldName}". Change the active world before deleting.`,
      });
    }

    const worldsDir = worldService.getWorldsDirectory();
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
      message: `World "${worldName}" deleted successfully.`,
    });
  } catch (err) {
    console.error('[WorldsRoute] Error deleting world:', err);
    return res.status(500).json({ error: 'Failed to delete world', details: err.message });
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
    console.error('[WorldsRoute] Error reading world experiments:', err);
    return res.status(500).json({
      error: 'Failed to read world experimental features',
      details: err.message,
    });
  }
});

/**
 * PUT/POST /experiments
 * Toggle and save experimental features in the world level.dat
 */
const handleSaveExperimentsRoute = async (req, res) => {
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
    console.error('[WorldsRoute] Error updating world experiments:', err);
    return res.status(500).json({
      error: 'Failed to update world experimental features',
      details: err.message,
    });
  }
};

router.put('/experiments', authenticate, requireAdmin, handleSaveExperimentsRoute);
router.post('/experiments', authenticate, requireAdmin, handleSaveExperimentsRoute);

module.exports = router;
