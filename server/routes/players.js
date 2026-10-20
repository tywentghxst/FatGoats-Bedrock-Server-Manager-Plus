const express = require('express');
const { authenticate, requireAdmin } = require('../middleware/auth');
const playerService = require('../services/playerService');
const serverProcess = require('../services/serverProcess');
const { logAudit } = require('../services/auditService');

const router = express.Router();

/**
 * GET /
 * (authenticate) Get live and offline players
 */
router.get('/', authenticate, (req, res) => {
  try {
    const data = playerService.getPlayers(serverProcess);
    return res.json(data);
  } catch (err) {
    console.error('[PlayersRoute] Error listing players:', err);
    return res.status(500).json({ error: 'Failed to retrieve players', details: err.message });
  }
});

/**
 * POST /op
 * (authenticate, requireAdmin) OP or DEOP a player
 */
router.post('/op', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, isOp } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = await playerService.setPlayerOp(name, Boolean(isOp), serverProcess);
    logAudit(req.user.id, req.user.username, isOp ? 'OP_PLAYER' : 'DEOP_PLAYER', { name, isOp });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error updating player OP:', err);
    return res.status(500).json({ error: 'Failed to update player permissions', details: err.message });
  }
});

/**
 * POST /permission
 * (authenticate, requireAdmin) Set player permission level ('operator' | 'member' | 'visitor')
 */
router.post('/permission', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, permission } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = await playerService.setPlayerPermission(name, permission, serverProcess);
    logAudit(req.user.id, req.user.username, 'SET_PLAYER_PERMISSION', { name, permission });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error setting player permission:', err);
    return res.status(500).json({ error: 'Failed to update player permission', details: err.message });
  }
});

/**
 * POST /allowlist
 * (authenticate, requireAdmin) Add or remove player from allowlist
 */
router.post('/allowlist', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, isAllowlisted, xuid } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = await playerService.setPlayerAllowlist(name, Boolean(isAllowlisted), xuid, serverProcess);
    logAudit(req.user.id, req.user.username, isAllowlisted ? 'ALLOWLIST_ADD' : 'ALLOWLIST_REMOVE', { name, isAllowlisted });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error updating allowlist:', err);
    return res.status(500).json({ error: 'Failed to update allowlist', details: err.message });
  }
});

/**
 * POST /kick
 * (authenticate, requireAdmin) Kick an online player
 */
router.post('/kick', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, reason } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = playerService.kickPlayer(name, reason, serverProcess);
    logAudit(req.user.id, req.user.username, 'KICK_PLAYER', { name, reason });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error kicking player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /ban
 * (authenticate, requireAdmin) Ban a player (online or offline) and kick if online
 */
router.post('/ban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name, reason } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = await playerService.banPlayer(name, reason, req.user.username, serverProcess);
    logAudit(req.user.id, req.user.username, 'BAN_PLAYER', { name, reason });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error banning player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /unban
 * (authenticate, requireAdmin) Unban a player
 */
router.post('/unban', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = await playerService.unbanPlayer(name, serverProcess);
    logAudit(req.user.id, req.user.username, 'UNBAN_PLAYER', { name });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error unbanning player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /heal
 * (authenticate, requireAdmin) Instantly heal an online player to max health
 */
router.post('/heal', authenticate, requireAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = playerService.healPlayer(name, serverProcess);
    logAudit(req.user.id, req.user.username, 'HEAL_PLAYER', { name });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error healing player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /feed
 * (authenticate, requireAdmin) Instantly fill hunger and saturation meters to full
 */
router.post('/feed', authenticate, requireAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = playerService.feedPlayer(name, serverProcess);
    logAudit(req.user.id, req.user.username, 'FEED_PLAYER', { name });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error feeding player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /heal-feed
 * (authenticate, requireAdmin) Instantly heal and fill hunger together
 */
router.post('/heal-feed', authenticate, requireAdmin, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = playerService.healAndFeedPlayer(name, serverProcess);
    logAudit(req.user.id, req.user.username, 'HEAL_AND_FEED_PLAYER', { name });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error healing and feeding player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /add
 * (authenticate, requireAdmin) Pre-register an offline player
 */
router.post('/add', authenticate, requireAdmin, (req, res) => {
  try {
    const { name, xuid, isOp, permission, isAllowlisted } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    const result = playerService.addPlayer(name, xuid, Boolean(isOp), permission, Boolean(isAllowlisted), serverProcess);
    logAudit(req.user.id, req.user.username, 'ADD_PLAYER', { name, xuid, isOp, permission, isAllowlisted });
    return res.status(201).json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error adding player:', err);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /:name
 * (authenticate, requireAdmin) Delete player from history
 */
router.delete('/:name', authenticate, requireAdmin, (req, res) => {
  try {
    const { name } = req.params;
    const result = playerService.deletePlayer(name, serverProcess);
    logAudit(req.user.id, req.user.username, 'DELETE_PLAYER', { name });
    return res.json(result);
  } catch (err) {
    console.error('[PlayersRoute] Error removing player:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
