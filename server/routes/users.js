const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');

const router = express.Router();

// All user management routes require authentication and admin privileges
router.use(authenticate, requireAdmin);

/**
 * GET /
 * List all users (excluding password_hash)
 */
router.get('/', (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, username, role, created_at
      FROM users
      ORDER BY id ASC
    `).all();

    return res.json({ users });
  } catch (err) {
    console.error('[UsersRoute] Error fetching users:', err);
    return res.status(500).json({ error: 'Failed to retrieve users', details: err.message });
  }
});

/**
 * PUT /:id/role
 * Update user role, prevent self-demotion, logAudit
 */
router.put('/:id/role', (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { role } = req.body;

    if (!role || !['admin', 'operator', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Valid role is required (admin, operator, or viewer).' });
    }

    if (req.user.id === targetUserId && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot demote yourself from the admin role.' });
    }

    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const updateStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    updateStmt.run(role, targetUserId);

    logAudit(req.user.id, req.user.username, 'USER_ROLE_UPDATE', {
      targetUserId,
      targetUsername: user.username,
      previousRole: user.role,
      newRole: role
    });

    return res.json({
      success: true,
      message: `User ${user.username} role updated to ${role}.`,
      user: {
        id: user.id,
        username: user.username,
        role
      }
    });
  } catch (err) {
    console.error('[UsersRoute] Error updating user role:', err);
    return res.status(500).json({ error: 'Failed to update user role', details: err.message });
  }
});

/**
 * DELETE /:id
 * Delete user, prevent self-deletion, logAudit
 */
router.delete('/:id', (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);

    if (req.user.id === targetUserId) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(targetUserId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Check if user is the last admin
    if (user.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count;
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the only remaining admin account.' });
      }
    }

    const deleteStmt = db.prepare('DELETE FROM users WHERE id = ?');
    deleteStmt.run(targetUserId);

    logAudit(req.user.id, req.user.username, 'USER_DELETE', {
      targetUserId,
      targetUsername: user.username
    });

    return res.json({
      success: true,
      message: `User ${user.username} deleted successfully.`
    });
  } catch (err) {
    console.error('[UsersRoute] Error deleting user:', err);
    return res.status(500).json({ error: 'Failed to delete user', details: err.message });
  }
});

/**
 * POST /invites
 * Create invite token (use uuid v4), logAudit
 */
router.post('/invites', (req, res) => {
  try {
    const { role = 'viewer' } = req.body;

    if (!['admin', 'operator', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Role must be either admin, operator, or viewer.' });
    }

    const token = uuidv4();
    const insertStmt = db.prepare(`
      INSERT INTO invites (token, role, used, created_by, created_at)
      VALUES (?, ?, 0, ?, datetime('now'))
    `);
    const info = insertStmt.run(token, role, req.user.id);

    logAudit(req.user.id, req.user.username, 'CREATE_INVITE', {
      inviteId: info.lastInsertRowid,
      token,
      role
    });

    return res.status(201).json({
      id: info.lastInsertRowid,
      token,
      role,
      used: 0,
      created_by: req.user.id
    });
  } catch (err) {
    console.error('[UsersRoute] Error creating invite:', err);
    return res.status(500).json({ error: 'Failed to create invite', details: err.message });
  }
});

/**
 * GET /invites
 * List invites
 */
router.get('/invites', (req, res) => {
  try {
    const invites = db.prepare(`
      SELECT i.id, i.token, i.role, i.used, i.created_by, i.created_at, u.username AS creator_username
      FROM invites i
      LEFT JOIN users u ON i.created_by = u.id
      ORDER BY i.id DESC
    `).all();

    return res.json({ invites });
  } catch (err) {
    console.error('[UsersRoute] Error listing invites:', err);
    return res.status(500).json({ error: 'Failed to retrieve invites', details: err.message });
  }
});

/**
 * DELETE /invites/:id
 * Delete invite, logAudit
 */
router.delete('/invites/:id', (req, res) => {
  try {
    const inviteId = parseInt(req.params.id, 10);
    const invite = db.prepare('SELECT id, token, role, used FROM invites WHERE id = ?').get(inviteId);

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found.' });
    }

    db.prepare('DELETE FROM invites WHERE id = ?').run(inviteId);

    logAudit(req.user.id, req.user.username, 'DELETE_INVITE', {
      inviteId,
      token: invite.token
    });

    return res.json({
      success: true,
      message: `Invite ${invite.token} deleted successfully.`
    });
  } catch (err) {
    console.error('[UsersRoute] Error deleting invite:', err);
    return res.status(500).json({ error: 'Failed to delete invite', details: err.message });
  }
});

module.exports = router;
