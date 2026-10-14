const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../database');

const PERMISSIONS_FILE = path.join(config.BDS_DIR, 'permissions.json');
const ALLOWLIST_FILE = path.join(config.BDS_DIR, 'allowlist.json');

/**
 * Read BDS permissions.json safely
 */
function readPermissionsFile() {
  try {
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[PlayerService] Failed reading permissions.json:', err.message);
  }
  return [];
}

/**
 * Write BDS permissions.json safely
 */
function writePermissionsFile(permissionsList) {
  try {
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(permissionsList, null, 2), 'utf8');
  } catch (err) {
    console.error('[PlayerService] Failed writing permissions.json:', err.message);
  }
}

/**
 * Read BDS allowlist.json safely
 */
function readAllowlistFile() {
  try {
    if (fs.existsSync(ALLOWLIST_FILE)) {
      const raw = fs.readFileSync(ALLOWLIST_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[PlayerService] Failed reading allowlist.json:', err.message);
  }
  return [];
}

/**
 * Write BDS allowlist.json safely
 */
function writeAllowlistFile(allowlist) {
  try {
    fs.writeFileSync(ALLOWLIST_FILE, JSON.stringify(allowlist, null, 2), 'utf8');
  } catch (err) {
    console.error('[PlayerService] Failed writing allowlist.json:', err.message);
  }
}

/**
 * Check if a player name or xuid is operator in permissions.json
 */
function isOperatorInFile(name, xuid, permsList) {
  const list = permsList || readPermissionsFile();
  return list.some((entry) => {
    const isOp = (entry.permission === 'operator' || entry.permission === 'admin');
    if (!isOp) return false;
    if (xuid && entry.xuid && String(entry.xuid) === String(xuid)) return true;
    if (name && entry.name && entry.name.toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
}

/**
 * Get permission level from permissions.json (operator | visitor | member)
 */
function getPermissionFromFile(name, xuid, permsList) {
  const list = permsList || readPermissionsFile();
  const found = list.find((entry) => {
    if (xuid && entry.xuid && String(entry.xuid) === String(xuid)) return true;
    if (name && entry.name && entry.name.toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
  return found ? (found.permission || 'member') : null;
}

/**
 * Check if player is allowlisted
 */
function isAllowlistedInFile(name, xuid, allowlist) {
  const list = allowlist || readAllowlistFile();
  return list.some((entry) => {
    if (xuid && entry.xuid && String(entry.xuid) === String(xuid)) return true;
    if (name && entry.name && entry.name.toLowerCase() === name.toLowerCase()) return true;
    return false;
  });
}

/**
 * Record a player connection
 */
function recordPlayerJoin(name, xuid = null) {
  if (!name) return;
  try {
    const perms = readPermissionsFile();
    const isOp = isOperatorInFile(name, xuid, perms) ? 1 : 0;
    const perm = isOp ? 'operator' : (getPermissionFromFile(name, xuid, perms) || 'member');
    const now = new Date().toISOString();

    const existing = db.prepare('SELECT id, is_op, permission FROM players WHERE lower(name) = lower(?)').get(name);
    if (existing) {
      const finalOp = existing.is_op || isOp;
      db.prepare(`
        UPDATE players 
        SET is_online = 1, 
            last_seen = ?, 
            xuid = COALESCE(?, xuid),
            is_op = ?,
            permission = ?
        WHERE id = ?
      `).run(now, xuid, finalOp, finalOp ? 'operator' : (existing.permission || perm), existing.id);
    } else {
      db.prepare(`
        INSERT INTO players (name, xuid, permission, is_op, is_online, first_seen, last_seen)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `).run(name, xuid, perm, isOp, now, now);
    }
    console.log(`[PlayerService] Player joined: ${name} (xuid: ${xuid || 'N/A'}, OP: ${isOp ? 'Yes' : 'No'})`);
  } catch (err) {
    console.error('[PlayerService] Error recording player join:', err.message);
  }
}

/**
 * Record a player disconnection
 */
function recordPlayerLeave(name, xuid = null) {
  if (!name) return;
  try {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE players 
      SET is_online = 0, last_seen = ? 
      WHERE lower(name) = lower(?)
    `).run(now, name);
    console.log(`[PlayerService] Player left: ${name}`);
  } catch (err) {
    console.error('[PlayerService] Error recording player leave:', err.message);
  }
}

/**
 * Mark all players offline when server halts
 */
function handleServerStopped() {
  try {
    db.prepare('UPDATE players SET is_online = 0').run();
  } catch (_) {}
}

/**
 * Get all players categorized into online and offline, merging BDS files and SQLite
 */
function getPlayers(activeServerProcess = null) {
  try {
    const perms = readPermissionsFile();
    const allowlist = readAllowlistFile();
    let all = db.prepare('SELECT * FROM players ORDER BY is_online DESC, last_seen DESC').all();

    // Auto-discover and persist players from permissions.json not yet in SQLite
    for (const p of perms) {
      const pName = p.name ? p.name.trim() : null;
      if (!pName) continue;
      const foundInDb = all.find((row) => row.name.toLowerCase() === pName.toLowerCase());
      if (!foundInDb) {
        try {
          const now = new Date().toISOString();
          const isOp = (p.permission === 'operator' || p.permission === 'admin') ? 1 : 0;
          db.prepare(`
            INSERT INTO players (name, xuid, permission, is_op, is_online, first_seen, last_seen)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `).run(pName, p.xuid || null, p.permission || 'operator', isOp, now, now);
        } catch (insErr) {
          console.warn('[PlayerService] Note inserting discovered perm player:', insErr.message);
        }
      }
    }

    // Auto-discover and persist players from allowlist.json not yet in SQLite
    for (const a of allowlist) {
      const aName = a.name ? a.name.trim() : null;
      if (!aName) continue;
      const foundInDb = all.find((row) => row.name.toLowerCase() === aName.toLowerCase());
      if (!foundInDb) {
        try {
          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO players (name, xuid, permission, is_op, is_online, first_seen, last_seen)
            VALUES (?, ?, 'member', 0, 0, ?, ?)
          `).run(aName, a.xuid || null, now, now);
        } catch (insErr) {
          console.warn('[PlayerService] Note inserting discovered allowlist player:', insErr.message);
        }
      }
    }

    // Refresh all players after sync
    all = db.prepare('SELECT * FROM players ORDER BY is_online DESC, last_seen DESC').all();

    // Map active connected players from serverProcess if provided
    const connectedSet = activeServerProcess?.connectedPlayers || new Set();

    const online = [];
    const offline = [];

    for (const player of all) {
      const isConnected = connectedSet.has(player.name) || Boolean(player.is_online);
      const permInFile = getPermissionFromFile(player.name, player.xuid, perms);
      const isOp = Boolean(player.is_op || isOperatorInFile(player.name, player.xuid, perms));
      const permission = isOp ? 'operator' : (permInFile || player.permission || 'member');
      const isAllowlisted = isAllowlistedInFile(player.name, player.xuid, allowlist);

      const enriched = {
        id: player.id,
        name: player.name,
        xuid: player.xuid,
        isOp,
        permission,
        isAllowlisted,
        isOnline: isConnected,
        firstSeen: player.first_seen,
        lastSeen: player.last_seen
      };

      if (isConnected) {
        online.push(enriched);
      } else {
        offline.push(enriched);
      }
    }

    // If serverProcess has players not yet recorded in DB, add them to online
    for (const name of connectedSet) {
      if (!online.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        const isOp = isOperatorInFile(name, null, perms);
        const permInFile = getPermissionFromFile(name, null, perms);
        const isAllowlisted = isAllowlistedInFile(name, null, allowlist);
        online.push({
          id: null,
          name,
          xuid: null,
          isOp,
          permission: isOp ? 'operator' : (permInFile || 'member'),
          isAllowlisted,
          isOnline: true,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString()
        });
      }
    }

    const totalCount = online.length + offline.length;
    const opCount = [...online, ...offline].filter((p) => p.isOp).length;
    const allowlistCount = [...online, ...offline].filter((p) => p.isAllowlisted).length;

    return {
      online,
      offline,
      totalCount,
      onlineCount: online.length,
      opCount,
      allowlistCount
    };
  } catch (err) {
    console.error('[PlayerService] Error getting players:', err.message);
    return { online: [], offline: [], totalCount: 0, onlineCount: 0, opCount: 0, allowlistCount: 0 };
  }
}

/**
 * OP or DEOP a player
 */
async function setPlayerOp(name, isOp, serverProcess = null) {
  if (!name || typeof name !== 'string') {
    throw new Error('Valid player name is required.');
  }

  const cleanName = name.trim();
  const perms = readPermissionsFile();

  // 1. Send command to live BDS server if running
  if (serverProcess && serverProcess.state === 'running') {
    try {
      const command = isOp ? `op "${cleanName}"` : `deop "${cleanName}"`;
      serverProcess.sendCommand(command);
    } catch (cmdErr) {
      console.warn(`[PlayerService] Could not send live command ${isOp ? 'op' : 'deop'}:`, cmdErr.message);
    }
  }

  // 2. Update permissions.json directly
  let existingIndex = perms.findIndex(
    (e) => (e.name && e.name.toLowerCase() === cleanName.toLowerCase())
  );

  if (isOp) {
    if (existingIndex >= 0) {
      perms[existingIndex].permission = 'operator';
      if (!perms[existingIndex].name) perms[existingIndex].name = cleanName;
    } else {
      perms.push({
        permission: 'operator',
        name: cleanName
      });
    }
  } else {
    if (existingIndex >= 0) {
      perms.splice(existingIndex, 1);
    }
  }
  writePermissionsFile(perms);

  // 3. Update database record
  try {
    const existing = db.prepare('SELECT id FROM players WHERE lower(name) = lower(?)').get(cleanName);
    if (existing) {
      db.prepare(`
        UPDATE players 
        SET is_op = ?, permission = ?
        WHERE id = ?
      `).run(isOp ? 1 : 0, isOp ? 'operator' : 'member', existing.id);
    } else {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO players (name, permission, is_op, is_online, first_seen, last_seen)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(cleanName, isOp ? 'operator' : 'member', isOp ? 1 : 0, now, now);
    }
  } catch (dbErr) {
    console.error('[PlayerService] Database error updating player OP:', dbErr.message);
  }

  return {
    success: true,
    name: cleanName,
    isOp,
    message: isOp ? `Granted Operator (OP) privileges to ${cleanName}` : `Revoked Operator privileges from ${cleanName}`
  };
}

/**
 * Set player permission level: 'operator' | 'member' | 'visitor'
 */
async function setPlayerPermission(name, permissionLevel, serverProcess = null) {
  if (!name || typeof name !== 'string') {
    throw new Error('Valid player name is required.');
  }

  const cleanName = name.trim();
  const validLevels = ['operator', 'member', 'visitor'];
  const targetLevel = validLevels.includes(permissionLevel) ? permissionLevel : 'member';
  const isOp = targetLevel === 'operator';

  const perms = readPermissionsFile();

  // 1. Live server command
  if (serverProcess && serverProcess.state === 'running') {
    try {
      if (isOp) {
        serverProcess.sendCommand(`op "${cleanName}"`);
      } else {
        serverProcess.sendCommand(`deop "${cleanName}"`);
        serverProcess.sendCommand(`permission set "${cleanName}" ${targetLevel}`);
      }
    } catch (cmdErr) {
      console.warn(`[PlayerService] Could not send live permission command:`, cmdErr.message);
    }
  }

  // 2. Update permissions.json
  const existingIndex = perms.findIndex(
    (e) => (e.name && e.name.toLowerCase() === cleanName.toLowerCase())
  );

  if (targetLevel === 'member') {
    if (existingIndex >= 0) perms.splice(existingIndex, 1);
  } else {
    if (existingIndex >= 0) {
      perms[existingIndex].permission = targetLevel;
      if (!perms[existingIndex].name) perms[existingIndex].name = cleanName;
    } else {
      perms.push({
        permission: targetLevel,
        name: cleanName
      });
    }
  }
  writePermissionsFile(perms);

  // 3. Update database
  try {
    const existing = db.prepare('SELECT id FROM players WHERE lower(name) = lower(?)').get(cleanName);
    if (existing) {
      db.prepare(`
        UPDATE players 
        SET is_op = ?, permission = ?
        WHERE id = ?
      `).run(isOp ? 1 : 0, targetLevel, existing.id);
    } else {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO players (name, permission, is_op, is_online, first_seen, last_seen)
        VALUES (?, ?, ?, 0, ?, ?)
      `).run(cleanName, targetLevel, isOp ? 1 : 0, now, now);
    }
  } catch (dbErr) {
    console.error('[PlayerService] Database error updating player permission:', dbErr.message);
  }

  return {
    success: true,
    name: cleanName,
    permission: targetLevel,
    isOp,
    message: `Set permission for ${cleanName} to ${targetLevel.toUpperCase()}`
  };
}

/**
 * Add or remove player from BDS allowlist.json
 */
async function setPlayerAllowlist(name, isAllowlisted, xuid = null, serverProcess = null) {
  if (!name || typeof name !== 'string') {
    throw new Error('Valid player name is required.');
  }

  const cleanName = name.trim();
  const allowlist = readAllowlistFile();

  // 1. Live BDS command
  if (serverProcess && serverProcess.state === 'running') {
    try {
      const cmd = isAllowlisted ? `allowlist add "${cleanName}"` : `allowlist remove "${cleanName}"`;
      serverProcess.sendCommand(cmd);
      serverProcess.sendCommand('allowlist reload');
    } catch (cmdErr) {
      console.warn(`[PlayerService] Could not send live allowlist command:`, cmdErr.message);
    }
  }

  // 2. Update allowlist.json
  const existingIdx = allowlist.findIndex(
    (e) => (e.name && e.name.toLowerCase() === cleanName.toLowerCase()) ||
           (xuid && e.xuid && String(e.xuid) === String(xuid))
  );

  if (isAllowlisted) {
    if (existingIdx < 0) {
      const entry = {
        ignoresPlayerLimit: false,
        name: cleanName
      };
      if (xuid) entry.xuid = String(xuid);
      allowlist.push(entry);
    }
  } else {
    if (existingIdx >= 0) {
      allowlist.splice(existingIdx, 1);
    }
  }
  writeAllowlistFile(allowlist);

  return {
    success: true,
    name: cleanName,
    isAllowlisted,
    message: isAllowlisted ? `Added ${cleanName} to Allowlist` : `Removed ${cleanName} from Allowlist`
  };
}

/**
 * Kick a player from the server
 */
function kickPlayer(name, reason = 'Kicked by administrator', serverProcess = null) {
  if (!name) throw new Error('Player name is required');
  if (!serverProcess || serverProcess.state !== 'running') {
    throw new Error('Server is not running. Cannot kick players.');
  }

  const cleanName = name.trim();
  const cleanReason = (reason || 'Kicked by administrator').replace(/["\n\r]/g, '');
  serverProcess.sendCommand(`kick "${cleanName}" "${cleanReason}"`);

  // Update DB status
  try {
    db.prepare('UPDATE players SET is_online = 0 WHERE lower(name) = lower(?)').run(cleanName);
  } catch (_) {}

  return {
    success: true,
    name: cleanName,
    message: `Kicked ${cleanName} from server (${cleanReason})`
  };
}

/**
 * Add or pre-register an offline player with optional OP, permission tier, and allowlist
 */
function addPlayer(name, xuid = null, isOp = false, permission = 'member', isAllowlisted = false, serverProcess = null) {
  if (!name || !name.trim()) throw new Error('Player gamertag is required');
  const cleanName = name.trim();
  const now = new Date().toISOString();
  const permLevel = isOp ? 'operator' : (permission || 'member');
  const opFlag = permLevel === 'operator' ? 1 : 0;

  const existing = db.prepare('SELECT id FROM players WHERE lower(name) = lower(?)').get(cleanName);
  if (existing) {
    db.prepare(`
      UPDATE players 
      SET xuid = COALESCE(?, xuid),
          is_op = ?,
          permission = ?
      WHERE id = ?
    `).run(xuid || null, opFlag, permLevel, existing.id);
  } else {
    db.prepare(`
      INSERT INTO players (name, xuid, permission, is_op, is_online, first_seen, last_seen)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(cleanName, xuid || null, permLevel, opFlag, now, now);
  }

  if (opFlag) {
    setPlayerOp(cleanName, true, serverProcess);
  } else if (permLevel !== 'member') {
    setPlayerPermission(cleanName, permLevel, serverProcess);
  }

  if (isAllowlisted) {
    setPlayerAllowlist(cleanName, true, xuid, serverProcess);
  }

  return {
    success: true,
    name: cleanName,
    isOp: Boolean(opFlag),
    permission: permLevel,
    isAllowlisted: Boolean(isAllowlisted),
    message: `Player ${cleanName} registered successfully`
  };
}

/**
 * Remove an offline player from history, permissions.json, and allowlist.json
 */
function deletePlayer(name, serverProcess = null) {
  if (!name) throw new Error('Player name is required');
  const cleanName = name.trim();

  // 1. DB delete
  db.prepare('DELETE FROM players WHERE lower(name) = lower(?)').run(cleanName);

  // 2. Permissions delete
  try {
    const perms = readPermissionsFile();
    const filtered = perms.filter((e) => !e.name || e.name.toLowerCase() !== cleanName.toLowerCase());
    if (filtered.length !== perms.length) writePermissionsFile(filtered);
  } catch (_) {}

  // 3. Allowlist delete
  try {
    const allowlist = readAllowlistFile();
    const filtered = allowlist.filter((e) => !e.name || e.name.toLowerCase() !== cleanName.toLowerCase());
    if (filtered.length !== allowlist.length) writeAllowlistFile(filtered);
  } catch (_) {}

  return { success: true, message: `Removed ${cleanName} from server player directory` };
}

module.exports = {
  recordPlayerJoin,
  recordPlayerLeave,
  handleServerStopped,
  getPlayers,
  setPlayerOp,
  setPlayerPermission,
  setPlayerAllowlist,
  kickPlayer,
  addPlayer,
  deletePlayer
};
