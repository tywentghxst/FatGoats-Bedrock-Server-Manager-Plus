const express = require('express');
const { authenticate, requireAdmin, requireOperatorOrAdmin } = require('../middleware/auth');
const serverProcess = require('../services/serverProcess');
const playitService = require('../services/playitService');
const broadcasterService = require('../services/broadcasterService');
const { logAudit } = require('../services/auditService');

const router = express.Router();

// All routes in server.js require authenticate middleware
router.use(authenticate);

/**
 * GET /status
 * Return serverProcess.getStatus()
 */
router.get('/status', (req, res) => {
  try {
    const status = serverProcess.getStatus();
    return res.json(status);
  } catch (err) {
    console.error('[ServerRoute] Error getting status:', err);
    return res.status(500).json({ error: 'Failed to retrieve server status', details: err.message });
  }
});

/**
 * POST /start
 * Require admin or operator, start the server process, logAudit
 */
router.post('/start', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await serverProcess.start();
    logAudit(req.user.id, req.user.username, 'SERVER_START', 'Server start requested');
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error starting server:', err);
    logAudit(req.user.id, req.user.username, 'SERVER_START_FAILED', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /stop
 * Require admin or operator, stop the server process, logAudit
 */
router.post('/stop', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await serverProcess.stop();
    logAudit(req.user.id, req.user.username, 'SERVER_STOP', 'Server stop requested');
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error stopping server:', err);
    logAudit(req.user.id, req.user.username, 'SERVER_STOP_FAILED', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /restart
 * Require admin or operator, restart the server process, logAudit
 */
router.post('/restart', requireOperatorOrAdmin, async (req, res) => {
  try {
    const result = await serverProcess.restart();
    logAudit(req.user.id, req.user.username, 'SERVER_RESTART', 'Server restart requested');
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error restarting server:', err);
    logAudit(req.user.id, req.user.username, 'SERVER_RESTART_FAILED', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /start-all
 * Start Bedrock Server, Playit Tunnel, and Xbox Bot Relay together
 */
router.post('/start-all', requireOperatorOrAdmin, async (req, res) => {
  const results = {
    server: null,
    tunnel: null,
    xbox: null,
    errors: []
  };

  try {
    // 1. Bedrock Server
    try {
      if (serverProcess.state !== 'running') {
        results.server = await serverProcess.start();
      } else {
        results.server = { message: 'Server is already running', state: 'running' };
      }
    } catch (err) {
      results.errors.push(`Server: ${err.message}`);
    }

    // 2. Playit Tunnel (only if claimed)
    try {
      if (playitService.isClaimed()) {
        if (!playitService.getStatus().isRunning) {
          results.tunnel = await playitService.start();
        } else {
          results.tunnel = { message: 'Playit tunnel is already running', state: 'running' };
        }
      } else {
        results.tunnel = { message: 'Playit tunnel is not yet claimed or configured', state: 'unclaimed' };
      }
    } catch (err) {
      results.errors.push(`Playit: ${err.message}`);
    }

    // 3. Xbox Bot Relay (if authenticated)
    try {
      const xboxStatus = broadcasterService.getStatus();
      if (xboxStatus.account?.authenticated) {
        if (xboxStatus.state !== 'running') {
          results.xbox = await broadcasterService.start();
        } else {
          results.xbox = { message: 'Xbox bot is already running', state: 'running' };
        }
      } else {
        results.xbox = { message: 'Xbox bot is not authenticated', state: 'unauthenticated' };
      }
    } catch (err) {
      results.errors.push(`Xbox Bot: ${err.message}`);
    }

    logAudit(req.user.id, req.user.username, 'SERVICES_START_ALL', { results });
    return res.json({
      success: results.errors.length === 0,
      message: results.errors.length === 0 
        ? '✓ All systems started successfully (Server, Playit, and Xbox Bot)!'
        : `Started with notices: ${results.errors.join(', ')}`,
      results
    });
  } catch (err) {
    console.error('[ServerRoute] Error starting all services:', err);
    return res.status(500).json({ error: 'Failed to start all services', details: err.message });
  }
});

/**
 * POST /restart-all
 * Restart Bedrock Server, Playit Tunnel, and Xbox Bot Relay together
 */
router.post('/restart-all', requireOperatorOrAdmin, async (req, res) => {
  const results = {
    server: null,
    tunnel: null,
    xbox: null,
    errors: []
  };

  try {
    // 1. Restart Bedrock Server
    try {
      results.server = await serverProcess.restart();
    } catch (err) {
      results.errors.push(`Server: ${err.message}`);
    }

    // 2. Restart Playit Tunnel
    try {
      results.tunnel = await playitService.restart();
    } catch (err) {
      results.errors.push(`Playit: ${err.message}`);
    }

    // 3. Restart Xbox Bot
    try {
      const xboxStatus = broadcasterService.getStatus();
      if (xboxStatus.account?.authenticated) {
        results.xbox = await broadcasterService.restart();
      } else {
        results.xbox = { message: 'Xbox bot is not authenticated', state: 'unauthenticated' };
      }
    } catch (err) {
      results.errors.push(`Xbox Bot: ${err.message}`);
    }

    logAudit(req.user.id, req.user.username, 'SERVICES_RESTART_ALL', { results });
    return res.json({
      success: results.errors.length === 0,
      message: '✓ All systems restarted successfully (Server, Playit, and Xbox Bot)!',
      results
    });
  } catch (err) {
    console.error('[ServerRoute] Error restarting all services:', err);
    return res.status(500).json({ error: 'Failed to restart all services', details: err.message });
  }
});

/**
 * POST /stop-all
 * Stop Bedrock Server, Playit Tunnel, and Xbox Bot Relay together
 */
router.post('/stop-all', requireOperatorOrAdmin, async (req, res) => {
  const results = {
    server: null,
    tunnel: null,
    xbox: null,
    errors: []
  };

  try {
    // 1. Stop Bedrock Server
    try {
      if (serverProcess.state !== 'stopped') {
        results.server = await serverProcess.stop();
      }
    } catch (err) {
      results.errors.push(`Server: ${err.message}`);
    }

    // 2. Stop Playit Tunnel
    try {
      if (playitService.getStatus().isRunning) {
        results.tunnel = playitService.stop();
      }
    } catch (err) {
      results.errors.push(`Playit: ${err.message}`);
    }

    // 3. Stop Xbox Bot
    try {
      if (broadcasterService.getStatus().state !== 'offline') {
        results.xbox = await broadcasterService.stop();
      }
    } catch (err) {
      results.errors.push(`Xbox Bot: ${err.message}`);
    }

    logAudit(req.user.id, req.user.username, 'SERVICES_STOP_ALL', { results });
    return res.json({
      success: results.errors.length === 0,
      message: '⏹ All systems stopped (Server, Playit, and Xbox Bot).',
      results
    });
  } catch (err) {
    console.error('[ServerRoute] Error stopping all services:', err);
    return res.status(500).json({ error: 'Failed to stop all services', details: err.message });
  }
});

/**
 * POST /time
 * (requireAdmin) Change in-game time (day, night, noon, midnight, etc.)
 */
router.post('/time', requireAdmin, (req, res) => {
  try {
    const { time } = req.body;
    if (!time) {
      return res.status(400).json({ error: 'Time parameter is required (e.g. "day", "night", "noon", "midnight", or tick number)' });
    }
    const result = serverProcess.setTime(time);
    logAudit(req.user.id, req.user.username, 'SERVER_SET_TIME', { time });
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error changing time:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /weather
 * (requireAdmin) Change in-game weather (clear, rain, thunder)
 */
router.post('/weather', requireAdmin, (req, res) => {
  try {
    const { weather } = req.body;
    if (!weather) {
      return res.status(400).json({ error: 'Weather parameter is required (e.g. "clear", "rain", "thunder")' });
    }
    const result = serverProcess.setWeather(weather);
    logAudit(req.user.id, req.user.username, 'SERVER_SET_WEATHER', { weather });
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error changing weather:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /daylight-cycle
 * (requireAdmin) Toggle daylight cycle gamerule
 */
router.post('/daylight-cycle', requireAdmin, (req, res) => {
  try {
    const { enable } = req.body;
    const result = serverProcess.setDaylightCycle(Boolean(enable));
    logAudit(req.user.id, req.user.username, 'SERVER_SET_DAYLIGHT_CYCLE', { enable: Boolean(enable) });
    return res.json(result);
  } catch (err) {
    console.error('[ServerRoute] Error toggling daylight cycle:', err);
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
