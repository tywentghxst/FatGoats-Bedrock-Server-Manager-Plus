const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../database');

/**
 * Middleware to authenticate requests via JWT Bearer token.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found or revoked.' });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.', details: err.message });
  }
}

/**
 * Middleware to restrict access to admin users.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  next();
}

/**
 * Middleware to restrict access to admin or operator users (can control server power).
 */
function requireOperatorOrAdmin(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or Admin privileges required.' });
  }
  next();
}

module.exports = {
  authenticate,
  requireAdmin,
  requireOperatorOrAdmin
};
