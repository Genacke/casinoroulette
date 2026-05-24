const express = require("express");
const { serializeUser } = require("../server/auth");
const { get } = require("../server/db");
const {
  asyncHandler,
  pokerCooldown,
  pokerLimiter,
  requireAuth,
} = require("../server/middleware");
const {
  actOnPokerTable,
  buildPokerState,
  joinPokerTable,
  leavePokerTable,
} = require("../server/poker");

const router = express.Router();

router.get(
  "/state",
  requireAuth,
  asyncHandler(async (req, res) => {
    const tableSlug = String(req.query?.table || "").trim() || null;
    res.json({
      success: true,
      poker: await buildPokerState(req.user.id, tableSlug),
    });
  }),
);

router.post(
  "/join",
  requireAuth,
  pokerLimiter,
  pokerCooldown,
  asyncHandler(async (req, res) => {
    const tableSlug = String(req.body?.tableSlug || "").trim() || null;
    const payload = await joinPokerTable(req.user.id, tableSlug);

    res.json({
      success: true,
      message: "Tu prends place a la table poker.",
      user: serializeUser(payload.user),
      poker: payload.poker,
    });
  }),
);

router.post(
  "/leave",
  requireAuth,
  pokerLimiter,
  pokerCooldown,
  asyncHandler(async (req, res) => {
    const tableSlug = String(req.body?.tableSlug || "").trim() || null;
    const payload = await leavePokerTable(req.user.id, tableSlug);

    res.json({
      success: true,
      message: "Tu quittes la table poker.",
      user: serializeUser(payload.user),
      poker: payload.poker,
    });
  }),
);

router.post(
  "/action",
  requireAuth,
  pokerLimiter,
  pokerCooldown,
  asyncHandler(async (req, res) => {
    const action = String(req.body?.action || "").trim().toLowerCase();
    const amount = req.body?.amount;
    const tableSlug = String(req.body?.tableSlug || "").trim() || null;

    if (!["fold", "check", "call", "raise"].includes(action)) {
      res.status(400).json({
        success: false,
        message: "Action poker invalide.",
      });
      return;
    }

    const payload = await actOnPokerTable(req.user.id, tableSlug, action, amount);
    const user = payload.user || (await get("SELECT * FROM users WHERE id = ?", [req.user.id]));

    res.json({
      success: true,
      message:
        action === "fold"
          ? "Main couchee."
          : action === "check"
            ? "Check valide."
            : action === "call"
              ? "Mise suivie."
              : "Relance envoyee.",
      user: serializeUser(user),
      poker: payload.poker,
    });
  }),
);

module.exports = router;
