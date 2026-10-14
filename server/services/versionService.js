const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const unzipper = require('unzipper');
const config = require('../config');

const MOJANG_DOWNLOADS_API = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links';

/**
 * Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copy directory recursively
 */
function copyDirRecursive(src, dest) {
  ensureDir(dest);
  if (!fs.existsSync(src)) return;
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
 * Check if the bedrock_server executable exists on disk
 */
function isServerInstalled() {
  const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
  const exePath = path.join(config.BDS_DIR, exeName);
  return fs.existsSync(exePath);
}

/**
 * getCurrentVersion():
 * Returns installed status, exact build if known, and path info.
 */
function getCurrentVersion() {
  try {
    const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
    const exePath = path.join(config.BDS_DIR, exeName);
    const installed = fs.existsSync(exePath);

    const versionFilePath = path.join(config.BDS_DIR, 'version.txt');
    let versionStr = 'Not Installed';

    if (fs.existsSync(versionFilePath)) {
      versionStr = fs.readFileSync(versionFilePath, 'utf8').trim();
    } else if (installed) {
      versionStr = 'Detected';
    }

    return {
      version: versionStr,
      installed,
      exePath,
      platform: process.platform === 'win32' ? 'win' : 'linux'
    };
  } catch (err) {
    console.error('[VersionService] Error getting current version:', err.message);
    return {
      version: 'Unknown',
      installed: false,
      error: err.message
    };
  }
}

/**
 * fetchAvailableVersions():
 * Queries the official Mojang Bedrock download links service.
 */
async function fetchAvailableVersions() {
  const versions = [];

  try {
    const response = await fetch(MOJANG_DOWNLOADS_API, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });

    if (response.ok) {
      const data = await response.json();
      const links = data?.result?.links || [];

      for (const item of links) {
        const type = item.downloadType;
        const url = item.downloadUrl;
        const verMatch = url ? url.match(/bedrock-server-([\d.]+)\.zip/i) : null;
        const verStr = verMatch ? verMatch[1] : 'Latest';

        if (type === 'serverBedrockWindows') {
          versions.push({
            platform: 'win',
            type: 'stable',
            version: `${verStr} (Official Stable Release)`,
            versionNumber: verStr,
            url,
            latest: true
          });
        } else if (type === 'serverBedrockLinux') {
          versions.push({
            platform: 'linux',
            type: 'stable',
            version: `${verStr} (Ubuntu/Debian Linux)`,
            versionNumber: verStr,
            url,
            latest: false
          });
        } else if (type === 'serverBedrockPreviewWindows') {
          versions.push({
            platform: 'win',
            type: 'preview',
            version: `${verStr} (Preview Build)`,
            versionNumber: verStr,
            url,
            latest: false
          });
        } else if (type === 'serverBedrockPreviewLinux') {
          versions.push({
            platform: 'linux',
            type: 'preview',
            version: `${verStr} (Preview Build - Linux)`,
            versionNumber: verStr,
            url,
            latest: false
          });
        }
      }
    }
  } catch (err) {
    console.warn('[VersionService] Could not reach Mojang API directly, falling back to cached links:', err.message);
  }

  // Fallback defaults if Mojang API was unreachable
  if (versions.length === 0) {
    versions.push(
      {
        platform: 'win',
        type: 'stable',
        version: '1.26.52.3 (Official Windows Release)',
        versionNumber: '1.26.52.3',
        url: 'https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.52.3.zip',
        latest: true
      },
      {
        platform: 'linux',
        type: 'stable',
        version: '1.26.52.3 (Ubuntu/Debian Linux)',
        versionNumber: '1.26.52.3',
        url: 'https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.26.52.3.zip',
        latest: false
      }
    );
  }

  return versions;
}

/**
 * Helper to install a server zip file from disk path into BDS_DIR.
 * Backs up configuration files & worlds, extracts new server, and restores user data.
 */
async function _extractAndInstallZip(zipFilePath, expectedVersion = null) {
  ensureDir(config.BDS_DIR);
  ensureDir(config.UPLOAD_DIR);

  const backupTempDir = path.join(config.UPLOAD_DIR, `bds-preinstall-backup-${Date.now()}`);
  ensureDir(backupTempDir);

  const preservedFiles = [
    'server.properties',
    'allowlist.json',
    'permissions.json',
    'whitelist.json',
    'world_behavior_packs.json',
    'world_resource_packs.json'
  ];

  try {
    console.log('[VersionService] Backing up existing user configurations before extraction...');

    // 1. Preserve critical configuration files
    for (const file of preservedFiles) {
      const srcFile = path.join(config.BDS_DIR, file);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(backupTempDir, file));
      }
    }

    // 2. Preserve active worlds directory
    const worldsInBds = path.join(config.BDS_DIR, 'worlds');
    const worldsTempBackup = path.join(backupTempDir, 'worlds');
    if (fs.existsSync(worldsInBds)) {
      copyDirRecursive(worldsInBds, worldsTempBackup);
    }

    // 3. Preserve custom behavior & resource packs
    const bpInBds = path.join(config.BDS_DIR, 'behavior_packs');
    const bpTempBackup = path.join(backupTempDir, 'behavior_packs');
    if (fs.existsSync(bpInBds)) {
      copyDirRecursive(bpInBds, bpTempBackup);
    }

    const rpInBds = path.join(config.BDS_DIR, 'resource_packs');
    const rpTempBackup = path.join(backupTempDir, 'resource_packs');
    if (fs.existsSync(rpInBds)) {
      copyDirRecursive(rpInBds, rpTempBackup);
    }

    // 4. Extract new server zip into BDS_DIR
    console.log(`[VersionService] Extracting server binaries from ${zipFilePath} into ${config.BDS_DIR}...`);
    const zip = fs.createReadStream(zipFilePath).pipe(unzipper.Extract({ path: config.BDS_DIR }));
    await new Promise((resolve, reject) => {
      zip.on('close', resolve);
      zip.on('error', reject);
    });

    // 5. Restore preserved configuration files
    console.log('[VersionService] Restoring preserved server.properties, worlds, and configs...');
    for (const file of preservedFiles) {
      const savedFile = path.join(backupTempDir, file);
      if (fs.existsSync(savedFile)) {
        fs.copyFileSync(savedFile, path.join(config.BDS_DIR, file));
      }
    }

    if (fs.existsSync(worldsTempBackup)) {
      copyDirRecursive(worldsTempBackup, worldsInBds);
    }

    if (fs.existsSync(bpTempBackup)) {
      copyDirRecursive(bpTempBackup, bpInBds);
    }

    if (fs.existsSync(rpTempBackup)) {
      copyDirRecursive(rpTempBackup, rpInBds);
    }

    // Record extracted version in version.txt
    const baseName = path.basename(zipFilePath);
    const verMatch = baseName.match(/bedrock-server-([\d]+(?:\.[\d]+)+)/i);
    const rawVersion = expectedVersion || (verMatch ? verMatch[1] : 'Latest');
    const versionRecorded = rawVersion.replace(/\.+$/, '');
    fs.writeFileSync(path.join(config.BDS_DIR, 'version.txt'), versionRecorded, 'utf8');

    // Also update serverProcess in-memory version
    try {
      const serverProcess = require('./serverProcess');
      if (serverProcess) {
        serverProcess.version = versionRecorded;
      }
    } catch (_) {}

    console.log(`[VersionService] Bedrock Dedicated Server v${versionRecorded} installed successfully with 100% data preservation!`);

    return {
      success: true,
      message: `Bedrock Dedicated Server updated to ${versionRecorded}. User configurations, worlds, and packs preserved.`,
      installedVersion: versionRecorded
    };
  } finally {
    if (fs.existsSync(backupTempDir)) {
      try { fs.rmSync(backupTempDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

/**
 * installVersion(url):
 * Download zip from URL to temp, extract to BDS_DIR with data preservation.
 */
async function installVersion(url) {
  ensureDir(config.UPLOAD_DIR);
  const tempZipPath = path.join(config.UPLOAD_DIR, `bds-download-${Date.now()}.zip`);

  console.log(`[VersionService] Initiating download from ${url}...`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to download BDS from ${url}: HTTP ${response.status} ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(tempZipPath);
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      response.body.on('error', reject);
      fileStream.on('finish', resolve);
    });

    console.log('[VersionService] Download completed. Extracting package...');
    const verMatch = url.match(/bedrock-server-([\d]+(?:\.[\d]+)+)/i);
    const expectedVersion = verMatch ? verMatch[1].replace(/\.+$/, '') : null;
    const result = await _extractAndInstallZip(tempZipPath, expectedVersion);
    return result;
  } finally {
    if (fs.existsSync(tempZipPath)) {
      try { fs.unlinkSync(tempZipPath); } catch (_) {}
    }
  }
}

/**
 * installLatest():
 * Fetches available versions from Mojang API and automatically installs the appropriate build.
 */
async function installLatest() {
  const versions = await fetchAvailableVersions();
  const currentPlatform = process.platform === 'win32' ? 'win' : 'linux';
  // Pick stable release for current platform
  const target = versions.find((v) => v.platform === currentPlatform && v.type === 'stable') || versions[0];

  if (!target || !target.url) {
    throw new Error('Could not resolve official download link for Bedrock Dedicated Server.');
  }

  return await installVersion(target.url);
}

/**
 * installFromUpload(filePath):
 * Same as installVersion but use the uploaded file path instead of downloading.
 */
async function installFromUpload(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Uploaded file does not exist at: ${filePath}`);
    }

    const result = await _extractAndInstallZip(filePath);
    return result;
  } finally {
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) {}
    }
  }
}

module.exports = {
  isServerInstalled,
  getCurrentVersion,
  fetchAvailableVersions,
  installVersion,
  installLatest,
  installFromUpload
};
