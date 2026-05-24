const express = require("express");
const { serializeUser } = require("../server/auth");
const { get } = require("../server/db");
const {
  asyncHandler,
  connect4Cooldown,
  connect4Limiter,
  requireAuth,
} = require("../server/middleware");
const {
  buildConnect4State,
  joinConnect4Table,
  leaveConnect4Table,
  playConnect4Move,
} = require("../server/connect4");

const router = express.Router();

router.get(
  "/state",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      connect4: await buildConnect4State(req.user.id),
    });
  }),
);

router.post(
  "/join",
  requireAuth,
  connect4Limiter,
  connect4Cooldown,
  asyncHandler(async (req, res) => {
    const user = await joinConnect4Table(req.user.id);

    res.json({
      success: true,
      message: "Tu prends place a la table Puissance 4 Blitz.",
      user: serializeUser(user),
      connect4: await buildConnect4State(req.user.id),
    });
  }),
);

router.post(
  "/leave",
  requireAuth,
  connect4Limiter,
  connect4Cooldown,
  asyncHandler(async (req, res) => {
    const user = await leaveConnect4Table(req.user.id);
    const freshUser = user || (await get("SELECT * FROM users WHERE id = ?", [req.user.id]));

    res.json({
      success: true,
      message: "Tu quittes la table Puissance 4 Blitz.",
      user: serializeUser(freshUser),
      connect4: await buildConnect4State(req.user.id),
    });
  }),
);

router.post(
  "/move",
  requireAuth,
  connect4Limiter,
  connect4Cooldown,
  asyncHandler(async (req, res) => {
    const user = await playConnect4Move(req.user.id, req.body?.column);

    res.json({
      success: true,
      message: "Jeton pose.",
      user: serializeUser(user),
      connect4: await buildConnect4State(req.user.id),
    });
  }),
);

module.exports = router;
