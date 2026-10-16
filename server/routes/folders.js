const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const config = require('../config');
const db = require('../database');
const serverProcess = require('../services/serverProcess');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { parseProperties, writeProperties, sanitizeProperties, getDefaultProperties } = require('../utils/propertyParser');
const { logAudit } = require('../services/auditService');

const router = express.Router();

function getDirSize(dirPath) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(full);
      } else if (entry.isFile()) {
        const stats = fs.statSync(full);
        total += stats.size;
      }
    }
  } catch (_) {}
  return total;
}

function categorizeItem(name, isDirectory) {
  if (isDirectory) {
    if (name.toLowerCase() === 'worlds') return 'world';
    if (name.toLowerCase().includes('pack')) return 'pack';
    return 'folder';
  }
  const lower = name.toLowerCase();
  if (lower === 'server.properties') return 'config';
  if (lower.endsWith('.json')) return 'config';
  if (lower.endsWith('.exe') || lower === 'bedrock_server') return 'binary';
  if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'log';
  return 'file';
}

/**
 * GET /api/folders
 * Returns complete folder hierarchy, status, contents, worlds, and settings
 */
router.get('/', authenticate, (req, res) => {
  try {
    const bdsDir = config.BDS_DIR;
    const worldsDir = config.WORLDS_DIR;
    const defaultBdsDir = config._defaultBdsDir;
    const defaultWorldsDir = config._defaultWorldsDir;
    const isCustomBdsDir = Boolean(db.getSetting('custom_bds_dir'));
    const isCustomWorldsDir = Boolean(db.getSetting('custom_worlds_dir'));

    const serverPropertiesPath = path.join(bdsDir, 'server.properties');
    const serverPropertiesExists = fs.existsSync(serverPropertiesPath);

    let serverPropertiesStats = null;
    let properties = {};
    if (serverPropertiesExists) {
      try {
        const stats = fs.statSync(serverPropertiesPath);
        properties = parseProperties(serverPropertiesPath);
        serverPropertiesStats = {
          size: stats.size,
          lastModified: stats.mtime,
          keysCount: Object.keys(properties).length,
        };
      } catch (err) {
        console.warn('[FoldersRoute] Could not read server.properties:', err.message);
      }
    } else {
      properties = getDefaultProperties();
    }

    const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
    const bedrockExecutableExists = fs.existsSync(path.join(bdsDir, exeName));
    const activeWorld = properties['level-name'] || 'Bedrock level';

    // List top-level items in BDS directory
    const bdsContents = [];
    if (fs.existsSync(bdsDir)) {
      try {
        const entries = fs.readdirSync(bdsDir, { withFileTypes: true });
        for (const entry of entries) {
          const itemPath = path.join(bdsDir, entry.name);
          try {
            const isDir = entry.isDirectory();
            const stats = fs.statSync(itemPath);
            bdsContents.push({
              name: entry.name,
              path: itemPath,
              isDirectory: isDir,
              size: isDir ? null : stats.size,
              lastModified: stats.mtime,
              category: categorizeItem(entry.name, isDir),
            });
          } catch (_) {}
        }
        // Sort: folders first, then files alphabetically
        bdsContents.sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
      } catch (err) {
        console.warn('[FoldersRoute] Could not read BDS dir contents:', err.message);
      }
    }

    // List worlds in worlds directory
    const worlds = [];
    if (fs.existsSync(worldsDir)) {
      try {
        const entries = fs.readdirSync(worldsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const worldPath = path.join(worldsDir, entry.name);
            const stats = fs.statSync(worldPath);
            const size = getDirSize(worldPath);
            worlds.push({
              name: entry.name,
              path: worldPath,
              size,
              isActive: entry.name === activeWorld,
              lastModified: stats.mtime,
            });
          }
        }
      } catch (err) {
        console.warn('[FoldersRoute] Could not list worlds:', err.message);
      }
    }

    return res.json({
      success: true,
      bdsDir,
      defaultBdsDir,
      isCustomBdsDir,
      bdsDirExists: fs.existsSync(bdsDir),
      worldsDir,
      defaultWorldsDir,
      isCustomWorldsDir,
      worldsDirExists: fs.existsSync(worldsDir),
      serverPropertiesPath,
      serverPropertiesExists,
      serverPropertiesStats,
      bedrockExecutableExists,
      serverState: serverProcess.state,
      activeWorld,
      worlds,
      bdsContents,
      properties,
    });
  } catch (err) {
    console.error('[FoldersRoute] Error in GET /api/folders:', err);
    return res.status(500).json({ error: 'Failed to inspect server folders', details: err.message });
  }
});

/**
 * POST /api/folders/validate-path
 * Check if a proposed folder path exists and what it contains
 */
router.post('/validate-path', authenticate, requireAdmin, (req, res) => {
  try {
    const { folderPath } = req.body;
    if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) {
      return res.status(400).json({ error: 'Folder path is required.' });
    }

    const resolved = path.resolve(folderPath.trim());
    const exists = fs.existsSync(resolved);

    if (!exists) {
      return res.json({
        path: resolved,
        exists: false,
        isDirectory: false,
        hasProperties: false,
        hasWorlds: false,
        hasExecutable: false,
      });
    }

    const stats = fs.statSync(resolved);
    const isDirectory = stats.isDirectory();

    const hasProperties = fs.existsSync(path.join(resolved, 'server.properties'));
    const hasWorlds = fs.existsSync(path.join(resolved, 'worlds'));
    const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
    const hasExecutable = fs.existsSync(path.join(resolved, exeName));

    return res.json({
      path: resolved,
      exists: true,
      isDirectory,
      hasProperties,
      hasWorlds,
      hasExecutable,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/folders/set-bds-dir
 * Change the BDS root folder path (where server.properties, worlds, etc. are stored)
 */
router.post('/set-bds-dir', authenticate, requireAdmin, (req, res) => {
  try {
    const { folderPath, createIfMissing } = req.body;
    if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) {
      return res.status(400).json({ error: 'Folder path is required.' });
    }

    const resolved = path.resolve(folderPath.trim());

    if (!fs.existsSync(resolved)) {
      if (createIfMissing) {
        fs.mkdirSync(resolved, { recursive: true });
      } else {
        return res.status(400).json({ error: `Directory does not exist: "${resolved}". Enable "create if missing" to create it.` });
      }
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: "${resolved}"` });
    }

    // Ensure server.properties exists in new folder or create template
    const propsPath = path.join(resolved, 'server.properties');
    if (!fs.existsSync(propsPath)) {
      const defaults = getDefaultProperties();
      writeProperties(propsPath, defaults);
    }

    // Ensure worlds directory exists
    const worldsPath = path.join(resolved, 'worlds');
    if (!fs.existsSync(worldsPath)) {
      fs.mkdirSync(worldsPath, { recursive: true });
    }

    // Persist in DB settings
    db.setSetting('custom_bds_dir', resolved);
    config.BDS_DIR = resolved;

    logAudit(req.user.id, req.user.username, 'SET_BDS_DIR', { newBdsDir: resolved });

    return res.json({
      success: true,
      message: `Server folder changed to "${resolved}". Restart the server for changes to take effect.`,
      bdsDir: resolved,
      worldsDir: config.WORLDS_DIR,
    });
  } catch (err) {
    console.error('[FoldersRoute] Error setting BDS dir:', err);
    return res.status(500).json({ error: 'Failed to set BDS folder', details: err.message });
  }
});

/**
 * POST /api/folders/reset-bds-dir
 * Reset BDS root folder to default installation path
 */
router.post('/reset-bds-dir', authenticate, requireAdmin, (req, res) => {
  try {
    db.setSetting('custom_bds_dir', '');
    config.BDS_DIR = null; // Clear override

    logAudit(req.user.id, req.user.username, 'RESET_BDS_DIR', { restoredDefault: config.BDS_DIR });

    return res.json({
      success: true,
      message: `Server folder reset to default: "${config.BDS_DIR}".`,
      bdsDir: config.BDS_DIR,
      worldsDir: config.WORLDS_DIR,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset BDS directory', details: err.message });
  }
});

/**
 * POST /api/folders/set-worlds-dir
 * Set a custom Worlds directory
 */
router.post('/set-worlds-dir', authenticate, requireAdmin, (req, res) => {
  try {
    const { folderPath, createIfMissing } = req.body;
    if (!folderPath || typeof folderPath !== 'string' || !folderPath.trim()) {
      return res.status(400).json({ error: 'Worlds folder path is required.' });
    }

    const resolved = path.resolve(folderPath.trim());

    if (!fs.existsSync(resolved)) {
      if (createIfMissing) {
        fs.mkdirSync(resolved, { recursive: true });
      } else {
        return res.status(400).json({ error: `Directory does not exist: "${resolved}".` });
      }
    }

    const stats = fs.statSync(resolved);
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: "${resolved}"` });
    }

    db.setSetting('custom_worlds_dir', resolved);
    config.WORLDS_DIR = resolved;

    logAudit(req.user.id, req.user.username, 'SET_WORLDS_DIR', { newWorldsDir: resolved });

    return res.json({
      success: true,
      message: `Worlds folder changed to "${resolved}".`,
      worldsDir: resolved,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to set worlds directory', details: err.message });
  }
});

/**
 * POST /api/folders/reset-worlds-dir
 * Reset Worlds folder to default ($BDS_DIR/worlds)
 */
router.post('/reset-worlds-dir', authenticate, requireAdmin, (req, res) => {
  try {
    db.setSetting('custom_worlds_dir', '');
    config.WORLDS_DIR = null;

    logAudit(req.user.id, req.user.username, 'RESET_WORLDS_DIR', { restoredDefault: config.WORLDS_DIR });

    return res.json({
      success: true,
      message: `Worlds folder reset to default: "${config.WORLDS_DIR}".`,
      worldsDir: config.WORLDS_DIR,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to reset worlds directory', details: err.message });
  }
});

/**
 * POST /api/folders/create-world
 * Add/Create a new world folder in worlds/ directory, optionally setting it as active level
 */
router.post('/create-world', authenticate, requireAdmin, (req, res) => {
  try {
    const { worldName, setActive = false, gameMode, seed } = req.body;
    if (!worldName || typeof worldName !== 'string' || !worldName.trim()) {
      return res.status(400).json({ error: 'World folder name is required.' });
    }

    const cleanName = worldName.trim().replace(/[\\/:*?"<>|]/g, '');
    if (!cleanName) {
      return res.status(400).json({ error: 'Invalid characters in world folder name.' });
    }

    const worldsDir = config.WORLDS_DIR;
    if (!fs.existsSync(worldsDir)) {
      fs.mkdirSync(worldsDir, { recursive: true });
    }

    const targetWorldPath = path.join(worldsDir, cleanName);

    // Prevent path traversal
    const rel = path.relative(worldsDir, targetWorldPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ error: 'Invalid world path traversal detected.' });
    }

    if (fs.existsSync(targetWorldPath)) {
      return res.status(400).json({ error: `A world folder named "${cleanName}" already exists.` });
    }

    fs.mkdirSync(targetWorldPath, { recursive: true });

    // Optionally set as active world in server.properties
    if (setActive || gameMode || seed) {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      const props = parseProperties(propsPath);
      if (setActive) {
        props['level-name'] = cleanName;
      }
      if (gameMode) {
        props['gamemode'] = gameMode;
      }
      if (seed) {
        props['level-seed'] = seed;
      }
      writeProperties(propsPath, props);
    }

    logAudit(req.user.id, req.user.username, 'CREATE_WORLD_FOLDER', {
      worldName: cleanName,
      path: targetWorldPath,
      setActive: Boolean(setActive),
    });

    return res.json({
      success: true,
      message: `World folder "${cleanName}" was created successfully!${setActive ? ' It has been set as the active world.' : ''}`,
      world: {
        name: cleanName,
        path: targetWorldPath,
        isActive: Boolean(setActive),
        size: 0,
        lastModified: new Date(),
      },
    });
  } catch (err) {
    console.error('[FoldersRoute] Error creating world folder:', err);
    return res.status(500).json({ error: 'Failed to create world folder', details: err.message });
  }
});

/**
 * POST /api/folders/create-folder
 * Add/Create a subfolder in BDS root or worlds directory
 */
router.post('/create-folder', authenticate, requireAdmin, (req, res) => {
  try {
    const { parent = 'bds', folderName } = req.body;
    if (!folderName || typeof folderName !== 'string' || !folderName.trim()) {
      return res.status(400).json({ error: 'Folder name is required.' });
    }

    const cleanName = folderName.trim().replace(/[\\/:*?"<>|]/g, '');
    const parentDir = parent === 'worlds' ? config.WORLDS_DIR : config.BDS_DIR;
    const targetDir = path.join(parentDir, cleanName);

    const rel = path.relative(parentDir, targetDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return res.status(400).json({ error: 'Invalid folder traversal detected.' });
    }

    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Folder "${cleanName}" already exists.` });
    }

    fs.mkdirSync(targetDir, { recursive: true });

    logAudit(req.user.id, req.user.username, 'CREATE_SUBFOLDER', { parent, folderName: cleanName, path: targetDir });

    return res.json({
      success: true,
      message: `Folder "${cleanName}" created successfully in ${parent === 'worlds' ? 'worlds' : 'server root'}.`,
      folderPath: targetDir,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create folder', details: err.message });
  }
});

/**
 * POST /api/folders/open-explorer
 * Open the folder in the local OS file explorer (Windows Explorer)
 */
router.post('/open-explorer', authenticate, requireAdmin, (req, res) => {
  try {
    const { target = 'bds' } = req.body;
    let targetPath = config.BDS_DIR;
    if (target === 'worlds') {
      targetPath = config.WORLDS_DIR;
    } else if (target === 'properties') {
      targetPath = path.join(config.BDS_DIR, 'server.properties');
    }

    if (process.platform === 'win32') {
      const command = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()
        ? `explorer.exe /select,"${targetPath}"`
        : `explorer.exe "${targetPath}"`;

      exec(command, (err) => {
        if (err) console.warn('[FoldersRoute] Explorer command warning:', err.message);
      });

      return res.json({
        success: true,
        message: `Opened in Windows Explorer: "${targetPath}"`,
        path: targetPath,
      });
    }

    return res.json({
      success: true,
      message: `File path: "${targetPath}"`,
      path: targetPath,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to open file explorer', details: err.message });
  }
});

/**
 * PUT /api/folders/settings-changer
 * Instant settings changer for server.properties
 */
router.put('/settings-changer', authenticate, requireAdmin, (req, res) => {
  try {
    const { properties } = req.body;
    if (!properties || typeof properties !== 'object') {
      return res.status(400).json({ error: 'Properties object is required.' });
    }

    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const existing = parseProperties(propsPath);

    const merged = { ...existing, ...properties };
    const sanitized = sanitizeProperties(merged);

    writeProperties(propsPath, sanitized);

    logAudit(req.user.id, req.user.username, 'SETTINGS_CHANGER_UPDATE', {
      changedKeys: Object.keys(properties),
    });

    return res.json({
      success: true,
      message: 'Server properties updated successfully! Restart the server to apply any changes in effect.',
      properties: sanitized,
    });
  } catch (err) {
    console.error('[FoldersRoute] Error updating settings:', err);
    return res.status(500).json({ error: 'Failed to update server properties', details: err.message });
  }
});

module.exports = router;
