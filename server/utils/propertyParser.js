const fs = require('fs');
const path = require('path');

/**
 * Default properties for Bedrock Dedicated Server.
 */
function getDefaultProperties() {
  return {
    'server-name': 'Dedicated Server',
    'gamemode': 'survival',
    'force-gamemode': 'false',
    'difficulty': 'easy',
    'allow-cheats': 'false',
    'max-players': '10',
    'server-ram-limit': '4096',
    'online-mode': 'true',
    'allow-list': 'false',
    'server-port': '19132',
    'server-portv6': '19133',
    'view-distance': '32',
    'tick-distance': '4',
    'player-idle-timeout': '30',
    'max-threads': '8',
    'level-name': 'Bedrock level',
    'level-seed': '',
    'default-player-permission-level': 'member',
    'texturepack-required': 'false',
    'content-log-file-enabled': 'false',
    'compression-threshold': '1',
    'server-authoritative-movement': 'server-auth',
    'player-movement-score-threshold': '20',
    'player-movement-action-direction-threshold': '1',
    'player-movement-distance-threshold': '0.3',
    'player-movement-duration-threshold-in-ms': '500',
    'correct-player-movement': 'false',
    'server-authoritative-block-breaking': 'false',
    'transport': 'nethernet'
  };
}

/**
 * Parse a server.properties file into a key-value object.
 * @param {string} filePath - Absolute or relative path to server.properties
 * @returns {Record<string, string>}
 */
function parseProperties(filePath) {
  if (!fs.existsSync(filePath)) {
    return getDefaultProperties();
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const properties = {};

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comment lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex !== -1) {
      const key = trimmed.substring(0, separatorIndex).trim();
      const value = trimmed.substring(separatorIndex + 1).trim();
      if (key) {
        properties[key] = value;
      }
    }
  }

  // Merge with defaults so newly added configuration keys have sensible values
  return {
    ...getDefaultProperties(),
    ...properties,
  };
}

/**
 * Sanitize properties to prevent known server crash states.
 * (e.g. When online-mode is false, BDS crashes if allow-list is true).
 * @param {Record<string, string>} props
 * @returns {Record<string, string>}
 */
function sanitizeProperties(props) {
  const sanitized = { ...props };

  // Convert boolean-like values to strings if passed as boolean
  for (const key of Object.keys(sanitized)) {
    if (typeof sanitized[key] === 'boolean' || typeof sanitized[key] === 'number') {
      sanitized[key] = String(sanitized[key]);
    }
  }

  if (sanitized['online-mode'] === 'false') {
    sanitized['allow-list'] = 'false';
  }

  return sanitized;
}

/**
 * Write a properties object back to a server.properties file.
 * Preserves a clean header comment.
 * @param {string} filePath
 * @param {Record<string, any>} propsObject
 */
function writeProperties(filePath, propsObject) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const sanitized = sanitizeProperties(propsObject);

  const header = [
    '# Bedrock Dedicated Server Properties',
    '# Managed automatically by Bedrock Server Manager',
    `# Last updated: ${new Date().toISOString()}`,
    ''
  ].join('\n');

  const lines = Object.entries(sanitized).map(([k, v]) => `${k}=${v !== undefined && v !== null ? v : ''}`);
  const fileContent = header + '\n' + lines.join('\n') + '\n';

  fs.writeFileSync(filePath, fileContent, 'utf8');
  return true;
}

module.exports = {
  parseProperties,
  writeProperties,
  sanitizeProperties,
  getDefaultProperties
};
