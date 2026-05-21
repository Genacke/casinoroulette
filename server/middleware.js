const rateLimit = require("express-rate-limit");
const { get } = require("./db");
const { verifyToken } = require("./auth");
const { config } = require("./config");

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function limitMessage(message) {
  return {
    success: false,
    message,
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Trop de tentatives de connexion. Reessaie plus tard."),
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Trop de creations de compte depuis cette IP."),
});

const spinLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Trop de tickets envoyes. Respire une seconde."),
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Trop d'actions admin sur cette minute."),
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage("Le chat est temporairement limite pour eviter le spam."),
});

function createCooldown(windowMs, keyBuilder, message) {
  const lastActionByKey = new Map();

  return (req, res, next) => {
    const key = keyBuilder(req);
    const now = Date.now();
    const previous = lastActionByKey.get(key) || 0;

    if (now - previous < windowMs) {
      res.status(429).json({
        success: false,
        message,
      });
      return;
    }

    lastActionByKey.set(key, now);
    next();
  };
}

const spinCooldown = createCooldown(
  2500,
  (req) => `${req.ip}:${req.user?.id || "guest"}`,
  "Un ticket vient deja d'etre envoye. Attends un instant.",
);

const chatCooldown = createCooldown(
  3500,
  (req) => `${req.ip}:${req.user?.id || "guest"}`,
  "Le chat a un anti-spam actif. Attends un instant.",
);

async function hydrateUserFromCookie(req) {
  const token = req.cookies?.[config.cookieName];

  if (!token) {
    return null;
  }

  try {
    const payload = verifyToken(token);
    const user = await get(
      `
        SELECT *
        FROM users
        WHERE id = ? AND token_version = ?
      `,
      [payload.sub, payload.version || 0],
    );

    return user || null;
  } catch (error) {
    return null;
  }
}

function optionalAuth(req, res, next) {
  hydrateUserFromCookie(req)
    .then((user) => {
      req.user = user;
      next();
    })
    .catch(next);
}

function requireAuth(req, res, next) {
  hydrateUserFromCookie(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({
          success: false,
          message: "Authentification requise.",
        });
        return;
      }

      req.user = user;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  hydrateUserFromCookie(req)
    .then((user) => {
      if (!user || user.role !== "admin") {
        res.status(403).json({
          success: false,
          message: "Acces admin refuse.",
        });
        return;
      }

      req.user = user;
      next();
    })
    .catch(next);
}

module.exports = {
  adminLimiter,
  asyncHandler,
  chatCooldown,
  chatLimiter,
  loginLimiter,
  optionalAuth,
  registerLimiter,
  requireAdmin,
  requireAuth,
  spinCooldown,
  spinLimiter,
};
