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
    res.json({
      success: true,
      poker: await buildPokerState(req.user.id),
    });
  }),
);

router.post(
  "/join",
  requireAuth,
  pokerLimiter,
  pokerCooldown,
  asyncHandler(async (req, res) => {
    const payload = await joinPokerTable(req.user.id);

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
    const payload = await leavePokerTable(req.user.id);

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

    if (!["fold", "check", "call", "raise"].includes(action)) {
      res.status(400).json({
        success: false,
        message: "Action poker invalide.",
      });
      return;
    }

    const payload = await actOnPokerTable(req.user.id, action, amount);
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
