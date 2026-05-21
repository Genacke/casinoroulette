const express = require("express");
const {
  clearAuthCookie,
  comparePassword,
  hashPassword,
  serializeUser,
  setAuthCookie,
} = require("../server/auth");
const { all, get, run } = require("../server/db");
const {
  asyncHandler,
  loginLimiter,
  optionalAuth,
  registerLimiter,
  requireAuth,
} = require("../server/middleware");
const { normalizeUsername } = require("../server/utils");

const router = express.Router();

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;

async function writeLoginLog({
  userId = null,
  usernameAttempt,
  roleAttempt = "unknown",
  ipAddress,
  userAgent,
  success,
}) {
  await run(
    `
      INSERT INTO login_logs (
        user_id,
        username_attempt,
        role_attempt,
        ip_address,
        user_agent,
        success
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      usernameAttempt,
      roleAttempt,
      ipAddress,
      userAgent,
      success ? 1 : 0,
    ],
  );
}

router.get(
  "/me",
  optionalAuth,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      res.json({
        success: true,
        user: null,
      });
      return;
    }

    res.json({
      success: true,
      user: serializeUser(req.user),
    });
  }),
);

router.post(
  "/register",
  registerLimiter,
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!USERNAME_PATTERN.test(username)) {
      res.status(400).json({
        success: false,
        message:
          "Le pseudo doit contenir 3 a 16 caracteres alphanumeriques, tirets ou underscores.",
      });
      return;
    }

    if (password.length < 8 || password.length > 72) {
      res.status(400).json({
        success: false,
        message: "Le mot de passe doit contenir entre 8 et 72 caracteres.",
      });
      return;
    }

    const existing = await get("SELECT id FROM users WHERE username = ?", [username]);
    if (existing) {
      res.status(409).json({
        success: false,
        message: "Ce pseudo existe deja.",
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const insert = await run(
      `
        INSERT INTO users (username, password_hash, role)
        VALUES (?, ?, 'player')
      `,
      [username, passwordHash],
    );

    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'info', ?)
      `,
      [
        insert.lastID,
        "Bienvenue au casino. Un admin devra crediter tes kamas apres remise IN GAME.",
      ],
    );

    const user = await get("SELECT * FROM users WHERE id = ?", [insert.lastID]);
    setAuthCookie(res, user);

    res.status(201).json({
      success: true,
      message: "Compte cree. Attends maintenant un credit admin pour jouer.",
      user: serializeUser(user),
    });
  }),
);

router.post(
  "/login",
  loginLimiter,
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body?.username);
    const password = String(req.body?.password || "");

    if (!username || !password) {
      res.status(400).json({
        success: false,
        message: "Pseudo et mot de passe obligatoires.",
      });
      return;
    }

    const user = await get("SELECT * FROM users WHERE username = ?", [username]);

    if (!user) {
      await writeLoginLog({
        usernameAttempt: username,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "unknown",
        success: false,
      });

      res.status(401).json({
        success: false,
        message: "Identifiants invalides.",
      });
      return;
    }

    const validPassword = await comparePassword(password, user.password_hash);

    if (!validPassword) {
      await writeLoginLog({
        userId: user.id,
        usernameAttempt: username,
        roleAttempt: user.role,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || "unknown",
        success: false,
      });

      res.status(401).json({
        success: false,
        message: "Identifiants invalides.",
      });
      return;
    }

    await run(
      `
        UPDATE users
        SET last_login_at = CURRENT_TIMESTAMP,
            last_ip = ?
        WHERE id = ?
      `,
      [req.ip, user.id],
    );

    await writeLoginLog({
      userId: user.id,
      usernameAttempt: username,
      roleAttempt: user.role,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || "unknown",
      success: true,
    });

    const freshUser = await get("SELECT * FROM users WHERE id = ?", [user.id]);
    setAuthCookie(res, freshUser);

    res.json({
      success: true,
      message: freshUser.role === "admin" ? "Connexion admin reussie." : "Connexion reussie.",
      user: serializeUser(freshUser),
    });
  }),
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    clearAuthCookie(res);
    res.json({
      success: true,
      message: "Session fermee.",
    });
  }),
);

router.get(
  "/online",
  asyncHandler(async (_req, res) => {
    const rows = await all(
      `
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'player'
      `,
    );

    res.json({
      success: true,
      totalPlayers: Number(rows[0]?.count || 0),
    });
  }),
);

module.exports = router;
