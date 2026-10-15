const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const config = require('../config');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const addonService = require('../services/addonService');
const { logAudit } = require('../services/auditService');
const { parseProperties } = require('../utils/propertyParser');

const router = express.Router();

/**
 * GET /search-url
 * (authenticate, requireAdmin) Search the web for addon URLs, images, titles, and snippets
 */
router.get('/search-url', authenticate, requireAdmin, async (req, res) => {
  try {
    let query = (req.query.query || '').trim();
    const uuid = req.query.uuid;

    if (!query && uuid) {
      const addon = db.prepare('SELECT name, display_name, original_filename FROM addons WHERE uuid = ?').get(uuid);
      if (addon) {
        query = (addon.display_name && addon.display_name !== 'pack.name')
          ? addon.display_name
          : (addon.name && addon.name !== 'pack.name' ? addon.name : (addon.original_filename || ''));
      }
    }

    if (!query) {
      return res.status(400).json({ error: 'Search query or valid addon UUID is required' });
    }

    // Sanitize query for cleaner search
    const cleanQuery = query
      .replace(/\.(mcaddon|mcpack|zip)$/i, '')
      .replace(/\s*(addon|\(addon\)|pack|\(pack\)|behavior|resource|bp|rp)$/i, '')
      .trim();

    const results = await addonService.searchAddonUrl(cleanQuery);
    return res.json({ query: cleanQuery, results });
  } catch (err) {
    console.error('[AddonsRoute] Error searching addon URL:', err);
    return res.status(500).json({ error: 'Failed to search for addon URL', details: err.message });
  }
});

// Ensure upload directory exists
if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}

// Multer storage and file filter configuration (.zip, .mcpack, .mcaddon, .mcworld)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `addon-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.zip', '.mcpack', '.mcaddon', '.mcworld'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type ${ext}. Allowed formats: .mcpack, .mcaddon, .mcworld, .zip`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1 GB max for world bundles
});

/**
 * GET /
 * (authenticate) list all addons from database with full metadata
 */
router.get('/', authenticate, (req, res) => {
  try {
    const addons = addonService.listAddons();
    return res.json({ addons });
  } catch (err) {
    console.error('[AddonsRoute] Error listing addons:', err);
    return res.status(500).json({ error: 'Failed to list addons', details: err.message });
  }
});

/**
 * GET /:uuid/icon
 * Public / authenticated thumbnail streamer for pack_icon.png
 */
router.get('/:uuid/icon', (req, res) => {
  try {
    const iconPath = addonService.getPackIconPath(req.params.uuid);
    if (!iconPath) {
      return res.status(404).send('Icon not found');
    }
    const ext = path.extname(iconPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
    fs.createReadStream(iconPath).pipe(res);
  } catch (err) {
    console.error('[AddonsRoute] Error serving pack icon:', err);
    return res.status(500).send('Error serving icon');
  }
});

/**
 * POST /upload
 * (authenticate, requireAdmin) upload .mcpack, .mcaddon, .mcworld, or .zip
 */
router.post('/upload', authenticate, requireAdmin, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const uploadedFile = req.file || (req.files && req.files[0]);
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No file uploaded. Please select a .mcpack, .mcaddon, .mcworld, or .zip package.' });
    }

    try {
      const processedAddons = await addonService.processAddonUpload(uploadedFile.path, uploadedFile.originalname);
      logAudit(req.user.id, req.user.username, 'ADDON_UPLOAD', {
        originalName: uploadedFile.originalname,
        addons: processedAddons
      });

      return res.status(201).json({
        success: true,
        addons: processedAddons
      });
    } catch (processErr) {
      if (fs.existsSync(uploadedFile.path)) {
        try { fs.unlinkSync(uploadedFile.path); } catch (_) {}
      }
      console.error('[AddonsRoute] Error processing addon upload:', processErr);
      return res.status(500).json({ error: 'Failed to process addon package', details: processErr.message });
    }
  });
});

/**
 * POST /scan
 * (authenticate, requireAdmin) Disk Sync ("Scan Folders")
 */
router.post('/scan', authenticate, requireAdmin, (req, res) => {
  try {
    const result = addonService.scanDiskFolders();
    logAudit(req.user.id, req.user.username, 'ADDON_DISK_SCAN', result);
    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error during disk scan:', err);
    return res.status(500).json({ error: 'Failed to scan disk folders', details: err.message });
  }
});

/**
 * GET /active
 * (authenticate) get active addons for current world
 */
router.get('/active', authenticate, (req, res) => {
  try {
    let worldName = req.query.worldName;
    if (!worldName) {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      const properties = parseProperties(propsPath);
      worldName = properties['level-name'] || 'Bedrock level';
    }

    const activeAddons = addonService.getActiveAddons(worldName);
    return res.json({
      worldName,
      ...activeAddons
    });
  } catch (err) {
    console.error('[AddonsRoute] Error getting active addons:', err);
    return res.status(500).json({ error: 'Failed to get active addons', details: err.message });
  }
});

/**
 * PUT /active
 * (authenticate, requireAdmin) set active load order
 */
router.put('/active', authenticate, requireAdmin, (req, res) => {
  try {
    let { worldName, behaviorPacks, resourcePacks } = req.body;

    if (!worldName) {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      const properties = parseProperties(propsPath);
      worldName = properties['level-name'] || 'Bedrock level';
    }

    behaviorPacks = Array.isArray(behaviorPacks) ? behaviorPacks : [];
    resourcePacks = Array.isArray(resourcePacks) ? resourcePacks : [];

    const result = addonService.setActiveAddons(worldName, behaviorPacks, resourcePacks);
    logAudit(req.user.id, req.user.username, 'ADDON_SET_ACTIVE', {
      worldName,
      behaviorCount: behaviorPacks.length,
      resourceCount: resourcePacks.length
    });

    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error updating active addons:', err);
    return res.status(500).json({ error: 'Failed to set active addons', details: err.message });
  }
});

/**
 * POST /diagnostics
 * (authenticate) Run heuristics & Gemini AI diagnostics
 */
router.post('/diagnostics', authenticate, async (req, res) => {
  try {
    const userGeminiKey = req.headers['x-gemini-key'] || req.body?.geminiKey;
    const report = await addonService.runDiagnostics(userGeminiKey);
    return res.json(report);
  } catch (err) {
    console.error('[AddonsRoute] Error running diagnostics:', err);
    return res.status(500).json({ error: 'Failed to run diagnostics engine', details: err.message });
  }
});

/**
 * POST /autofix
 * (authenticate, requireAdmin) Execute 1-click auto-fix
 */
router.post('/autofix', authenticate, requireAdmin, (req, res) => {
  try {
    const { action, targetUuid } = req.body;
    if (!action || !targetUuid) {
      return res.status(400).json({ error: 'action and targetUuid are required' });
    }

    const result = addonService.executeAutoFix(action, targetUuid);
    logAudit(req.user.id, req.user.username, 'ADDON_AUTO_FIX', { action, targetUuid });
    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error executing autofix:', err);
    return res.status(400).json({ error: err.message || 'Failed to execute auto-fix' });
  }
});

/**
 * POST /bulk
 * (authenticate, requireAdmin) Bulk operations (enable_all, disable_all, delete_all)
 */
router.post('/bulk', authenticate, requireAdmin, async (req, res) => {
  try {
    const { action, uuids, includeCompanions } = req.body;
    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    const result = await addonService.executeBulk(action, uuids, { includeCompanions });
    logAudit(req.user.id, req.user.username, 'ADDON_BULK_ACTION', {
      action,
      count: Array.isArray(uuids) ? uuids.length : 'all',
      includeCompanions: Boolean(includeCompanions)
    });
    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error during bulk action:', err);
    return res.status(400).json({ error: err.message || 'Failed to execute bulk action' });
  }
});

/**
 * PUT /:uuid
 * (authenticate, requireAdmin) Update addon metadata (displayName, description, downloadUrl, notes, type, syncGroup)
 */
router.put('/:uuid', authenticate, requireAdmin, (req, res) => {
  try {
    const { uuid } = req.params;
    const result = addonService.updateAddonMetadata(uuid, req.body);
    logAudit(req.user.id, req.user.username, 'ADDON_METADATA_UPDATE', { uuid, changes: req.body });
    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error updating metadata:', err);
    return res.status(400).json({ error: err.message || 'Failed to update metadata' });
  }
});

/**
 * POST /:uuid/update
 * (authenticate, requireAdmin) In-Place Update (Upload Cloud Icon)
 */
router.post('/:uuid/update', authenticate, requireAdmin, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }

    const uploadedFile = req.file || (req.files && req.files[0]);
    if (!uploadedFile) {
      return res.status(400).json({ error: 'No replacement file uploaded.' });
    }

    try {
      const processedAddons = await addonService.processAddonUpload(uploadedFile.path, uploadedFile.originalname, {
        targetUuid: req.params.uuid
      });

      logAudit(req.user.id, req.user.username, 'ADDON_IN_PLACE_UPDATE', {
        targetUuid: req.params.uuid,
        originalName: uploadedFile.originalname,
        addons: processedAddons
      });

      return res.json({
        success: true,
        message: 'Addon updated in-place successfully.',
        addons: processedAddons
      });
    } catch (processErr) {
      if (fs.existsSync(uploadedFile.path)) {
        try { fs.unlinkSync(uploadedFile.path); } catch (_) {}
      }
      console.error('[AddonsRoute] Error during in-place update:', processErr);
      return res.status(500).json({ error: 'Failed to update addon package', details: processErr.message });
    }
  });
});

/**
 * DELETE /:uuid
 * (authenticate, requireAdmin) delete addon from server and active lists
 */
router.delete('/:uuid', authenticate, requireAdmin, async (req, res) => {
  try {
    const { uuid } = req.params;
    const deleteCompanion = req.query.deleteCompanion === 'true' || req.body?.deleteCompanion === true;
    const result = await addonService.deleteAddon(uuid, { deleteCompanion });
    logAudit(req.user.id, req.user.username, 'ADDON_DELETE', { uuid, deleteCompanion });
    return res.json(result);
  } catch (err) {
    console.error('[AddonsRoute] Error deleting addon:', err);
    return res.status(500).json({ error: 'Failed to delete addon', details: err.message });
  }
});

module.exports = router;
