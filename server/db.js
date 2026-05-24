const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { config } = require("./config");
const { hashPassword } = require("./auth");

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new sqlite3.Database(config.dbPath);
let transactionQueue = Promise.resolve();

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
  const transactionRun = transactionQueue.then(async () => {
    await exec("BEGIN IMMEDIATE TRANSACTION");

    try {
      const result = await callback();
      await exec("COMMIT");
      return result;
    } catch (error) {
      await exec("ROLLBACK");
      throw error;
    }
  });

  transactionQueue = transactionRun.then(
    () => undefined,
    () => undefined,
  );

  return transactionRun;
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

    CREATE TABLE IF NOT EXISTS cashout_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username_snapshot TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount > 0),
      fee_percent REAL NOT NULL DEFAULT 0,
      fee_amount INTEGER NOT NULL DEFAULT 0,
      net_amount INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'completed', 'rejected', 'cancelled')),
      admin_user_id INTEGER,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      cancelled_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(admin_user_id) REFERENCES users(id)
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

    CREATE TABLE IF NOT EXISTS poker_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      buy_in INTEGER NOT NULL,
      small_blind INTEGER NOT NULL,
      big_blind INTEGER NOT NULL,
      min_players INTEGER NOT NULL DEFAULT 2,
      max_players INTEGER NOT NULL DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting', 'playing', 'showdown')),
      phase TEXT NOT NULL DEFAULT 'waiting'
        CHECK(phase IN ('waiting', 'preflop', 'flop', 'turn', 'river', 'showdown')),
      hand_number INTEGER NOT NULL DEFAULT 0,
      pot INTEGER NOT NULL DEFAULT 0,
      current_bet INTEGER NOT NULL DEFAULT 0,
      min_raise INTEGER NOT NULL DEFAULT 0,
      dealer_seat INTEGER NOT NULL DEFAULT 0,
      active_seat INTEGER NOT NULL DEFAULT 0,
      visible_board_count INTEGER NOT NULL DEFAULT 0,
      board_cards TEXT NOT NULL DEFAULT '[]',
      winner_summary TEXT,
      action_deadline TEXT,
      next_hand_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS poker_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      seat_no INTEGER NOT NULL,
      stack INTEGER NOT NULL DEFAULT 0,
      seat_state TEXT NOT NULL DEFAULT 'seated'
        CHECK(seat_state IN ('seated', 'active', 'folded', 'all_in', 'busted')),
      round_bet INTEGER NOT NULL DEFAULT 0,
      hand_contribution INTEGER NOT NULL DEFAULT 0,
      acted_this_round INTEGER NOT NULL DEFAULT 0,
      hole_cards TEXT NOT NULL DEFAULT '[]',
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(table_id) REFERENCES poker_tables(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS poker_action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      hand_number INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER,
      username_snapshot TEXT NOT NULL,
      action_type TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(table_id) REFERENCES poker_tables(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS connect4_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      entry_fee INTEGER NOT NULL,
      turn_seconds INTEGER NOT NULL,
      showdown_seconds INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'waiting'
        CHECK(status IN ('waiting', 'playing', 'showdown')),
      board_json TEXT NOT NULL DEFAULT '[]',
      red_user_id INTEGER,
      red_username_snapshot TEXT,
      yellow_user_id INTEGER,
      yellow_username_snapshot TEXT,
      active_color TEXT
        CHECK(active_color IN ('red', 'yellow')),
      active_user_id INTEGER,
      winner_user_id INTEGER,
      winner_color TEXT
        CHECK(winner_color IN ('red', 'yellow')),
      winner_reason TEXT,
      pot INTEGER NOT NULL DEFAULT 0,
      move_count INTEGER NOT NULL DEFAULT 0,
      action_deadline TEXT,
      next_game_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(red_user_id) REFERENCES users(id),
      FOREIGN KEY(yellow_user_id) REFERENCES users(id),
      FOREIGN KEY(active_user_id) REFERENCES users(id),
      FOREIGN KEY(winner_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS connect4_action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      user_id INTEGER,
      username_snapshot TEXT NOT NULL,
      action_type TEXT NOT NULL,
      color TEXT,
      column_no INTEGER,
      row_no INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(table_id) REFERENCES connect4_tables(id),
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS slot_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      server_seed TEXT NOT NULL,
      server_seed_hash TEXT NOT NULL,
      client_seed TEXT NOT NULL DEFAULT 'aventurier',
      next_nonce INTEGER NOT NULL DEFAULT 0,
      previous_server_seed TEXT,
      previous_server_seed_hash TEXT,
      previous_client_seed TEXT,
      previous_nonce INTEGER NOT NULL DEFAULT 0,
      free_spins_remaining INTEGER NOT NULL DEFAULT 0,
      bonus_multiplier INTEGER NOT NULL DEFAULT 2,
      bonus_bet INTEGER NOT NULL DEFAULT 0,
      total_spins INTEGER NOT NULL DEFAULT 0,
      total_bonus_spins INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS slot_spins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      username_snapshot TEXT NOT NULL,
      spin_mode TEXT NOT NULL CHECK(spin_mode IN ('base', 'bonus')),
      bet_amount INTEGER NOT NULL,
      total_win INTEGER NOT NULL DEFAULT 0,
      net_result INTEGER NOT NULL DEFAULT 0,
      hit INTEGER NOT NULL DEFAULT 0,
      cascade_count INTEGER NOT NULL DEFAULT 0,
      scatter_count INTEGER NOT NULL DEFAULT 0,
      free_spins_awarded INTEGER NOT NULL DEFAULT 0,
      free_spins_remaining INTEGER NOT NULL DEFAULT 0,
      bonus_multiplier_start INTEGER NOT NULL DEFAULT 1,
      bonus_multiplier_end INTEGER NOT NULL DEFAULT 1,
      max_applied_multiplier INTEGER NOT NULL DEFAULT 1,
      server_seed_hash TEXT NOT NULL,
      client_seed TEXT NOT NULL,
      nonce INTEGER NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_spins_user_created_at
      ON spins (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bets_user_created_at
      ON bets (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_balance_logs_user_created_at
      ON balance_logs (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cashout_requests_user_created_at
      ON cashout_requests (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cashout_requests_status_created_at
      ON cashout_requests (status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cashout_requests_user_pending
      ON cashout_requests (user_id)
      WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_login_logs_created_at
      ON login_logs (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_rounds_status_key
      ON roulette_rounds (status, round_key DESC);
    CREATE INDEX IF NOT EXISTS idx_scheduled_bets_round_user
      ON scheduled_bets (round_id, user_id, status);
    CREATE INDEX IF NOT EXISTS idx_scheduled_bets_user_status
      ON scheduled_bets (user_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_poker_seats_table_user
      ON poker_seats (table_id, user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_poker_seats_table_seat
      ON poker_seats (table_id, seat_no);
    CREATE INDEX IF NOT EXISTS idx_poker_action_logs_table_created
      ON poker_action_logs (table_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_connect4_action_logs_table_created
      ON connect4_action_logs (table_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_slot_spins_user_created
      ON slot_spins (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_slot_spins_mode_created
      ON slot_spins (spin_mode, created_at DESC);
  `);

  await ensureColumn("spins", "round_id", "INTEGER");
  await ensureColumn("cashout_requests", "fee_percent", "REAL NOT NULL DEFAULT 0");
  await ensureColumn("cashout_requests", "fee_amount", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("cashout_requests", "net_amount", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("poker_seats", "hand_contribution", "INTEGER NOT NULL DEFAULT 0");
  await exec(`
    CREATE INDEX IF NOT EXISTS idx_spins_round_id
      ON spins (round_id);
  `);

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
  initializeDatabase,
  run,
  withTransaction,
};
