const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');
const { authenticate } = require('../middleware/auth');
const { logAudit } = require('../services/auditService');

const router = express.Router();

/**
 * POST /login
 * Validate username/password with bcryptjs, return JWT token and user object {id, username, role}
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }

    const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const payload = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });

    logAudit(user.id, user.username, 'USER_LOGIN', `User ${user.username} logged in successfully.`);

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('[AuthRoute] Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login.' });
  }
});

/**
 * POST /register
 * Require inviteToken, username, password.
 * Validate invite token exists and is not used.
 * Create user with invite's role. Mark invite as used. Return JWT and user.
 */
router.post('/register', async (req, res) => {
  try {
    const { inviteToken, username, password } = req.body;

    if (!inviteToken || !username || !password) {
      return res.status(400).json({ error: 'Invite token, username, and password are required.' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check invite token
    const invite = db.prepare('SELECT id, token, role, used FROM invites WHERE token = ?').get(inviteToken);
    if (!invite) {
      return res.status(400).json({ error: 'Invalid invite token.' });
    }

    if (invite.used) {
      return res.status(400).json({ error: 'This invite token has already been used.' });
    }

    // Check if username is already taken
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already in use.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Transaction to create user and mark invite used
    const registerTx = db.transaction(() => {
      const insertStmt = db.prepare(`
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, ?)
      `);
      const insertResult = insertStmt.run(username, passwordHash, invite.role);
      const newUserId = insertResult.lastInsertRowid;

      const updateInviteStmt = db.prepare('UPDATE invites SET used = 1 WHERE id = ?');
      updateInviteStmt.run(invite.id);

      return newUserId;
    });

    const newUserId = registerTx();

    const payload = {
      id: newUserId,
      username,
      role: invite.role
    };

    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });

    logAudit(newUserId, username, 'USER_REGISTER', `User registered using invite token: ${inviteToken} with role: ${invite.role}`);

    return res.status(201).json({
      token,
      user: {
        id: newUserId,
        username,
        role: invite.role
      }
    });
  } catch (err) {
    console.error('[AuthRoute] Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

/**
 * GET /me
 * Return current user info from req.user
 */
router.get('/me', authenticate, (req, res) => {
  return res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      role: req.user.role,
      created_at: req.user.created_at
    }
  });
});

/**
 * PUT /credentials
 * (authenticate) Change login username and/or password for the current user
 */
router.put('/credentials', authenticate, async (req, res) => {
  try {
    const { username, currentPassword, newPassword } = req.body;

    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required to authorize changes.' });
    }

    // Retrieve current user with password_hash
    const user = db.prepare('SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    // Verify current password
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    let finalUsername = user.username;
    let finalHash = user.password_hash;
    let usernameChanged = false;
    let passwordChanged = false;

    // Check if new username requested
    if (username && username.trim() && username.trim() !== user.username) {
      const cleanUsername = username.trim();
      if (cleanUsername.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters long.' });
      }

      // Check if username already exists for another user
      const existing = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ?').get(cleanUsername, user.id);
      if (existing) {
        return res.status(409).json({ error: 'Username is already taken by another user.' });
      }

      finalUsername = cleanUsername;
      usernameChanged = true;
    }

    // Check if new password requested
    if (newPassword && newPassword.trim()) {
      const cleanPass = newPassword.trim();
      if (cleanPass.length < 4) {
        return res.status(400).json({ error: 'New password must be at least 4 characters long.' });
      }

      const salt = await bcrypt.genSalt(10);
      finalHash = await bcrypt.hash(cleanPass, salt);
      passwordChanged = true;
    }

    if (!usernameChanged && !passwordChanged) {
      return res.status(400).json({ error: 'No changes provided. Please enter a new username or new password.' });
    }

    // Update in database
    db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?').run(finalUsername, finalHash, user.id);

    // Sign fresh token with updated username
    const payload = {
      id: user.id,
      username: finalUsername,
      role: user.role
    };
    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });

    logAudit(user.id, finalUsername, 'USER_CREDENTIALS_UPDATE', {
      previousUsername: user.username,
      newUsername: finalUsername,
      usernameChanged,
      passwordChanged
    });

    return res.json({
      success: true,
      message: 'Admin credentials updated successfully!',
      token,
      user: {
        id: user.id,
        username: finalUsername,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('[AuthRoute] Error updating credentials:', err);
    return res.status(500).json({ error: 'Internal server error updating credentials.', details: err.message });
  }
});

module.exports = router;
