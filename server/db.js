const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { config } = require("./config");
const { hashPassword } = require("./auth");

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new sqlite3.Database(config.dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows || []);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function columnExists(tableName, columnName) {
  const rows = await all(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function ensureColumn(tableName, columnName, definition) {
  if (await columnExists(tableName, columnName)) {
    return;
  }

  await exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function withTransaction(callback) {
  await exec("BEGIN IMMEDIATE TRANSACTION");

  try {
    const result = await callback();
    await exec("COMMIT");
    return result;
  } catch (error) {
    await exec("ROLLBACK");
    throw error;
  }
}

async function setSetting(key, value) {
  await run(
    `
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `,
    [key, String(value)],
  );
}

async function getSetting(key, fallback = null) {
  const row = await get("SELECT value FROM settings WHERE key = ?", [key]);
  return row ? row.value : fallback;
}

async function initializeDatabase() {
  await exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')),
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      total_wagered INTEGER NOT NULL DEFAULT 0,
      total_won INTEGER NOT NULL DEFAULT 0,
      total_profit INTEGER NOT NULL DEFAULT 0,
      highest_win INTEGER NOT NULL DEFAULT 0,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      last_ip TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      round_id INTEGER,
      username_snapshot TEXT NOT NULL,
      result_number INTEGER NOT NULL,
      result_color TEXT NOT NULL,
      total_bet INTEGER NOT NULL,
      total_payout INTEGER NOT NULL DEFAULT 0,
      net_result INTEGER NOT NULL,
      house_delta INTEGER NOT NULL,
      jackpot_contribution INTEGER NOT NULL DEFAULT 0,
      jackpot_win INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      spin_id INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      bet_value TEXT NOT NULL,
      amount INTEGER NOT NULL,
      did_win INTEGER NOT NULL,
      probability REAL NOT NULL,
      payout_multiplier REAL NOT NULL,
      total_return INTEGER NOT NULL DEFAULT 0,
      net_result INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(spin_id) REFERENCES spins(id)
    );

    CREATE TABLE IF NOT EXISTS balance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      admin_user_id INTEGER,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_before INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(admin_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS login_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username_attempt TEXT NOT NULL,
      role_attempt TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username_snapshot TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS roulette_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_key INTEGER NOT NULL UNIQUE,
      opens_at TEXT NOT NULL,
      closes_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK(status IN ('open', 'resolving', 'resolved')),
      result_number INTEGER,
      result_color TEXT,
      winning_pocket_index INTEGER,
      total_bet INTEGER NOT NULL DEFAULT 0,
      total_payout INTEGER NOT NULL DEFAULT 0,
      house_delta INTEGER NOT NULL DEFAULT 0,
      jackpot_contribution INTEGER NOT NULL DEFAULT 0,
      jackpot_win_total INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS scheduled_bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      bet_value TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'resolved', 'voided')),
      resolved_spin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(round_id) REFERENCES roulette_rounds(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(resolved_spin_id) REFERENCES spins(id)
    );

    CREATE INDEX IF NOT EXISTS idx_spins_user_created_at
      ON spins (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bets_user_created_at
      ON bets (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_balance_logs_user_created_at
      ON balance_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_login_logs_created_at
      ON login_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rounds_status_key
      ON roulette_rounds (status, round_key DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_bets_round_user
      ON scheduled_bets (round_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_bets_user_status
      ON scheduled_bets (user_id, status, created_at DESC);
  `);

  await ensureColumn("spins", "round_id", "INTEGER");
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_spins_round_id
      ON spins (round_id);
  `);

  if ((await getSetting("jackpot_pool")) === null) {
    await setSetting("jackpot_pool", config.initialJackpotPool);
  }

  const adminHash = await hashPassword(config.adminPassword);
  const existingAdmin = await get("SELECT id FROM users WHERE username = ?", [
    config.adminUsername,
  ]);

  if (existingAdmin) {
    await run(
      `
        UPDATE users
        SET password_hash = ?, role = 'admin'
        WHERE id = ?
      `,
      [adminHash, existingAdmin.id],
    );
  } else {
    await run(
      `
        INSERT INTO users (username, password_hash, role, balance)
        VALUES (?, ?, 'admin', 0)
      `,
      [config.adminUsername, adminHash],
    );
  }
}

module.exports = {
  all,
  db,
  exec,
  get,
  getSetting,
  initializeDatabase,
  run,
  setSetting,
  withTransaction,
};
