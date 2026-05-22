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
  jackpotContributionPercent: Number(
    process.env.JACKPOT_CONTRIBUTION_PERCENT || 0,
  ),
  initialJackpotPool: toInt(process.env.INITIAL_JACKPOT_POOL, 0),
  minBet: toInt(process.env.MIN_BET, 100000),
  maxBet: toInt(process.env.MAX_BET, 5000000),
  greenMaxBet: toInt(process.env.GREEN_MAX_BET, 500000),
  roundIntervalSeconds: toInt(process.env.ROUND_INTERVAL_SECONDS, 120),
  roundBetLockSeconds: toInt(process.env.ROUND_BET_LOCK_SECONDS, 5),
  autoSpinMaxRounds: toInt(process.env.AUTO_SPIN_MAX_ROUNDS, 25),
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
