const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');
const nbt = require('prismarine-nbt');
const config = require('../config');
const { parseProperties, writeProperties } = require('../utils/propertyParser');

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Get worlds directory from config
 */
function getWorldsDirectory() {
  return config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
}

/**
 * Recursively calculate folder size
 */
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
 * Recursively copy a directory
 */
function copyDirRecursive(src, dest) {
  ensureDir(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Safely sanitize a world folder name for Windows / Linux filesystem
 */
function sanitizeWorldFolderName(name) {
  if (!name || typeof name !== 'string') return 'Imported World';
  // Remove illegal characters: <>:"/\|?* and control characters
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
  // Strip trailing dots or spaces which are invalid on Windows
  clean = clean.replace(/[. ]+$/, '');
  return clean || 'Imported World';
}

/**
 * Search extracted folder for the directory containing level.dat
 */
function findWorldRoot(dir) {
  // Check if current dir has level.dat
  if (fs.existsSync(path.join(dir, 'level.dat'))) {
    return dir;
  }

  // Check subdirectories
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subDir = path.join(dir, entry.name);
      const found = findWorldRoot(subDir);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Inspect level.dat NBT for world name and game type
 */
async function parseLevelDatInfo(levelDatPath) {
  try {
    if (!fs.existsSync(levelDatPath)) return {};
    const rawBuf = fs.readFileSync(levelDatPath);
    if (rawBuf.length < 8) return {};

    const parsedData = await nbt.parse(rawBuf.subarray(8), 'little');
    const root = parsedData?.parsed?.value;
    if (!root) return {};

    const levelName = root.LevelName?.value || '';
    const gameTypeVal = root.GameType?.value;
    let gameMode = 'Survival';
    if (gameTypeVal === 1) gameMode = 'Creative';
    else if (gameTypeVal === 2) gameMode = 'Adventure';

    return {
      levelName,
      gameMode,
    };
  } catch (_) {
    return {};
  }
}

/**
 * Get icon path for a world if one exists
 */
function getWorldIconPath(worldName) {
  const worldsDir = getWorldsDirectory();
  const worldDir = path.join(worldsDir, worldName);
  const candidates = ['world_icon.jpeg', 'world_icon.jpg', 'world_icon.png'];
  for (const c of candidates) {
    const p = path.join(worldDir, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Get detailed metadata for a single world folder
 */
async function getWorldMetadata(worldName, activeWorldName) {
  const worldsDir = getWorldsDirectory();
  const fullPath = path.join(worldsDir, worldName);
  if (!fs.existsSync(fullPath)) return null;

  const stats = fs.statSync(fullPath);
  const size = getDirectorySize(fullPath);

  // Read levelname.txt
  let displayName = worldName;
  const levelNameTxtPath = path.join(fullPath, 'levelname.txt');
  if (fs.existsSync(levelNameTxtPath)) {
    try {
      const content = fs.readFileSync(levelNameTxtPath, 'utf8').trim();
      if (content) displayName = content;
    } catch (_) {}
  }

  // Read level.dat for extra info if levelname.txt didn't provide different name
  const levelDatPath = path.join(fullPath, 'level.dat');
  const hasLevelDat = fs.existsSync(levelDatPath);
  let gameMode = null;

  if (hasLevelDat) {
    const info = await parseLevelDatInfo(levelDatPath);
    if (info.levelName && displayName === worldName) {
      displayName = info.levelName;
    }
    if (info.gameMode) {
      gameMode = info.gameMode;
    }
  }

  const iconPath = getWorldIconPath(worldName);
  const hasIcon = Boolean(iconPath);

  return {
    name: worldName,
    displayName,
    path: fullPath,
    size,
    isActive: worldName === activeWorldName,
    hasLevelDat,
    hasIcon,
    iconUrl: hasIcon ? `/api/worlds/${encodeURIComponent(worldName)}/icon` : null,
    gameMode,
    lastModified: stats.mtime,
  };
}

/**
 * List all worlds with full details
 */
async function listWorlds() {
  const worldsDir = getWorldsDirectory();
  ensureDir(worldsDir);

  const propsPath = path.join(config.BDS_DIR, 'server.properties');
  const properties = parseProperties(propsPath);
  const activeWorldName = properties['level-name'] || 'Bedrock level';

  const entries = fs.readdirSync(worldsDir, { withFileTypes: true });
  const worlds = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const meta = await getWorldMetadata(entry.name, activeWorldName);
      if (meta) {
        worlds.push(meta);
      }
    }
  }

  // Sort: active world first, then alphabetically
  worlds.sort((a, b) => {
    if (a.isActive) return -1;
    if (b.isActive) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    activeWorld: activeWorldName,
    worlds,
  };
}

/**
 * Import a world from a .mcworld or .zip file
 */
async function importWorld(filePath, originalFilename = '', options = {}) {
  const tempExtractDir = path.join(
    config.UPLOAD_DIR,
    `temp-world-${Date.now()}-${Math.round(Math.random() * 1e6)}`
  );
  ensureDir(tempExtractDir);

  try {
    // 1. Extract uploaded archive
    const zipStream = fs.createReadStream(filePath).pipe(unzipper.Extract({ path: tempExtractDir }));
    await new Promise((resolve, reject) => {
      zipStream.on('close', resolve);
      zipStream.on('error', reject);
    });

    // 2. Discover the world root containing level.dat
    const worldRoot = findWorldRoot(tempExtractDir);
    if (!worldRoot) {
      throw new Error(
        'Invalid Bedrock world archive: "level.dat" was not found in the package. Ensure this is a valid .mcworld or Bedrock world zip.'
      );
    }

    // 3. Determine world name
    let detectedName = '';
    const levelNameTxtPath = path.join(worldRoot, 'levelname.txt');
    if (fs.existsSync(levelNameTxtPath)) {
      try {
        detectedName = fs.readFileSync(levelNameTxtPath, 'utf8').trim();
      } catch (_) {}
    }

    if (!detectedName) {
      const info = await parseLevelDatInfo(path.join(worldRoot, 'level.dat'));
      if (info.levelName) detectedName = info.levelName;
    }

    if (!detectedName && originalFilename) {
      detectedName = originalFilename.replace(/\.(mcworld|zip)$/i, '').trim();
    }

    // Custom name from user options takes precedence
    const finalDisplayName = (options.targetName && options.targetName.trim())
      ? options.targetName.trim()
      : (detectedName || 'Imported World');

    const baseFolderName = sanitizeWorldFolderName(finalDisplayName);
    const worldsDir = getWorldsDirectory();
    ensureDir(worldsDir);

    let targetFolderName = baseFolderName;
    let targetWorldDir = path.join(worldsDir, targetFolderName);

    // 4. Handle collisions
    const overwrite = Boolean(options.overwrite);
    if (fs.existsSync(targetWorldDir)) {
      if (overwrite) {
        // Prevent deleting active world if it's currently running
        fs.rmSync(targetWorldDir, { recursive: true, force: true });
      } else {
        // Find next non-conflicting name
        let counter = 1;
        while (fs.existsSync(path.join(worldsDir, `${baseFolderName} (${counter})`))) {
          counter++;
        }
        targetFolderName = `${baseFolderName} (${counter})`;
        targetWorldDir = path.join(worldsDir, targetFolderName);
      }
    }

    // 5. Move or copy files into destination worlds folder
    copyDirRecursive(worldRoot, targetWorldDir);

    // Ensure levelname.txt matches final display name
    try {
      fs.writeFileSync(path.join(targetWorldDir, 'levelname.txt'), finalDisplayName, 'utf8');
    } catch (_) {}

    // 6. Optionally activate world immediately
    let wasActivated = false;
    const shouldSetActive = Boolean(options.setActive);
    if (shouldSetActive) {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      const properties = parseProperties(propsPath);
      properties['level-name'] = targetFolderName;
      writeProperties(propsPath, properties);
      wasActivated = true;
    }

    // Read active world to return accurate metadata
    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    const currentActive = properties['level-name'] || 'Bedrock level';

    const resultMeta = await getWorldMetadata(targetFolderName, currentActive);

    return {
      success: true,
      world: resultMeta,
      wasActivated,
      message: wasActivated
        ? `World "${finalDisplayName}" imported and set as active! Restart server to load it.`
        : `World "${finalDisplayName}" imported successfully.`,
    };
  } finally {
    // Cleanup temporary extraction folder and uploaded temp file
    try {
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
    } catch (_) {}

    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }
}

/**
 * Export a world folder as a .mcworld (zip) stream
 */
function exportWorld(worldName, res) {
  const worldsDir = getWorldsDirectory();
  const worldPath = path.join(worldsDir, worldName);

  if (!fs.existsSync(worldPath)) {
    throw new Error(`World "${worldName}" does not exist.`);
  }

  const safeFilename = sanitizeWorldFolderName(worldName).replace(/\s+/g, '_');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeFilename)}.mcworld"`);

  const archive = archiver('zip', {
    zlib: { level: 9 },
  });

  archive.on('error', (err) => {
    console.error('[WorldExport] Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to package world for export', details: err.message });
    }
  });

  archive.pipe(res);
  archive.directory(worldPath, false);
  archive.finalize();
}

module.exports = {
  getWorldsDirectory,
  getDirectorySize,
  getWorldIconPath,
  getWorldMetadata,
  listWorlds,
  importWorld,
  exportWorld,
  sanitizeWorldFolderName,
};
