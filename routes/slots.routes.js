const express = require("express");
const { serializeUser } = require("../server/auth");
const {
  asyncHandler,
  requireAuth,
  slotCooldown,
  slotLimiter,
} = require("../server/middleware");
const {
  buildSlotState,
  rotateSlotSeeds,
  spinSlots,
  updateSlotClientSeed,
} = require("../server/slots");

const router = express.Router();

router.get(
  "/state",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      slots: await buildSlotState(req.user.id),
    });
  }),
);

router.post(
  "/spin",
  requireAuth,
  slotLimiter,
  slotCooldown,
  asyncHandler(async (req, res) => {
    const payload = await spinSlots(req.user.id, req.body?.betAmount);

    res.json({
      success: true,
      message:
        payload.spinResult.mode === "bonus"
          ? "Free spin resolu."
          : "Les rouleaux s'arretent.",
      user: serializeUser(payload.user),
      slots: payload.slotState,
      spinResult: payload.spinResult,
    });
  }),
);

router.post(
  "/seed",
  requireAuth,
  slotLimiter,
  asyncHandler(async (req, res) => {
    const slots = await updateSlotClientSeed(req.user.id, req.body?.clientSeed);

    res.json({
      success: true,
      message: "Client seed mis a jour.",
      slots,
    });
  }),
);

router.post(
  "/seed/rotate",
  requireAuth,
  slotLimiter,
  asyncHandler(async (req, res) => {
    const slots = await rotateSlotSeeds(req.user.id, req.body?.clientSeed);

    res.json({
      success: true,
      message: "Nouvelle paire de seeds generee. Le seed precedent est revele.",
      slots,
    });
  }),
);

module.exports = router;
