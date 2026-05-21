const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { config } = require("./config");
const { levelFromWagered } = require("./utils");

function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      version: user.token_version || 0,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
    },
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function setAuthCookie(res, user) {
  res.cookie(config.cookieName, signToken(user), config.cookieOptions);
}

function clearAuthCookie(res) {
  res.clearCookie(config.cookieName, config.cookieOptions);
}

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    balance: Number(user.balance || 0),
    totalWagered: Number(user.total_wagered || 0),
    totalWon: Number(user.total_won || 0),
    totalProfit: Number(user.total_profit || 0),
    highestWin: Number(user.highest_win || 0),
    level: levelFromWagered(user.total_wagered),
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  };
}

module.exports = {
  clearAuthCookie,
  comparePassword,
  hashPassword,
  serializeUser,
  setAuthCookie,
  signToken,
  verifyToken,
};
