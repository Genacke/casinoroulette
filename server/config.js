const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const rootDir = path.resolve(__dirname, "..");
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const defaultDbDir =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(rootDir, "database");

const config = {
  rootDir,
  port: toInt(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(defaultDbDir, "casino.sqlite"),
  jwtSecret: process.env.JWT_SECRET || "change-this-secret-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  cookieName: "roulette_session",
  houseEdgePercent: Number(process.env.HOUSE_EDGE_PERCENT || 2),
  cashoutFeePercent: Number(process.env.CASHOUT_FEE_PERCENT || 2),
  minBet: toInt(process.env.MIN_BET, 200000),
  maxBet: toInt(process.env.MAX_BET, 2000000),
  greenMaxBet: toInt(process.env.GREEN_MAX_BET, 500000),
  roundIntervalSeconds: Math.max(
    1,
    Math.min(30, toInt(process.env.ROUND_INTERVAL_SECONDS, 30)),
  ),
  roundBetLockSeconds: toInt(process.env.ROUND_BET_LOCK_SECONDS, 5),
  autoSpinMaxRounds: toInt(process.env.AUTO_SPIN_MAX_ROUNDS, 25),
  pokerTableBuyIn: toInt(process.env.POKER_TABLE_BUY_IN, 10000000),
  pokerSmallBlind: toInt(process.env.POKER_SMALL_BLIND, 200000),
  pokerBigBlind: toInt(process.env.POKER_BIG_BLIND, 400000),
  pokerMinPlayers: toInt(process.env.POKER_MIN_PLAYERS, 2),
  pokerMaxPlayers: toInt(process.env.POKER_MAX_PLAYERS, 6),
  pokerTurnSeconds: toInt(process.env.POKER_TURN_SECONDS, 25),
  pokerShowdownSeconds: toInt(process.env.POKER_SHOWDOWN_SECONDS, 10),
  adminUsername: process.env.ADMIN_USERNAME || "admin",
  adminPassword: process.env.ADMIN_PASSWORD || "ChangeMe123!",
  isProduction: process.env.NODE_ENV === "production",
};

config.cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.isProduction,
  maxAge: 1000 * 60 * 60 * 12,
};

module.exports = { config };
