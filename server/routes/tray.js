const express = require('express');
const serverProcess = require('../services/serverProcess');
const playitService = require('../services/playitService');
const broadcasterService = require('../services/broadcasterService');

const router = express.Router();

// Allow only localhost loopback requests
router.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || '';
  const isLoopback =
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip === 'localhost' ||
    req.hostname === 'localhost' ||
    req.hostname === '127.0.0.1';

  if (!isLoopback) {
    return res.status(403).json({ error: 'Tray API is only accessible from local machine loopback' });
  }
  next();
});

router.get('/status', (req, res) => {
  try {
    const playit = playitService.getStatus();
    const xbox = broadcasterService.getStatus();
    res.json({
      online: true,
      bdsState: serverProcess.state || 'stopped',
      playersCount: Array.isArray(serverProcess.players) ? serverProcess.players.length : 0,
      playitRunning: Boolean(playit && playit.isRunning),
      xboxRunning: Boolean(xbox && xbox.state === 'running'),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/action', async (req, res) => {
  const { action } = req.body || {};
  try {
    switch (action) {
      case 'start_bds':
        if (serverProcess.state !== 'running') {
          await serverProcess.start();
        }
        return res.json({ success: true, message: 'Bedrock Server started' });

      case 'stop_bds':
        if (serverProcess.state === 'running') {
          await serverProcess.stop();
        }
        return res.json({ success: true, message: 'Bedrock Server stopped' });

      case 'restart_bds':
        await serverProcess.restart();
        return res.json({ success: true, message: 'Bedrock Server restarted' });

      case 'start_all':
        if (serverProcess.state !== 'running') {
          await serverProcess.start().catch((e) => console.warn('[TrayAction] start_bds error:', e.message));
        }
        if (!playitService.getStatus().isRunning) {
          await playitService.start().catch((e) => console.warn('[TrayAction] start_playit error:', e.message));
        }
        if (broadcasterService.getStatus().account?.authenticated && broadcasterService.getStatus().state !== 'running') {
          await broadcasterService.start().catch((e) => console.warn('[TrayAction] start_xbox error:', e.message));
        }
        return res.json({ success: true, message: 'All services started' });

      case 'restart_all':
        await serverProcess.restart().catch((e) => console.warn('[TrayAction] restart_bds error:', e.message));
        await playitService.restart().catch((e) => console.warn('[TrayAction] restart_playit error:', e.message));
        if (broadcasterService.getStatus().account?.authenticated) {
          await broadcasterService.restart().catch((e) => console.warn('[TrayAction] restart_xbox error:', e.message));
        }
        return res.json({ success: true, message: 'All services restarted' });

      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
