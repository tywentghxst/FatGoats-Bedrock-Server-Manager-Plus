const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const bcrypt = require('bcryptjs');

let _sqlDb = null;
const _dbPath = config.DB_PATH;

/**
 * Persist the in-memory database to disk.
 * sql.js operates entirely in memory/WASM, so we export the full
 * database binary and write it after every mutation.
 */
function _save() {
  if (!_sqlDb) return;
  try {
    const data = _sqlDb.export();
    const dir = path.dirname(_dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(_dbPath, Buffer.from(data));
  } catch (err) {
    console.error('[Database] Error saving database:', err.message);
  }
}

/**
 * Wraps a SQL string to provide a better-sqlite3-compatible
 * .run() / .get() / .all() interface over sql.js.
 */
class StatementWrapper {
  constructor(db, sql) {
    this._db = db;
    this._sql = sql;
  }

  /**
   * Execute a write statement (INSERT, UPDATE, DELETE).
   * @param  {...any} params - Positional bind parameters
   * @returns {{ changes: number, lastInsertRowid: number }}
   */
  run(...params) {
    try {
      if (params.length > 0) {
        this._db.run(this._sql, params);
      } else {
        this._db.run(this._sql);
      }
      const changes = this._db.getRowsModified();
      let lastInsertRowid = 0;
      try {
        const res = this._db.exec('SELECT last_insert_rowid() AS id');
        if (res.length > 0 && res[0].values.length > 0) {
          lastInsertRowid = res[0].values[0][0];
        }
      } catch (_) { /* ignore */ }
      _save();
      return { changes, lastInsertRowid };
    } catch (err) {
      console.error(`[Database] Error in run: ${err.message}`);
      console.error(`[Database] SQL: ${this._sql}`);
      console.error(`[Database] Params:`, params);
      throw err;
    }
  }

  /**
   * Execute a read statement and return the first row as an object,
   * or undefined if no rows match.
   */
  get(...params) {
    let stmt;
    try {
      stmt = this._db.prepare(this._sql);
      if (params.length > 0) {
        stmt.bind(params);
      }
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } catch (err) {
      console.error(`[Database] Error in get: ${err.message}`);
      console.error(`[Database] SQL: ${this._sql}`);
      throw err;
    } finally {
      if (stmt) try { stmt.free(); } catch (_) { /* ignore */ }
    }
  }

  /**
   * Execute a read statement and return all matching rows as an array of objects.
   */
  all(...params) {
    let stmt;
    try {
      const results = [];
      stmt = this._db.prepare(this._sql);
      if (params.length > 0) {
        stmt.bind(params);
      }
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } catch (err) {
      console.error(`[Database] Error in all: ${err.message}`);
      console.error(`[Database] SQL: ${this._sql}`);
      throw err;
    } finally {
      if (stmt) try { stmt.free(); } catch (_) { /* ignore */ }
    }
  }
}

// ---------------------------------------------------------------------------
// Public database wrapper  (mirrors better-sqlite3 API surface)
// ---------------------------------------------------------------------------
const db = {
  /**
   * Initialise the sql.js WASM engine, load or create the database file,
   * create tables, and seed the default admin user.
   */
  async init() {
    const SQL = await initSqlJs();

    const dir = path.dirname(_dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(_dbPath)) {
      const fileBuffer = fs.readFileSync(_dbPath);
      _sqlDb = new SQL.Database(fileBuffer);
      console.log(`[Database] Loaded existing database from ${_dbPath}`);
    } else {
      _sqlDb = new SQL.Database();
      console.log(`[Database] Created new database at ${_dbPath}`);
    }

    // ----- Schema migration -----
    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        used INTEGER DEFAULT 0,
        created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `);

    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        action TEXT NOT NULL,
        details TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS addons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT DEFAULT '',
        path TEXT NOT NULL,
        group_id TEXT DEFAULT NULL,
        original_filename TEXT DEFAULT '',
        download_url TEXT DEFAULT '',
        display_name TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        is_system INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Safe column migrations for existing databases
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN group_id TEXT DEFAULT NULL'); } catch (_) {}
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN original_filename TEXT DEFAULT \'\''); } catch (_) {}
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN download_url TEXT DEFAULT \'\''); } catch (_) {}
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN display_name TEXT DEFAULT \'\''); } catch (_) {}
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN notes TEXT DEFAULT \'\''); } catch (_) {}
    try { _sqlDb.exec('ALTER TABLE addons ADD COLUMN is_system INTEGER DEFAULT 0'); } catch (_) {}

    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    _sqlDb.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        xuid TEXT,
        permission TEXT DEFAULT 'member',
        is_op INTEGER DEFAULT 0,
        is_online INTEGER DEFAULT 0,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now'))
      )
    `);

    // ----- Seed default admin account -----
    const adminCheck = this.prepare('SELECT id FROM users WHERE username = ?').get('admin');
    if (!adminCheck) {
      const hash = bcrypt.hashSync('admin', 10);
      this.prepare(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
      ).run('admin', hash, 'admin');
      console.log('[Database] Default admin created  (user: admin / pass: admin)');
    }

    _save();
    console.log('[Database] Initialization complete');
  },

  /** Create a reusable statement wrapper (better-sqlite3 compat). */
  prepare(sql) {
    if (!_sqlDb) throw new Error('Database not initialized – call db.init() first.');
    return new StatementWrapper(_sqlDb, sql);
  },

  /** Execute raw SQL (DDL / multi-statement). */
  exec(sql) {
    if (!_sqlDb) throw new Error('Database not initialized – call db.init() first.');
    _sqlDb.exec(sql);
    _save();
  },

  /**
   * better-sqlite3 compatible transaction wrapper
   */
  transaction(fn) {
    return (...args) => {
      const res = fn(...args);
      _save();
      return res;
    };
  },

  /** Set a PRAGMA (best-effort; some are unsupported in WASM). */
  pragma(str) {
    if (!_sqlDb) return;
    try { _sqlDb.exec(`PRAGMA ${str}`); } catch (_) { /* ignore */ }
  },

  getSetting(key, defaultValue = null) {
    if (!_sqlDb) return defaultValue;
    try {
      const row = this.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : defaultValue;
    } catch (_) {
      return defaultValue;
    }
  },

  setSetting(key, value) {
    if (!_sqlDb) return;
    try {
      this.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    } catch (err) {
      console.error(`[Database] Error setting ${key}:`, err.message);
    }
  },

  /** Flush & close the database. */
  close() {
    if (_sqlDb) {
      _save();
      _sqlDb.close();
      _sqlDb = null;
    }
  },
};

module.exports = db;
