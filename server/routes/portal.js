const fs = require('fs');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const serverProcess = require('../services/serverProcess');
const { logAudit } = require('../services/auditService');
const broadcasterService = require('../services/broadcasterService');

const router = express.Router();

// Anti-spam action cooldown map: ip/user -> timestamp (ms)
const actionCooldowns = new Map();
const COOLDOWN_DURATION_MS = 15000; // 15 seconds cooldown

function getClientIdentifier(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  return String(ip).split(',')[0].trim();
}

function getCooldownRemaining(clientId) {
  const lastTime = actionCooldowns.get(clientId);
  if (!lastTime) return 0;
  const elapsed = Date.now() - lastTime;
  if (elapsed >= COOLDOWN_DURATION_MS) {
    actionCooldowns.delete(clientId);
    return 0;
  }
  return Math.ceil((COOLDOWN_DURATION_MS - elapsed) / 1000);
}

function getEffectivePortalBranding() {
  const enabled = db.getSetting('portal_enabled', 'true') === 'true';
  const requireLogin = db.getSetting('portal_require_login', 'false') === 'true';
  const showXboxBot = db.getSetting('portal_show_xbox_bot', 'true') === 'true';
  const slug = db.getSetting('portal_slug', 'server');
  let title = db.getSetting('portal_title', '').trim();
  const logoUrl = db.getSetting('portal_logo_url', '').trim();
  let subtitle = db.getSetting('portal_subtitle', '').trim();
  const logoSize = parseInt(db.getSetting('portal_logo_size', '140'), 10) || 140;

  const defaultSections = [
    { id: 'server_status', name: 'Server Status & Power Controls', enabled: true },
    { id: 'direct_ip', name: 'Direct Server IP Connection', enabled: true },
    { id: 'xbox_bot', name: 'Xbox Live Friend Relay Bot', enabled: true },
  ];
  let sections = defaultSections;
  try {
    const rawSections = db.getSetting('portal_sections', '');
    if (rawSections) {
      const parsed = JSON.parse(rawSections);
      if (Array.isArray(parsed) && parsed.length > 0) {
        sections = parsed;
      }
    }
  } catch (_) {}

  if (!title) {
    try {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      if (fs.existsSync(propsPath)) {
        const content = fs.readFileSync(propsPath, 'utf8');
        const match = content.match(/^server-name\s*=\s*(.+)$/m);
        if (match && match[1].trim()) {
          title = match[1].trim();
        }
      }
    } catch (_) {}
    if (!title) title = 'Minecraft Bedrock Server';
  }

  if (!subtitle) {
    subtitle = 'Dedicated Bedrock Realm • Direct Player Controls';
  }

  return { enabled, requireLogin, showXboxBot, slug, title, logoUrl, logoSize, subtitle, sections };
}

/**
 * Optional user authentication for public/portal endpoints
 */
function optionalAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded || !decoded.id) return null;
    return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(decoded.id) || null;
  } catch (_) {
    return null;
  }
}

/**
 * GET /config
 * Public settings for portal frontend (title, logo, slug, requireLogin, enabled)
 */
router.get('/config', (req, res) => {
  try {
    const branding = getEffectivePortalBranding();
    return res.json(branding);
  } catch (err) {
    console.error('[PortalRoute] Error fetching config:', err);
    return res.status(500).json({ error: 'Failed to retrieve portal config', details: err.message });
  }
});

/**
 * GET /status
 * Return live status for the portal page
 */
router.get('/status', (req, res) => {
  try {
    const branding = getEffectivePortalBranding();
    const { enabled, requireLogin, showXboxBot, slug, title, logoUrl, logoSize, subtitle, sections } = branding;

    if (!enabled) {
      return res.json({
        enabled: false,
        message: 'The player quick-start portal is currently disabled by administrator.'
      });
    }

    const user = optionalAuth(req);
    if (requireLogin && !user) {
      return res.json({
        enabled: true,
        requireLogin: true,
        authenticated: false,
        showXboxBot,
        slug,
        title,
        logoUrl,
        logoSize,
        subtitle,
        sections
      });
    }

    const clientId = user ? `user_${user.id}` : getClientIdentifier(req);
    const cooldown = getCooldownRemaining(clientId);
    const status = serverProcess.getStatus();
    const xboxStatus = showXboxBot ? broadcasterService.getStatus() : null;

    return res.json({
      enabled: true,
      requireLogin,
      authenticated: Boolean(user),
      user: user ? { username: user.username, role: user.role } : null,
      showXboxBot,
      slug,
      title,
      logoUrl,
      logoSize,
      subtitle,
      sections,
      state: status.state || (status.running ? 'running' : 'stopped'),
      playerCount: status.playerCount || 0,
      maxPlayers: status.maxPlayers || 10,
      port: status.port || 19132,
      version: status.version || 'Bedrock Dedicated Server',
      uptime: status.uptime || 0,
      cooldownRemaining: cooldown,
      xboxBot: xboxStatus ? {
        state: xboxStatus.state,
        authenticated: xboxStatus.account.authenticated,
        gamertag: xboxStatus.account.gamertag,
        displayPic: xboxStatus.account.displayPic,
        xuid: xboxStatus.account.xuid,
        pendingLogin: xboxStatus.pendingLogin,
        totalRedirects: xboxStatus.stats.totalRedirects,
        friendsCount: xboxStatus.stats.friendsCount,
        serverName: xboxStatus.config.serverName,
        targetIp: xboxStatus.config.targetIp,
        targetPort: xboxStatus.config.targetPort,
        listenPort: xboxStatus.config.listenPort,
        autoAcceptFriends: xboxStatus.config.autoAcceptFriends,
      } : null,
      tunnel: (() => {
        try {
          const playitService = require('../services/playitService');
          const tConfig = playitService.getConfig();
          if (!tConfig.showInPortal) return null;
          const tStatus = playitService.getStatus();
          return {
            state: tStatus.state,
            isRunning: tStatus.isRunning,
            publicAddress: tStatus.publicAddress,
            publicHost: tStatus.publicHost,
            publicPort: tStatus.publicPort,
          };
        } catch (_) {
          return null;
        }
      })()
    });
  } catch (err) {
    console.error('[PortalRoute] Error fetching status:', err);
    return res.status(500).json({ error: 'Failed to retrieve portal status', details: err.message });
  }
});

/**
 * POST /action
 * Execute 'start' or 'restart' only
 */
router.post('/action', async (req, res) => {
  try {
    const enabled = db.getSetting('portal_enabled', 'true') === 'true';
    if (!enabled) {
      return res.status(403).json({ error: 'Player portal is currently disabled.' });
    }

    const requireLogin = db.getSetting('portal_require_login', 'false') === 'true';
    const user = optionalAuth(req);

    if (requireLogin && !user) {
      return res.status(401).json({ error: 'Login required to control the server.' });
    }

    const { action } = req.body;
    if (!action || !['start', 'restart', 'start_all', 'restart_all', 'start_bot', 'restart_bot'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Permitted: start, restart, start_all, restart_all, start_bot, restart_bot' });
    }

    const clientId = user ? `user_${user.id}` : getClientIdentifier(req);
    const cooldown = getCooldownRemaining(clientId);

    if (cooldown > 0) {
      return res.status(429).json({
        error: `Please wait ${cooldown} seconds before issuing another server action.`,
        cooldownRemaining: cooldown
      });
    }

    const userLabel = user ? user.username : `Player (${getClientIdentifier(req)})`;

    let result;
    if (action === 'start') {
      const currentStatus = serverProcess.getStatus();
      if (currentStatus.state === 'running' || currentStatus.state === 'starting') {
        return res.status(400).json({ error: 'Server is already running or starting.' });
      }
      result = await serverProcess.start();
      logAudit(user ? user.id : null, userLabel, 'PORTAL_START', 'Player portal requested server start');
    } else if (action === 'restart') {
      result = await serverProcess.restart();
      logAudit(user ? user.id : null, userLabel, 'PORTAL_RESTART', 'Player portal requested server restart');
    } else if (action === 'start_all') {
      const playitService = require('../services/playitService');
      if (serverProcess.state !== 'running') await serverProcess.start().catch((e) => console.warn(e.message));
      if (playitService.isClaimed() && !playitService.getStatus().isRunning) await playitService.start().catch((e) => console.warn(e.message));
      const xb = broadcasterService.getStatus();
      if (xb.account?.authenticated && xb.state !== 'running') await broadcasterService.start().catch((e) => console.warn(e.message));
      logAudit(user ? user.id : null, userLabel, 'PORTAL_START_ALL', 'Player portal requested start all systems');
      result = { message: 'All systems started (Server, Playit, and Xbox Bot).' };
    } else if (action === 'restart_all') {
      const playitService = require('../services/playitService');
      await serverProcess.restart().catch((e) => console.warn(e.message));
      if (playitService.isClaimed()) await playitService.restart().catch((e) => console.warn(e.message));
      const xb = broadcasterService.getStatus();
      if (xb.account?.authenticated) await broadcasterService.restart().catch((e) => console.warn(e.message));
      logAudit(user ? user.id : null, userLabel, 'PORTAL_RESTART_ALL', 'Player portal requested restart all systems');
      result = { message: 'All systems restarted (Server, Playit, and Xbox Bot).' };
    } else if (action === 'start_bot') {
      result = await broadcasterService.start();
      logAudit(user ? user.id : null, userLabel, 'PORTAL_BOT_START', 'Player portal requested Xbox bot start');
    } else if (action === 'restart_bot') {
      result = await broadcasterService.restart();
      logAudit(user ? user.id : null, userLabel, 'PORTAL_BOT_RESTART', 'Player portal requested Xbox bot restart');
    }

    // Set cooldown
    actionCooldowns.set(clientId, Date.now());

    return res.json({
      success: true,
      message: `Server [${action.toUpperCase()}] triggered successfully.`,
      result,
      cooldownRemaining: Math.ceil(COOLDOWN_DURATION_MS / 1000)
    });
  } catch (err) {
    console.error('[PortalRoute] Error executing action:', err);
    return res.status(400).json({ error: err.message || 'Failed to execute server action' });
  }
});

/**
 * PUT /settings
 * Admin-only configuration of portal parameters
 */
router.put('/settings', authenticate, requireAdmin, (req, res) => {
  try {
    const {
      enabled,
      requireLogin,
      showXboxBot,
      slug,
      title,
      logoUrl,
      logoSize,
      subtitle,
      sections
    } = req.body;

    if (enabled !== undefined) {
      db.setSetting('portal_enabled', Boolean(enabled));
    }
    if (requireLogin !== undefined) {
      db.setSetting('portal_require_login', Boolean(requireLogin));
    }
    if (showXboxBot !== undefined) {
      db.setSetting('portal_show_xbox_bot', Boolean(showXboxBot));
    }
    if (slug !== undefined) {
      const cleanSlug = String(slug).trim().replace(/^\/+|\/+$/g, '').toLowerCase() || 'server';
      db.setSetting('portal_slug', cleanSlug);
    }
    if (title !== undefined) {
      db.setSetting('portal_title', String(title).trim() || 'Minecraft Bedrock Server');
    }
    if (logoUrl !== undefined) {
      db.setSetting('portal_logo_url', String(logoUrl).trim());
    }
    if (logoSize !== undefined) {
      const parsedSize = Math.max(40, Math.min(600, parseInt(logoSize, 10) || 140));
      db.setSetting('portal_logo_size', String(parsedSize));
    }
    if (subtitle !== undefined) {
      db.setSetting('portal_subtitle', String(subtitle).trim() || 'Dedicated Bedrock Realm');
    }
    if (sections !== undefined && Array.isArray(sections)) {
      db.setSetting('portal_sections', JSON.stringify(sections));
    }

    logAudit(req.user.id, req.user.username, 'UPDATE_PORTAL_SETTINGS', {
      enabled,
      requireLogin,
      showXboxBot,
      slug,
      title,
      logoSize
    });

    const branding = getEffectivePortalBranding();

    return res.json({
      success: true,
      message: 'Portal settings updated successfully.',
      settings: {
        enabled: db.getSetting('portal_enabled', 'true') === 'true',
        requireLogin: db.getSetting('portal_require_login', 'false') === 'true',
        showXboxBot: db.getSetting('portal_show_xbox_bot', 'true') === 'true',
        slug: db.getSetting('portal_slug', 'server'),
        title: db.getSetting('portal_title', 'Minecraft Bedrock Server'),
        logoUrl: db.getSetting('portal_logo_url', ''),
        logoSize: parseInt(db.getSetting('portal_logo_size', '140'), 10) || 140,
        subtitle: db.getSetting('portal_subtitle', 'Dedicated Bedrock Realm'),
        sections: branding.sections
      }
    });
  } catch (err) {
    console.error('[PortalRoute] Error updating settings:', err);
    return res.status(500).json({ error: 'Failed to update portal settings', details: err.message });
  }
});

module.exports = router;
