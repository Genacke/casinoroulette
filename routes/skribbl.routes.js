const express = require("express");
const { serializeUser } = require("../server/auth");
const {
  asyncHandler,
  requireAuth,
  skribblCooldown,
  skribblLimiter,
} = require("../server/middleware");
const {
  buildSkribblState,
  clearSkribblCanvas,
  joinSkribblRoom,
  leaveSkribblRoom,
  submitSkribblGuess,
  submitSkribblStroke,
} = require("../server/skribbl");

const router = express.Router();

router.get(
  "/state",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      skribbl: await buildSkribblState(req.user.id),
    });
  }),
);

router.post(
  "/join",
  requireAuth,
  skribblLimiter,
  skribblCooldown,
  asyncHandler(async (req, res) => {
    const user = await joinSkribblRoom(req.user.id);

    res.json({
      success: true,
      message: "Tu poses 100 000 kamas et prends place dans la salle Skribbl.",
      user: serializeUser(user),
      skribbl: await buildSkribblState(req.user.id),
    });
  }),
);

router.post(
  "/leave",
  requireAuth,
  skribblLimiter,
  skribblCooldown,
  asyncHandler(async (req, res) => {
    const user = await leaveSkribblRoom(req.user.id);

    res.json({
      success: true,
      message: "Tu quittes la salle Skribbl.",
      user: serializeUser(user),
      skribbl: await buildSkribblState(req.user.id),
    });
  }),
);

router.post(
  "/guess",
  requireAuth,
  skribblLimiter,
  skribblCooldown,
  asyncHandler(async (req, res) => {
    const payload = await submitSkribblGuess(req.user.id, req.body?.guess);

    res.json({
      success: true,
      message: payload.isCorrect
        ? `Bien vu, tu verrouilles la place #${payload.rank}.`
        : "Pas ce mot.",
      user: serializeUser(payload.user),
      skribbl: await buildSkribblState(req.user.id),
      isCorrect: payload.isCorrect,
      rank: payload.rank,
    });
  }),
);

router.post(
  "/stroke",
  requireAuth,
  skribblLimiter,
  skribblCooldown,
  asyncHandler(async (req, res) => {
    const user = await submitSkribblStroke(req.user.id, req.body?.stroke);

    res.json({
      success: true,
      message: "Trait enregistre.",
      user: serializeUser(user),
      skribbl: await buildSkribblState(req.user.id),
    });
  }),
);

router.post(
  "/clear",
  requireAuth,
  skribblLimiter,
  skribblCooldown,
  asyncHandler(async (req, res) => {
    const user = await clearSkribblCanvas(req.user.id);

    res.json({
      success: true,
      message: "Tableau efface.",
      user: serializeUser(user),
      skribbl: await buildSkribblState(req.user.id),
    });
  }),
);

module.exports = router;
