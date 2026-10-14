const db = require('../database');

/**
 * Log an action to the audit_logs table.
 * @param {number|null} userId - ID of user performing the action
 * @param {string|null} username - Username of the actor
 * @param {string} action - Action identifier (e.g. 'START_SERVER', 'UPDATE_PROPERTIES')
 * @param {string|object|null} details - Additional contextual details
 */
function logAudit(userId, username, action, details) {
  try {
    let detailsString = details;
    if (typeof details === 'object' && details !== null) {
      detailsString = JSON.stringify(details);
    } else if (details === undefined || details === null) {
      detailsString = '';
    } else {
      detailsString = String(details);
    }

    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, details, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `);
    const info = stmt.run(userId || null, username || 'system', action, detailsString);
    return { id: info.lastInsertRowid, success: true };
  } catch (err) {
    console.error('[AuditService] Failed to insert audit log:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Retrieve recent audit logs.
 * @param {number} limit - Maximum number of logs to return (default: 100)
 * @param {number} offset - Offset for pagination (default: 0)
 * @returns {Array} List of audit logs
 */
function getAuditLogs(limit = 100, offset = 0) {
  try {
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 100);
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    const stmt = db.prepare(`
      SELECT id, user_id, username, action, details, created_at
      FROM audit_logs
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(parsedLimit, parsedOffset);
  } catch (err) {
    console.error('[AuditService] Failed to retrieve audit logs:', err.message);
    return [];
  }
}

module.exports = {
  logAudit,
  getAuditLogs
};
