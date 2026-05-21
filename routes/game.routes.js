const express = require("express");
const { serializeUser } = require("../server/auth");
const { config } = require("../server/config");
const { all, get, getSetting, run } = require("../server/db");
const {
  asyncHandler,
  chatCooldown,
  chatLimiter,
  requireAuth,
  spinCooldown,
  spinLimiter,
} = require("../server/middleware");
const { getProbabilities, normalizeBet, WHEEL_ORDER } = require("../server/roulette");
const {
  buildRoundState,
  cancelPlayerTicket,
  getRecentRoundNumbers,
  setPlayerTicket,
} = require("../server/rounds");
const { normalizeMessage } = require("../server/utils");

const router = express.Router();

async function getPlayerStats(userId) {
  const [spinStats, favoriteBet] = await Promise.all([
    get(
      `
        SELECT
          COUNT(*) AS spins_played,
          COALESCE(SUM(CASE WHEN net_result > 0 THEN 1 ELSE 0 END), 0) AS winning_spins,
          COALESCE(SUM(total_bet), 0) AS total_bet,
          COALESCE(SUM(total_payout + jackpot_win), 0) AS total_paid
        FROM spins
        WHERE user_id = ?
      `,
      [userId],
    ),
    get(
      `
        SELECT bet_type, COUNT(*) AS total
        FROM bets
        WHERE user_id = ?
        GROUP BY bet_type
        ORDER BY total DESC, bet_type ASC
        LIMIT 1
      `,
      [userId],
    ),
  ]);

  const spinsPlayed = Number(spinStats?.spins_played || 0);
  const winningSpins = Number(spinStats?.winning_spins || 0);
  const totalBet = Number(spinStats?.total_bet || 0);
  const totalPaid = Number(spinStats?.total_paid || 0);

  return {
    spinsPlayed,
    winningSpins,
    winRate: spinsPlayed ? Number(((winningSpins / spinsPlayed) * 100).toFixed(1)) : 0,
    roi: totalBet ? Number((((totalPaid - totalBet) / totalBet) * 100).toFixed(1)) : 0,
    favoriteBetType: favoriteBet?.bet_type || "Aucune",
  };
}

async function getPlayerHistory(userId) {
  return all(
    `
      SELECT
        bets.id,
        bets.bet_type AS betType,
        bets.bet_value AS betValue,
        bets.amount,
        bets.did_win AS didWin,
        bets.total_return AS totalReturn,
        bets.net_result AS netResult,
        bets.created_at AS createdAt,
        spins.result_number AS resultNumber,
        spins.result_color AS resultColor
      FROM bets
      INNER JOIN spins ON spins.id = bets.spin_id
      WHERE bets.user_id = ?
      ORDER BY bets.id DESC
      LIMIT 18
    `,
    [userId],
  );
}

async function getLeaderboard() {
  return all(
    `
      SELECT
        username,
        balance,
        total_profit AS totalProfit,
        total_won AS totalWon,
        highest_win AS highestWin,
        total_wagered AS totalWagered
      FROM users
      WHERE role = 'player'
      ORDER BY total_profit DESC, total_won DESC, balance DESC
      LIMIT 10
    `,
  );
}

async function getChatMessages() {
  return all(
    `
      SELECT *
      FROM (
        SELECT
          id,
          username_snapshot AS username,
          message,
          created_at AS createdAt
        FROM chat_messages
        ORDER BY id DESC
        LIMIT 25
      )
      ORDER BY id ASC
    `,
  );
}

async function getNotifications(userId) {
  return all(
    `
      SELECT
        id,
        type,
        message,
        is_read AS isRead,
        created_at AS createdAt
      FROM notifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 10
    `,
    [userId],
  );
}

async function getPlayerBootstrap(userId) {
  const [roundState, stats, history, leaderboard, chat, notifications] =
    await Promise.all([
      buildRoundState(userId),
      getPlayerStats(userId),
      getPlayerHistory(userId),
      getLeaderboard(),
      getChatMessages(),
      getNotifications(userId),
    ]);

  return {
    user: serializeUser(roundState.user),
    stats,
    history,
    lastNumbers: roundState.lastNumbers,
    leaderboard,
    chat,
    notifications,
    jackpotPool: roundState.jackpotPool,
    currentRound: roundState.currentRound,
    pendingTicket: roundState.pendingTicket,
    latestResolvedRound: roundState.latestResolvedRound,
    latestPlayerSpin: roundState.latestPlayerSpin,
    serverTime: roundState.serverTime,
    roulette: {
      wheelOrder: WHEEL_ORDER,
      houseEdgePercent: config.houseEdgePercent,
      minBet: config.minBet,
      maxBet: config.maxBet,
      roundIntervalSeconds: config.roundIntervalSeconds,
      roundBetLockSeconds: config.roundBetLockSeconds,
      autoSpinMaxRounds: config.autoSpinMaxRounds,
      probabilities: getProbabilities(config.houseEdgePercent),
    },
  };
}

router.get(
  "/bootstrap",
  requireAuth,
  asyncHandler(async (req, res) => {
    const payload = await getPlayerBootstrap(req.user.id);

    res.json({
      success: true,
      ...payload,
    });
  }),
);

router.get(
  "/round-state",
  requireAuth,
  asyncHandler(async (req, res) => {
    const roundState = await buildRoundState(req.user.id);

    res.json({
      success: true,
      user: serializeUser(roundState.user),
      currentRound: roundState.currentRound,
      pendingTicket: roundState.pendingTicket,
      latestResolvedRound: roundState.latestResolvedRound,
      latestPlayerSpin: roundState.latestPlayerSpin,
      jackpotPool: roundState.jackpotPool,
      lastNumbers: roundState.lastNumbers,
      serverTime: roundState.serverTime,
    });
  }),
);

router.get(
  "/history",
  requireAuth,
  asyncHandler(async (req, res) => {
    const history = await getPlayerHistory(req.user.id);
    res.json({
      success: true,
      history,
    });
  }),
);

router.get(
  "/leaderboard",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      leaderboard: await getLeaderboard(),
    });
  }),
);

router.get(
  "/chat",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      chat: await getChatMessages(),
    });
  }),
);

router.post(
  "/chat",
  requireAuth,
  chatLimiter,
  chatCooldown,
  asyncHandler(async (req, res) => {
    const message = normalizeMessage(req.body?.message);

    if (!message || message.length < 2 || message.length > 200) {
      res.status(400).json({
        success: false,
        message: "Le message doit faire entre 2 et 200 caracteres.",
      });
      return;
    }

    await run(
      `
        INSERT INTO chat_messages (user_id, username_snapshot, message)
        VALUES (?, ?, ?)
      `,
      [req.user.id, req.user.username, message],
    );

    res.status(201).json({
      success: true,
      message: "Message envoye.",
      chat: await getChatMessages(),
    });
  }),
);

router.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      notifications: await getNotifications(req.user.id),
    });
  }),
);

router.post(
  "/notifications/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await run("UPDATE notifications SET is_read = 1 WHERE user_id = ?", [req.user.id]);
    res.json({
      success: true,
      message: "Notifications marquees comme lues.",
    });
  }),
);

router.post(
  "/ticket",
  requireAuth,
  spinLimiter,
  spinCooldown,
  asyncHandler(async (req, res) => {
    const incomingBets = Array.isArray(req.body?.bets) ? req.body.bets : [];

    if (!incomingBets.length || incomingBets.length > 8) {
      res.status(400).json({
        success: false,
        message: "Entre 1 et 8 mises sont autorisees par manche.",
      });
      return;
    }

    let normalizedBets;
    try {
      normalizedBets = incomingBets.map(normalizeBet);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
      });
      return;
    }

    const totalBet = normalizedBets.reduce((sum, bet) => sum + bet.amount, 0);

    if (normalizedBets.some((bet) => bet.amount < config.minBet)) {
      res.status(400).json({
        success: false,
        message: `Chaque mise doit etre d'au moins ${config.minBet} kamas.`,
      });
      return;
    }

    if (totalBet > config.maxBet) {
      res.status(400).json({
        success: false,
        message: `Le total du ticket ne peut pas depasser ${config.maxBet} kamas.`,
      });
      return;
    }

    const ticketState = await setPlayerTicket(req.user.id, normalizedBets);
    const [notifications, lastNumbers] = await Promise.all([
      getNotifications(req.user.id),
      getRecentRoundNumbers(),
    ]);

    res.json({
      success: true,
      message: "Ticket confirme pour la manche en cours.",
      user: serializeUser(ticketState.user),
      currentRound: ticketState.currentRound,
      pendingTicket: ticketState.pendingTicket,
      notifications,
      lastNumbers,
    });
  }),
);

router.delete(
  "/ticket",
  requireAuth,
  spinLimiter,
  spinCooldown,
  asyncHandler(async (req, res) => {
    const ticketState = await cancelPlayerTicket(req.user.id);
    const notifications = await getNotifications(req.user.id);

    res.json({
      success: true,
      message: "Ticket annule et fonds restitues.",
      user: serializeUser(ticketState.user),
      currentRound: ticketState.currentRound,
      pendingTicket: ticketState.pendingTicket,
      notifications,
    });
  }),
);

module.exports = router;
