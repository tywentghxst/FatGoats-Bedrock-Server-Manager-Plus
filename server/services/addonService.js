const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');
const db = require('../database');
const config = require('../config');

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Atomic JSON write to avoid file corruption during crash or power loss
 */
function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tempPath = path.join(dir, `.tmp-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // Windows file lock or permissions fallback
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch (fallbackErr) {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

/**
 * Copy directory recursively
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
 * Recursively find manifest.json inside a directory.
 * If nested inside subfolders, returns directories containing manifest.json.
 */
function findManifestDirs(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const hasManifest = entries.some(e => e.isFile() && e.name.toLowerCase() === 'manifest.json');
  if (hasManifest) {
    results.push(dir);
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const subResults = findManifestDirs(path.join(dir, entry.name));
      results.push(...subResults);
    }
  }

  return results;
}

/**
 * Recursively extract any nested .mcpack, .mcaddon, or .zip archives found in the directory
 */
async function extractNestedArchives(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await extractNestedArchives(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.mcpack' || ext === '.mcaddon' || ext === '.zip') {
        const nestedDest = path.join(dir, path.basename(entry.name, ext));
        ensureDir(nestedDest);
        try {
          const zipStream = fs.createReadStream(fullPath).pipe(unzipper.Extract({ path: nestedDest }));
          await new Promise((resolve, reject) => {
            zipStream.on('close', resolve);
            zipStream.on('error', reject);
          });
          try { fs.unlinkSync(fullPath); } catch (_) {}
          await extractNestedArchives(nestedDest);
        } catch (err) {
          console.warn(`[AddonService] Could not extract nested archive ${entry.name}:`, err.message);
        }
      }
    }
  }
}

/**
 * Clean human-readable display name from original uploaded filename
 */
function sanitizeAddonFilename(filename = '') {
  if (!filename) return '';
  let clean = path.basename(filename);
  clean = clean.replace(/\.(mcaddon|mcpack|zip)$/i, '');
  clean = clean.replace(/\s*\((?:addon|bp|rp|behavior|resource|pack)\)\s*/gi, ' ');
  clean = clean.replace(/\[(?:bp|rp|behavior|resource|pack)\]/gi, ' ');
  clean = clean.replace(/[_\-]+/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
}

/**
 * Scan packDir/texts/*.lang to resolve localization keys like pack.name or pack.description
 */
function parseLangFile(packDir) {
  const textsDir = path.join(packDir, 'texts');
  if (!fs.existsSync(textsDir)) return {};

  const candidates = ['en_US.lang', 'en_GB.lang'];
  try {
    const files = fs.readdirSync(textsDir);
    for (const f of files) {
      if (f.endsWith('.lang') && !candidates.includes(f)) {
        candidates.push(f);
      }
    }
  } catch (_) {}

  const result = {};
  for (const candidate of candidates) {
    const langFile = path.join(textsDir, candidate);
    if (fs.existsSync(langFile)) {
      try {
        const lines = fs.readFileSync(langFile, 'utf8').split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('##') || trimmed.startsWith('//')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (key && val && !result[key]) {
              result[key] = val;
            }
          }
        }
        if (result['pack.name']) break;
      } catch (_) {}
    }
  }
  return result;
}

const UUID_FOLDER_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Detect if a pack is an internal Mojang/BDS engine system addon (shipped with the server)
 */
function isSystemPack(folderOrName, manifestName = '', packPath = '') {
  const f = path.basename(packPath || folderOrName || '').toLowerCase();
  const n = (manifestName || '').toLowerCase();
  const orig = (folderOrName || '').toLowerCase();

  // If the folder is named as a UUID, it was installed by the user/manager and is NEVER a vanilla system pack
  if (UUID_FOLDER_REGEX.test(f)) {
    return false;
  }

  // If it was uploaded from an addon archive, it is never a vanilla system pack
  if (orig.endsWith('.mcaddon') || orig.endsWith('.mcpack') || orig.endsWith('.zip')) {
    return false;
  }

  return (
    f.startsWith('vanilla') ||
    f.startsWith('chemistry') ||
    f.startsWith('editor') ||
    f.startsWith('experimental_') ||
    f.startsWith('server_') ||
    f.includes('gametest') ||
    orig.startsWith('vanilla') ||
    orig.startsWith('chemistry') ||
    orig.startsWith('editor') ||
    orig.startsWith('experimental_') ||
    orig.startsWith('server_') ||
    orig.includes('gametest') ||
    n.startsWith('resourcepack.editor') ||
    n.startsWith('resourcepack.vanilla') ||
    n.startsWith('resourcepack.experimental') ||
    n.startsWith('behaviorpack.vanilla')
  );
}

/**
 * Migration helper to ensure system packs in DB are marked is_system = 1,
 * user addons are kept is_system = 0, and any 'pack.name' placeholders are replaced.
 */
function syncSystemPacksFlag() {
  try {
    const all = db.prepare('SELECT id, name, display_name, original_filename, path FROM addons').all();
    const markSysStmt = db.prepare('UPDATE addons SET is_system = 1 WHERE id = ?');
    const unmarkSysStmt = db.prepare('UPDATE addons SET is_system = 0 WHERE id = ?');
    const updateTitleStmt = db.prepare('UPDATE addons SET display_name = ? WHERE id = ?');

    for (const a of all) {
      if (isSystemPack(a.original_filename || a.name, a.name, a.path)) {
        markSysStmt.run(a.id);
      } else {
        unmarkSysStmt.run(a.id);
      }

      if (a.name === 'pack.name' || !a.display_name || a.display_name === 'pack.name') {
        const cleanName = sanitizeAddonFilename(a.original_filename || a.name);
        if (cleanName && cleanName !== 'pack.name') {
          updateTitleStmt.run(cleanName, a.id);
        }
      }
    }
  } catch (err) {
    // Database might still be initializing or table not yet created
  }
}

// Ensure existing scanned packs are tagged
setTimeout(() => {
  syncSystemPacksFlag();
}, 1000);

/**
 * Parse manifest and determine whether it's Behavior or Resource Pack
 */
function parseManifest(manifestPath, packDir, fallbackFilename = '') {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  const header = manifest.header || {};
  const uuid = header.uuid;
  let name = header.name || '';
  let description = header.description || '';
  const versionArr = Array.isArray(header.version) ? header.version : [1, 0, 0];
  const version = versionArr.join('.');
  const formatVersion = manifest.format_version || 1;
  const minEngineVersion = header.min_engine_version || null;

  if (!uuid) {
    throw new Error('manifest.json is missing required header.uuid property');
  }

  // Parse localization if name or description uses tokens (e.g. pack.name)
  const isNameToken = !name || name === 'pack.name' || name.startsWith('pack.');
  const isDescToken = !description || description === 'pack.description' || description.startsWith('pack.');

  if (isNameToken || isDescToken) {
    const lang = parseLangFile(packDir);
    if (isNameToken && lang['pack.name']) {
      name = lang['pack.name'];
    } else if (isNameToken && lang[header.name]) {
      name = lang[header.name];
    }

    if (isDescToken && lang['pack.description']) {
      description = lang['pack.description'];
    } else if (isDescToken && lang[header.description]) {
      description = lang[header.description];
    }
  }

  // Fallback to filename if still unresolved
  if (!name || name === 'pack.name' || name.startsWith('pack.')) {
    const cleanFromFilename = sanitizeAddonFilename(fallbackFilename);
    name = cleanFromFilename || 'Custom Add-On';
  }

  if (!description || description === 'pack.description' || description.startsWith('pack.')) {
    description = '';
  }

  const modules = Array.isArray(manifest.modules) ? manifest.modules : [];
  const hasResourceModule = modules.some(m => m.type === 'resources');
  const hasDataModule = modules.some(m => m.type === 'data' || m.type === 'javascript' || m.type === 'world_template');

  let type = 'behavior';
  if (hasResourceModule && !hasDataModule) {
    type = 'resource';
  } else if (hasResourceModule) {
    const lowerDir = packDir.toLowerCase();
    if (lowerDir.includes('resource') || lowerDir.includes('rp')) {
      type = 'resource';
    } else {
      type = 'behavior';
    }
  } else {
    type = 'behavior';
  }

  return {
    uuid,
    name,
    description,
    version,
    versionArr,
    type,
    formatVersion,
    minEngineVersion,
    modules
  };
}

/**
 * Get active world level-name from server.properties
 */
function getActiveWorldName() {
  try {
    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    if (fs.existsSync(propsPath)) {
      const propsContent = fs.readFileSync(propsPath, 'utf8');
      const match = propsContent.match(/^level-name\s*=\s*(.+)$/m);
      if (match && match[1].trim()) {
        return match[1].trim();
      }
    }
  } catch (_) {}
  return 'Bedrock level';
}

/**
 * processAddonUpload(filePath, originalFilename, options = {}):
 * Extracts .mcpack, .mcaddon, .mcworld, .zip.
 * Automatically links multiple packs with a shared group_id.
 * Preserves settings on in-place updates.
 */
async function processAddonUpload(filePath, originalFilename = '', options = {}) {
  const tempExtractDir = path.join(config.UPLOAD_DIR, `temp-extract-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  ensureDir(tempExtractDir);

  try {
    // 1. Extract outer archive
    const zip = fs.createReadStream(filePath).pipe(unzipper.Extract({ path: tempExtractDir }));
    await new Promise((resolve, reject) => {
      zip.on('close', resolve);
      zip.on('error', reject);
    });

    // 2. Extract any nested .mcpack, .mcaddon, or .zip archives
    await extractNestedArchives(tempExtractDir);

    // 3. Discover manifest.json directories
    const manifestDirs = findManifestDirs(tempExtractDir);

    if (manifestDirs.length === 0) {
      throw new Error('Invalid addon archive: manifest.json was not found in the package or its nested packs.');
    }

    // Shared Group ID for paired packs in .mcaddon bundles
    const isMultiPack = manifestDirs.length > 1;
    const groupId = isMultiPack ? `group-${Date.now()}-${Math.round(Math.random() * 1000)}` : null;

    const processedAddons = [];

    for (const packDir of manifestDirs) {
      const manifestPath = path.join(packDir, 'manifest.json');
      const parsed = parseManifest(manifestPath, packDir, originalFilename);
      const cleanDisplayName = parsed.name || sanitizeAddonFilename(originalFilename);

      const targetSubdir = parsed.type === 'resource' ? 'resource_packs' : 'behavior_packs';
      const destPacksDir = path.join(config.BDS_DIR, targetSubdir);
      ensureDir(destPacksDir);

      // Safe folder name on disk: use UUID
      const destPackPath = path.join(destPacksDir, parsed.uuid);

      // In-place replacement: if folder exists, replace contents
      if (fs.existsSync(destPackPath)) {
        try { fs.rmSync(destPackPath, { recursive: true, force: true }); } catch (_) {}
      }

      copyDirRecursive(packDir, destPackPath);

      // Check for pack_icon.png
      let hasIcon = false;
      const iconCandidates = ['pack_icon.png', 'pack_icon.jpeg', 'pack_icon.jpg'];
      for (const ic of iconCandidates) {
        if (fs.existsSync(path.join(destPackPath, ic))) {
          hasIcon = true;
          break;
        }
      }

      // Upsert into SQLite
      const existing = db.prepare('SELECT id, display_name, download_url, notes FROM addons WHERE uuid = ?').get(parsed.uuid);
      if (existing) {
        const updateStmt = db.prepare(`
          UPDATE addons
          SET name = ?, type = ?, version = ?, description = ?, path = ?,
              group_id = COALESCE(?, group_id),
              original_filename = COALESCE(NULLIF(?, ''), original_filename),
              display_name = CASE WHEN display_name IS NULL OR display_name = '' OR display_name = 'pack.name' THEN ? ELSE display_name END,
              is_system = 0
          WHERE uuid = ?
        `);
        updateStmt.run(parsed.name, parsed.type, parsed.version, parsed.description, destPackPath, groupId, originalFilename, cleanDisplayName, parsed.uuid);
      } else {
        const insertStmt = db.prepare(`
          INSERT INTO addons (uuid, name, type, version, description, path, group_id, original_filename, download_url, display_name, notes, is_system)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, '', 0)
        `);
        insertStmt.run(parsed.uuid, parsed.name, parsed.type, parsed.version, parsed.description, destPackPath, groupId, originalFilename, cleanDisplayName);
      }

      processedAddons.push({
        uuid: parsed.uuid,
        name: parsed.name,
        displayName: cleanDisplayName,
        type: parsed.type,
        version: parsed.version,
        description: parsed.description,
        groupId,
        originalFilename,
        hasIcon,
        path: destPackPath
      });
    }

    // 4. Auto-activate installed packs in active world if not specifically disabled
    if (options.autoActivate !== false) {
      try {
        const activeWorld = getActiveWorldName();
        const active = getActiveAddons(activeWorld);
        const curBP = [...active.behaviorPacks];
        const curRP = [...active.resourcePacks];

        for (const addon of processedAddons) {
          const packVersion = typeof addon.version === 'string'
            ? addon.version.split('.').map(n => parseInt(n, 10) || 0)
            : (Array.isArray(addon.version) ? addon.version : [1, 0, 0]);

          if (addon.type === 'resource') {
            if (!curRP.some(p => p.uuid === addon.uuid)) {
              curRP.push({ uuid: addon.uuid, version: packVersion, name: addon.name });
            }
          } else {
            if (!curBP.some(p => p.uuid === addon.uuid)) {
              curBP.push({ uuid: addon.uuid, version: packVersion, name: addon.name });
            }
          }
        }

        setActiveAddons(activeWorld, curBP, curRP);
      } catch (actErr) {
        console.warn('[AddonService] Auto-activation notice:', actErr.message);
      }
    }

    return processedAddons;
  } finally {
    if (fs.existsSync(tempExtractDir)) {
      try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (_) {}
    }
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

/**
 * Get pack icon file path
 */
function getPackIconPath(uuid) {
  const addon = db.prepare('SELECT path FROM addons WHERE uuid = ?').get(uuid);
  if (!addon || !addon.path || !fs.existsSync(addon.path)) {
    return null;
  }

  const iconNames = ['pack_icon.png', 'pack_icon.jpeg', 'pack_icon.jpg'];
  for (const name of iconNames) {
    const full = path.join(addon.path, name);
    if (fs.existsSync(full)) {
      return full;
    }
  }
  return null;
}

/**
 * Scan disk folders (behavior_packs and resource_packs) to discover packs added manually via SFTP / copy
 */
function scanDiskFolders() {
  const folders = [
    { type: 'behavior', dir: path.join(config.BDS_DIR, 'behavior_packs') },
    { type: 'resource', dir: path.join(config.BDS_DIR, 'resource_packs') }
  ];

  let scannedCount = 0;
  let newCount = 0;
  let updatedCount = 0;

  for (const { type, dir } of folders) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const packDir = path.join(dir, entry.name);
      const manifestPath = path.join(packDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;

      scannedCount++;
      try {
        const parsed = parseManifest(manifestPath, packDir, entry.name);
        const existing = db.prepare('SELECT id, display_name FROM addons WHERE uuid = ?').get(parsed.uuid);
        const isSys = isSystemPack(entry.name, parsed.name, packDir) ? 1 : 0;
        const cleanDisplayName = parsed.name || sanitizeAddonFilename(entry.name);

        if (existing) {
          const updateStmt = db.prepare(`
            UPDATE addons
            SET name = ?, type = ?, version = ?, description = ?, path = ?, is_system = ?,
                display_name = CASE WHEN display_name IS NULL OR display_name = '' OR display_name = 'pack.name' THEN ? ELSE display_name END
            WHERE uuid = ?
          `);
          updateStmt.run(parsed.name, type, parsed.version, parsed.description, packDir, isSys, cleanDisplayName, parsed.uuid);
          updatedCount++;
        } else {
          const insertStmt = db.prepare(`
            INSERT INTO addons (uuid, name, type, version, description, path, original_filename, is_system, display_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          insertStmt.run(parsed.uuid, parsed.name, type, parsed.version, parsed.description, packDir, entry.name, isSys, cleanDisplayName);
          newCount++;
        }
      } catch (err) {
        console.warn(`[AddonService] Error scanning ${entry.name}:`, err.message);
      }
    }
  }

  return {
    success: true,
    scannedCount,
    newCount,
    updatedCount,
    message: `Disk scan completed: ${scannedCount} pack(s) found on disk (${newCount} new, ${updatedCount} updated).`
  };
}

/**
 * listAddons():
 * Query all addons from database with complete metadata.
 */
function listAddons() {
  const addons = db.prepare(`
    SELECT id, uuid, name, type, version, description, path,
           group_id, original_filename, download_url, display_name, notes, is_system, created_at
    FROM addons
    ORDER BY created_at DESC
  `).all();

  return addons.map(addon => {
    let hasIcon = false;
    if (addon.path && fs.existsSync(addon.path)) {
      hasIcon = fs.existsSync(path.join(addon.path, 'pack_icon.png')) ||
                fs.existsSync(path.join(addon.path, 'pack_icon.jpeg')) ||
                fs.existsSync(path.join(addon.path, 'pack_icon.jpg'));
    }

    return {
      ...addon,
      is_system: Boolean(addon.is_system),
      hasIcon,
      installed: addon.path ? fs.existsSync(addon.path) : false
    };
  });
}

/**
 * updateAddonMetadata(uuid, data):
 * Updates display name, description, download URL, notes, and handles physical category move on disk.
 */
function updateAddonMetadata(uuid, data = {}) {
  const addon = db.prepare('SELECT * FROM addons WHERE uuid = ?').get(uuid);
  if (!addon) {
    throw new Error(`Addon with UUID "${uuid}" was not found.`);
  }

  let currentPath = addon.path;
  let currentType = addon.type;

  // Handle Type / Category switch if requested
  if (data.type && data.type !== addon.type && (data.type === 'behavior' || data.type === 'resource')) {
    const newSubdir = data.type === 'resource' ? 'resource_packs' : 'behavior_packs';
    const newTargetDir = path.join(config.BDS_DIR, newSubdir, uuid);

    if (fs.existsSync(currentPath)) {
      ensureDir(path.dirname(newTargetDir));
      if (fs.existsSync(newTargetDir)) {
        fs.rmSync(newTargetDir, { recursive: true, force: true });
      }
      fs.renameSync(currentPath, newTargetDir);
      currentPath = newTargetDir;
    }
    currentType = data.type;

    // Update active world configs if pack was active
    try {
      const activeWorld = getActiveWorldName();
      const active = getActiveAddons(activeWorld);
      let newBP = active.behaviorPacks.filter(p => p.uuid !== uuid);
      let newRP = active.resourcePacks.filter(p => p.uuid !== uuid);
      const wasActive = active.behaviorPacks.some(p => p.uuid === uuid) || active.resourcePacks.some(p => p.uuid === uuid);

      if (wasActive) {
        if (currentType === 'resource') {
          newRP.push({ uuid, version: addon.version, name: addon.name });
        } else {
          newBP.push({ uuid, version: addon.version, name: addon.name });
        }
        setActiveAddons(activeWorld, newBP, newRP);
      }
    } catch (e) {
      console.warn('[AddonService] Notice updating world configs on type switch:', e.message);
    }
  }

  const displayName = data.displayName !== undefined ? String(data.displayName).trim() : (addon.display_name || '');
  const description = data.description !== undefined ? String(data.description).trim() : (addon.description || '');
  const downloadUrl = data.downloadUrl !== undefined ? String(data.downloadUrl).trim() : (addon.download_url || '');
  const notes = data.notes !== undefined ? String(data.notes).trim() : (addon.notes || '');

  db.prepare(`
    UPDATE addons
    SET type = ?, path = ?, display_name = ?, description = ?, download_url = ?, notes = ?
    WHERE uuid = ?
  `).run(currentType, currentPath, displayName, description, downloadUrl, notes, uuid);

  // Group synchronization if companion pack exists
  if (data.syncGroup && addon.group_id) {
    db.prepare(`
      UPDATE addons
      SET display_name = ?, download_url = ?, notes = ?
      WHERE group_id = ? AND uuid != ?
    `).run(displayName, downloadUrl, notes, addon.group_id, uuid);
  }

  return {
    success: true,
    message: 'Addon metadata updated successfully.',
    addon: db.prepare('SELECT * FROM addons WHERE uuid = ?').get(uuid)
  };
}

/**
 * deleteAddon(uuid, options):
 * Remove from DB, delete folder from filesystem, and remove from active world lists.
 * Supports deleting companion dual-pack if options.deleteCompanion is true.
 */
async function deleteAddon(uuid, options = {}) {
  const addon = db.prepare('SELECT id, uuid, name, path, is_system, group_id FROM addons WHERE uuid = ?').get(uuid);

  if (!addon) {
    throw new Error(`Addon with UUID ${uuid} not found.`);
  }

  if (addon.is_system) {
    throw new Error(`Cannot delete system addon "${addon.name}". This is an internal Bedrock engine pack.`);
  }

  const toDelete = [addon];

  if (options.deleteCompanion && addon.group_id) {
    const companion = db.prepare('SELECT id, uuid, name, path, is_system, group_id FROM addons WHERE group_id = ? AND uuid != ?').get(addon.group_id, uuid);
    if (companion && !companion.is_system) {
      toDelete.push(companion);
    }
  }

  const deletedNames = [];
  const deletedUuids = [];

  for (const item of toDelete) {
    if (item.path && fs.existsSync(item.path)) {
      try {
        fs.rmSync(item.path, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[AddonService] Failed to delete folder ${item.path}:`, err.message);
      }
    }
    db.prepare('DELETE FROM addons WHERE uuid = ?').run(item.uuid);
    deletedNames.push(item.name);
    deletedUuids.push(item.uuid);
  }

  // Clean from active world configs
  try {
    const activeWorld = getActiveWorldName();
    const active = getActiveAddons(activeWorld);
    const deleteSet = new Set(deletedUuids);
    const newBP = active.behaviorPacks.filter(p => !deleteSet.has(p.uuid));
    const newRP = active.resourcePacks.filter(p => !deleteSet.has(p.uuid));
    setActiveAddons(activeWorld, newBP, newRP);
  } catch (_) {}

  return {
    success: true,
    deletedCount: toDelete.length,
    deletedUuids,
    message: toDelete.length > 1
      ? `Both companion dual-packs (${deletedNames.join(' & ')}) uninstalled successfully.`
      : `Addon "${addon.name}" (${uuid}) deleted successfully.`
  };
}

/**
 * getActiveAddons(worldName):
 * Read world_behavior_packs.json and world_resource_packs.json from active world.
 */
function getActiveAddons(worldName) {
  const worldsDir = config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
  const worldDir = path.join(worldsDir, worldName);

  const bpFile = path.join(worldDir, 'world_behavior_packs.json');
  const rpFile = path.join(worldDir, 'world_resource_packs.json');

  let bpList = [];
  let rpList = [];

  if (fs.existsSync(bpFile)) {
    try {
      bpList = JSON.parse(fs.readFileSync(bpFile, 'utf8'));
    } catch (err) {
      console.warn(`[AddonService] Error parsing world_behavior_packs.json:`, err.message);
    }
  }

  if (fs.existsSync(rpFile)) {
    try {
      rpList = JSON.parse(fs.readFileSync(rpFile, 'utf8'));
    } catch (err) {
      console.warn(`[AddonService] Error parsing world_resource_packs.json:`, err.message);
    }
  }

  const allAddons = db.prepare('SELECT uuid, name, type, version, group_id, display_name, download_url FROM addons').all();
  const addonMap = new Map();
  for (const a of allAddons) {
    addonMap.set(a.uuid, a);
  }

  const enrichPack = (entry, defaultType) => {
    const packUuid = entry.pack_id || entry.uuid;
    const dbInfo = addonMap.get(packUuid);
    const versionStr = Array.isArray(entry.version) ? entry.version.join('.') : String(entry.version || '1.0.0');

    return {
      uuid: packUuid,
      version: versionStr,
      name: (dbInfo && dbInfo.display_name) || (dbInfo && dbInfo.name) || 'Unknown Pack',
      rawName: dbInfo ? dbInfo.name : 'Unknown Pack',
      type: dbInfo ? dbInfo.type : defaultType,
      groupId: dbInfo ? dbInfo.group_id : null,
      downloadUrl: dbInfo ? dbInfo.download_url : ''
    };
  };

  return {
    behaviorPacks: (Array.isArray(bpList) ? bpList : []).map(p => enrichPack(p, 'behavior')),
    resourcePacks: (Array.isArray(rpList) ? rpList : []).map(p => enrichPack(p, 'resource'))
  };
}

/**
 * setActiveAddons(worldName, behaviorPacks, resourcePacks):
 * Writes world_behavior_packs.json and world_resource_packs.json atomically.
 */
function setActiveAddons(worldName, behaviorPacks = [], resourcePacks = []) {
  const worldsDir = config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
  const worldDir = path.join(worldsDir, worldName);
  ensureDir(worldDir);

  const formatList = (packs) => {
    return packs.map(pack => {
      const packId = pack.uuid || pack.pack_id;
      let version = pack.version || [1, 0, 0];
      if (typeof version === 'string') {
        version = version.split('.').map(n => parseInt(n, 10) || 0);
      }
      return {
        pack_id: packId,
        version
      };
    });
  };

  const bpFormatted = formatList(behaviorPacks);
  const rpFormatted = formatList(resourcePacks);

  const bpFile = path.join(worldDir, 'world_behavior_packs.json');
  const rpFile = path.join(worldDir, 'world_resource_packs.json');

  atomicWriteJson(bpFile, bpFormatted);
  atomicWriteJson(rpFile, rpFormatted);

  return {
    success: true,
    message: `Active addons updated for world "${worldName}".`,
    behaviorCount: bpFormatted.length,
    resourceCount: rpFormatted.length
  };
}

/**
 * Recursively list all relative files in directory
 */
function listFilesRelative(baseDir, currentSubdir = '') {
  const dir = path.join(baseDir, currentSubdir);
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const rel = path.join(currentSubdir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      results.push(...listFilesRelative(baseDir, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/**
 * runDiagnostics(geminiApiKey = null):
 * Deep inspection of installed & active packs:
 * - Asymmetric dual-pack activation
 * - Overlapping definitions
 * - Antiquated manifest formats
 * - Lag Potential & Performance Impact Meter calculation
 * - Optional Google Gemini generative diagnostics
 */
async function runDiagnostics(geminiApiKey = null) {
  const worldName = getActiveWorldName();
  const active = getActiveAddons(worldName);
  const allAddons = listAddons();

  const activeBPUuids = new Set(active.behaviorPacks.map(p => p.uuid));
  const activeRPUuids = new Set(active.resourcePacks.map(p => p.uuid));

  const issues = [];
  const contributingIndicators = [];

  // 1. Asymmetric Dual-Pack Activation Check
  const groupMap = new Map();
  for (const addon of allAddons) {
    if (addon.group_id) {
      if (!groupMap.has(addon.group_id)) {
        groupMap.set(addon.group_id, []);
      }
      groupMap.get(addon.group_id).push(addon);
    }
  }

  for (const [groupId, packs] of groupMap.entries()) {
    const bp = packs.find(p => p.type === 'behavior');
    const rp = packs.find(p => p.type === 'resource');

    if (bp && rp) {
      const bpActive = activeBPUuids.has(bp.uuid);
      const rpActive = activeRPUuids.has(rp.uuid);

      if (bpActive && !rpActive) {
        issues.push({
          id: `asymmetric_${groupId}`,
          type: 'asymmetric_dual_pack',
          severity: 'warning',
          title: 'Asymmetric Dual-Pack: Missing Resource Pack',
          packName: bp.display_name || bp.name,
          description: `Behavior Pack "${bp.display_name || bp.name}" is active, but its companion Resource Pack "${rp.display_name || rp.name}" is inactive. Players will see missing textures or generic fallback models.`,
          fixable: true,
          fixAction: 'enable_counterpart',
          targetUuid: rp.uuid,
          targetType: 'resource',
          companionUuid: bp.uuid
        });
        contributingIndicators.push(`Companion Resource Pack disabled for "${bp.name}"`);
      } else if (!bpActive && rpActive) {
        issues.push({
          id: `asymmetric_${groupId}`,
          type: 'asymmetric_dual_pack',
          severity: 'warning',
          title: 'Asymmetric Dual-Pack: Missing Behavior Pack',
          packName: rp.display_name || rp.name,
          description: `Resource Pack "${rp.display_name || rp.name}" is active, but its companion Behavior Pack "${bp.display_name || bp.name}" is disabled. Visual assets exist without logic.`,
          fixable: true,
          fixAction: 'enable_counterpart',
          targetUuid: bp.uuid,
          targetType: 'behavior',
          companionUuid: rp.uuid
        });
        contributingIndicators.push(`Companion Behavior Pack disabled for "${rp.name}"`);
      }
    }
  }

  // 2. Antiquated Manifest Format Check (Custom User Packs Only)
  const customAddons = allAddons.filter(a => !a.is_system);
  for (const addon of customAddons) {
    if (!addon.path || !fs.existsSync(addon.path)) continue;
    const manifestPath = path.join(addon.path, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      if (manifest.format_version === 1) {
        const isActive = activeBPUuids.has(addon.uuid) || activeRPUuids.has(addon.uuid);
        issues.push({
          id: `manifest_v1_${addon.uuid}`,
          type: 'antiquated_manifest',
          severity: isActive ? 'warning' : 'info',
          title: `Legacy Manifest Format (${addon.name})`,
          packName: addon.display_name || addon.name,
          description: `Pack "${addon.name}" targets legacy format_version: 1. Modern Bedrock servers recommend format_version: 2 to prevent deprecation warnings.`,
          fixable: true,
          fixAction: 'upgrade_manifest_format',
          targetUuid: addon.uuid
        });
        if (isActive) contributingIndicators.push(`Legacy format_version: 1 in "${addon.name}"`);
      }
    } catch (_) {}
  }

  // 3. Overlapping File Definitions Check across Active Custom Packs
  const activePacksOnDisk = [];
  for (const act of [...active.behaviorPacks, ...active.resourcePacks]) {
    const dbInfo = allAddons.find(a => a.uuid === act.uuid);
    if (dbInfo && !dbInfo.is_system && dbInfo.path && fs.existsSync(dbInfo.path)) {
      activePacksOnDisk.push({
        uuid: act.uuid,
        name: dbInfo.display_name || dbInfo.name,
        type: dbInfo.type,
        path: dbInfo.path
      });
    }
  }

  const fileOwnership = new Map(); // relPath -> [packNames]
  let totalScriptModules = 0;

  for (const pack of activePacksOnDisk) {
    const files = listFilesRelative(pack.path);
    for (const rel of files) {
      if (rel.toLowerCase() === 'manifest.json' || rel.toLowerCase().startsWith('pack_icon.')) continue;

      if (rel.toLowerCase().endsWith('.js') || rel.toLowerCase().endsWith('.ts')) {
        totalScriptModules++;
      }

      // Check key Minecraft content definitions: entities, items, loot_tables, recipes, blocks
      const isCriticalDefinition = /^(entities|items|loot_tables|recipes|blocks|trading|spawn_rules)\//i.test(rel);
      if (isCriticalDefinition) {
        if (!fileOwnership.has(rel)) {
          fileOwnership.set(rel, []);
        }
        fileOwnership.get(rel).push(pack.name);
      }
    }
  }

  let conflictCount = 0;
  for (const [relFile, packList] of fileOwnership.entries()) {
    if (packList.length > 1) {
      conflictCount++;
      if (conflictCount <= 5) {
        issues.push({
          id: `overlap_${relFile}`,
          type: 'overlapping_definitions',
          severity: 'info',
          title: `Overlapping Definition: ${relFile}`,
          description: `Multiple active packs overwrite identical file "${relFile}" (${packList.join(', ')}). Minecraft priority determines which pack overrides.`,
          fixable: false
        });
      }
    }
  }
  if (conflictCount > 5) {
    issues.push({
      id: 'overlap_more',
      type: 'overlapping_definitions',
      severity: 'info',
      title: `${conflictCount - 5} Additional Overlapping File Collisions`,
      description: `Multiple packs modify identical entity/recipe keys. Earlier packs in load order take precedence.`,
      fixable: false
    });
  }

  // 4. Lag Potential & Performance Impact Meter Calculation
  const totalActivePacks = active.behaviorPacks.length + active.resourcePacks.length;
  let rawScore = 0;

  // Active pack density (3.5 pts per pack)
  rawScore += totalActivePacks * 3.5;
  // Conflict points (4 pts per conflict, max 25)
  rawScore += Math.min(25, conflictCount * 4);
  // Script points (8 pts per script module, max 30)
  rawScore += Math.min(30, totalScriptModules * 8);

  const lagScore = Math.min(100, Math.max(4, Math.round(rawScore)));

  let rating = 'Optimal';
  if (lagScore >= 75) rating = 'Heavy Impact';
  else if (lagScore >= 50) rating = 'Elevated';
  else if (lagScore >= 25) rating = 'Moderate';

  if (totalActivePacks > 0) {
    contributingIndicators.unshift(`${totalActivePacks} active pack(s) loaded in world`);
  }
  if (conflictCount > 0) {
    contributingIndicators.push(`${conflictCount} file definition collisions detected`);
  }
  if (totalScriptModules > 0) {
    contributingIndicators.push(`${totalScriptModules} server-side script hook(s) active`);
  }
  if (contributingIndicators.length === 0) {
    contributingIndicators.push('Clean pack configuration with zero file collisions or asymmetric states');
  }

  // 5. Optional Gemini Generative AI Analysis
  let aiInsights = null;
  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const promptText = `
You are an expert Minecraft Bedrock server engineer. Analyze this active pack configuration:
World: "${worldName}"
Active Behavior Packs: ${active.behaviorPacks.map(p => p.name).join(', ') || 'None'}
Active Resource Packs: ${active.resourcePacks.map(p => p.name).join(', ') || 'None'}
Collisions Detected: ${conflictCount}
Script Modules: ${totalScriptModules}
Issues Found: ${issues.map(i => i.title).join('; ') || 'None'}

Provide a concise, executive 2-3 paragraph analysis covering:
1. Overall stability and compatibility assessment.
2. Performance or lag recommendations.
3. Priority adjustments or advice for Bedrock server operators.
Keep your response concise, bulleted, and professional.
      `.trim();

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      if (response.ok) {
        const result = await response.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          aiInsights = text;
        }
      } else {
        const errBody = await response.text();
        console.warn('[AddonService] Gemini API call returned status', response.status, errBody);
      }
    } catch (aiErr) {
      console.warn('[AddonService] Gemini AI diagnostics error:', aiErr.message);
    }
  }

  return {
    worldName,
    issues,
    lagMeter: {
      score: lagScore,
      rating,
      contributingIndicators: [...new Set(contributingIndicators)]
    },
    aiInsights,
    checkedAt: new Date().toISOString()
  };
}

/**
 * executeAutoFix(action, targetUuid, extraData):
 * Fixes recognized issues automatically with 1-click.
 */
function executeAutoFix(action, targetUuid) {
  const worldName = getActiveWorldName();

  if (action === 'enable_counterpart') {
    const addon = db.prepare('SELECT uuid, name, type, version FROM addons WHERE uuid = ?').get(targetUuid);
    if (!addon) throw new Error('Target pack not found in catalog.');

    const active = getActiveAddons(worldName);
    const versionArr = typeof addon.version === 'string'
      ? addon.version.split('.').map(n => parseInt(n, 10) || 0)
      : [1, 0, 0];

    if (addon.type === 'resource') {
      if (!active.resourcePacks.some(p => p.uuid === addon.uuid)) {
        active.resourcePacks.push({ uuid: addon.uuid, version: versionArr, name: addon.name });
      }
    } else {
      if (!active.behaviorPacks.some(p => p.uuid === addon.uuid)) {
        active.behaviorPacks.push({ uuid: addon.uuid, version: versionArr, name: addon.name });
      }
    }

    setActiveAddons(worldName, active.behaviorPacks, active.resourcePacks);
    return {
      success: true,
      message: `Counterpart pack "${addon.name}" activated in world "${worldName}".`
    };
  }

  if (action === 'upgrade_manifest_format') {
    const addon = db.prepare('SELECT path, name FROM addons WHERE uuid = ?').get(targetUuid);
    if (!addon || !addon.path || !fs.existsSync(addon.path)) {
      throw new Error('Pack path not found on disk.');
    }
    const manifestPath = path.join(addon.path, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('manifest.json does not exist.');
    }

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    manifest.format_version = 2;
    atomicWriteJson(manifestPath, manifest);

    return {
      success: true,
      message: `Upgraded manifest.json for "${addon.name}" to format_version: 2.`
    };
  }

  throw new Error(`Unknown auto-fix action: ${action}`);
}

/**
 * Bulk & Batch operations:
 * - enable_all, disable_all, delete_all
 * - enable_selected, disable_selected, delete_selected
 */
async function executeBulk(action, targetUuids = null, options = {}) {
  const worldName = getActiveWorldName();
  const all = listAddons();

  const hasSpecificUuids = Array.isArray(targetUuids) && targetUuids.length > 0;
  let targetSet = new Set(hasSpecificUuids ? targetUuids : all.map(a => a.uuid));

  // If includeCompanions requested, resolve companion dual-packs into the targetSet
  if (options.includeCompanions) {
    for (const addon of all) {
      if (addon.group_id && targetSet.has(addon.uuid)) {
        const companion = all.find(a => a.group_id === addon.group_id && a.uuid !== addon.uuid);
        if (companion && !companion.is_system) {
          targetSet.add(companion.uuid);
        }
      }
    }
  }

  const selectedPacks = all.filter(a => targetSet.has(a.uuid));

  if (action === 'enable_all' || action === 'enable_selected' || action === 'enable') {
    // Only enable non-system packs by default
    const packsToEnable = (hasSpecificUuids ? selectedPacks : all).filter(a => !a.is_system);
    const active = getActiveAddons(worldName);
    const curBP = [...active.behaviorPacks];
    const curRP = [...active.resourcePacks];

    for (const addon of packsToEnable) {
      const v = typeof addon.version === 'string'
        ? addon.version.split('.').map(n => parseInt(n, 10) || 0)
        : [1, 0, 0];
      if (addon.type === 'resource') {
        if (!curRP.some(p => p.uuid === addon.uuid)) {
          curRP.push({ uuid: addon.uuid, version: v, name: addon.display_name || addon.name });
        }
      } else {
        if (!curBP.some(p => p.uuid === addon.uuid)) {
          curBP.push({ uuid: addon.uuid, version: v, name: addon.display_name || addon.name });
        }
      }
    }

    setActiveAddons(worldName, curBP, curRP);
    return {
      success: true,
      count: packsToEnable.length,
      message: `Enabled ${packsToEnable.length} pack(s) in world "${worldName}".`
    };
  }

  if (action === 'disable_all' || action === 'disable_selected' || action === 'disable') {
    if (!hasSpecificUuids && action === 'disable_all') {
      setActiveAddons(worldName, [], []);
      return {
        success: true,
        message: `All packs deactivated in world "${worldName}".`
      };
    }

    const active = getActiveAddons(worldName);
    const newBP = active.behaviorPacks.filter(p => !targetSet.has(p.uuid));
    const newRP = active.resourcePacks.filter(p => !targetSet.has(p.uuid));
    setActiveAddons(worldName, newBP, newRP);

    return {
      success: true,
      count: targetSet.size,
      message: `Deactivated ${targetSet.size} pack(s) from world "${worldName}".`
    };
  }

  if (action === 'delete_all' || action === 'delete_selected' || action === 'delete') {
    // Only delete custom addons, protect internal system packs
    const customPacksToDelete = (hasSpecificUuids ? selectedPacks : all).filter(a => !a.is_system);
    const customUuids = new Set(customPacksToDelete.map(a => a.uuid));

    // Clear from active world
    const active = getActiveAddons(worldName);
    const newBP = active.behaviorPacks.filter(p => !customUuids.has(p.uuid));
    const newRP = active.resourcePacks.filter(p => !customUuids.has(p.uuid));
    setActiveAddons(worldName, newBP, newRP);

    // Delete custom folders & DB records
    for (const addon of customPacksToDelete) {
      if (addon.path && fs.existsSync(addon.path)) {
        try { fs.rmSync(addon.path, { recursive: true, force: true }); } catch (_) {}
      }
      db.prepare('DELETE FROM addons WHERE uuid = ?').run(addon.uuid);
    }

    return {
      success: true,
      count: customPacksToDelete.length,
      message: `Deleted ${customPacksToDelete.length} pack(s) from server. System engine packs were preserved.`
    };
  }

  throw new Error(`Unknown bulk action: ${action}`);
}

/**
 * Helper to decode Bing result redirect URLs (/ck/a?...)
 * In Bing HTML, link hrefs are wrapped as &u=a1<base64> or u=a1<base64>
 */
function decodeBingUrl(rawUrl) {
  try {
    const cleanUrl = (rawUrl || '').replace(/&amp;/g, '&');
    if (cleanUrl.includes('/ck/a?') && cleanUrl.includes('u=')) {
      const parsed = new URL(cleanUrl);
      const u = parsed.searchParams.get('u');
      if (u) {
        const b64 = u.startsWith('a1') ? u.substring(2) : u;
        return Buffer.from(b64, 'base64').toString('utf8');
      }
    }
    return cleanUrl;
  } catch (_) {
    return rawUrl;
  }
}

const KNOWN_MINECRAFT_DOMAINS = [
  'minecraft.net',
  'curseforge.com',
  'mcpedl.com',
  'chunk.gg',
  'mcmarketplace.net',
  'minecraftpal.com',
  'bedrockuniverse.com',
  'bedrockexplorer.com',
  'planetminecraft.com',
  'blockfactory.studio',
  'sparkuniverse.com',
  '9minecraft.net'
];

function isMinecraftRelevant(item) {
  try {
    const host = new URL(item.url).hostname.toLowerCase();
    if (KNOWN_MINECRAFT_DOMAINS.some((d) => host.includes(d))) return true;
  } catch (_) {
    return false;
  }

  const text = `${item.title || ''} ${item.snippet || ''}`.toLowerCase();
  return text.includes('minecraft') || (text.includes('bedrock') && text.includes('addon'));
}

/**
 * Perform a single Bing search query and extract parsed results.
 */
async function fetchBingSearchResults(term) {
  try {
    const u = 'https://www.bing.com/search?q=' + encodeURIComponent(term);
    const res = await fetch(u, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];

    const html = await res.text();
    const items = [];
    const re = /<li class="b_algo"[\s\S]*?<\/li>/gi;
    let m;
    while ((m = re.exec(html)) !== null && items.length < 8) {
      const block = m[0];
      const h2Match = block.match(/<h2><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      if (!h2Match) continue;
      const rawHref = h2Match[1];
      const link = decodeBingUrl(rawHref);
      if (!link.startsWith('http')) continue;

      const title = h2Match[2].replace(/<[^>]+>/g, '').trim();
      const snippetMatch = block.match(/<div class="b_caption">[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      const candidate = { url: link, title, snippet };
      if (isMinecraftRelevant(candidate)) {
        items.push(candidate);
      }
    }
    return items;
  } catch (err) {
    return [];
  }
}

/**
 * Search the web for addon URLs, images, titles, and site metadata.
 * Directly searches Bing for Minecraft Marketplace (official), CurseForge, MCPEDL, Chunk, etc.
 * Enriches results with open graph images and site favicons, prioritizing official marketplace pages.
 */
async function searchAddonUrl(query) {
  try {
    const cleanQuery = (query || '').trim();
    if (!cleanQuery) return [];

    // Run parallel searches: specific marketplace query and general bedrock addon query
    const [marketResults, generalResults] = await Promise.all([
      fetchBingSearchResults(`${cleanQuery} minecraft marketplace addon`).catch(() => []),
      fetchBingSearchResults(`minecraft bedrock addon ${cleanQuery}`).catch(() => [])
    ]);

    const combined = [];
    const seenUrls = new Set();
    // Combine marketplace results first, followed by general addon results
    for (const item of [...marketResults, ...generalResults]) {
      const norm = item.url.split('?')[0].replace(/\/+$/, '').toLowerCase();
      if (seenUrls.has(norm)) continue;
      seenUrls.add(norm);
      combined.push(item);
    }

    // Enrich top 7 results
    const topItems = combined.slice(0, 7);
    const enriched = await Promise.all(topItems.map(async (item) => {
      let image = null;
      let siteName = '';
      let isMarketplace = false;
      let isOfficialMarketplace = false;

      try {
        const u = new URL(item.url);
        siteName = u.hostname.replace(/^www\./, '');

        if (siteName.includes('minecraft.net')) {
          siteName = 'Minecraft Marketplace';
          isMarketplace = true;
          isOfficialMarketplace = true;
          image = 'https://www.minecraft.net/content/dam/minecraftnet/franchise/logos/minecraft-creeper-face.jpg';
        } else if (siteName.includes('chunk.gg')) {
          siteName = 'Chunk Marketplace';
          isMarketplace = true;
        } else if (siteName.includes('mcmarketplace.net')) {
          siteName = 'Marketplace Catalog';
          isMarketplace = true;
        } else if (siteName.includes('minecraftpal.com')) {
          siteName = 'MinecraftPal Marketplace';
          isMarketplace = true;
        } else if (siteName.includes('bedrockuniverse.com')) {
          siteName = 'Bedrock Universe';
          isMarketplace = true;
        } else if (siteName.includes('curseforge.com')) {
          siteName = 'CurseForge';
        } else if (siteName.includes('mcpedl.com')) {
          siteName = 'MCPEDL';
        } else if (siteName.includes('planetminecraft.com')) {
          siteName = 'Planet Minecraft';
        } else if (siteName.includes('youtube.com')) {
          siteName = 'YouTube';
        }

        // Try fetching page OG image if not already set or if community site
        if (!image) {
          const pageRes = await fetch(item.url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(2000)
          });
          if (pageRes.ok) {
            const pageHtml = await pageRes.text();
            const ogMatch = pageHtml.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ||
                            pageHtml.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ||
                            pageHtml.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
            if (ogMatch && ogMatch[1] && ogMatch[1].startsWith('http')) {
              image = ogMatch[1];
            }
          }
        }
      } catch (_) {}

      if (!image) {
        try {
          const u = new URL(item.url);
          image = `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=128`;
        } catch (_) {}
      }

      return {
        ...item,
        image,
        siteName,
        isMarketplace,
        isOfficialMarketplace
      };
    }));

    // Prioritize official Minecraft Marketplace first, then other marketplace entries
    enriched.sort((a, b) => {
      if (a.isOfficialMarketplace && !b.isOfficialMarketplace) return -1;
      if (!a.isOfficialMarketplace && b.isOfficialMarketplace) return 1;
      if (a.isMarketplace && !b.isMarketplace) return -1;
      if (!a.isMarketplace && b.isMarketplace) return 1;
      return 0;
    });

    return enriched;
  } catch (err) {
    console.warn('[AddonService] Error during searchAddonUrl:', err.message);
    return [];
  }
}

module.exports = {
  processAddonUpload,
  getPackIconPath,
  scanDiskFolders,
  listAddons,
  updateAddonMetadata,
  deleteAddon,
  getActiveAddons,
  setActiveAddons,
  runDiagnostics,
  executeAutoFix,
  executeBulk,
  searchAddonUrl
};

