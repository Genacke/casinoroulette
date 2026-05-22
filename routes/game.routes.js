const express = require("express");
const { serializeUser } = require("../server/auth");
const { config } = require("../server/config");
const { all, get, getSetting, run, withTransaction } = require("../server/db");
const {
  asyncHandler,
  chatCooldown,
  chatLimiter,
  requireAuth,
  spinCooldown,
  spinLimiter,
} = require("../server/middleware");
const {
  getProbabilities,
  normalizeBet,
  validateTicketRules,
  WHEEL_ORDER,
} = require("../server/roulette");
const {
  buildRoundState,
  cancelPlayerTicket,
  getRecentRoundNumbers,
  setPlayerTicket,
} = require("../server/rounds");
const { normalizeMessage, parsePositiveInteger } = require("../server/utils");

const router = express.Router();

async function getPlayerStats(userId) {
  const [spinStats, favoriteBet] = await Promise.all([
    get(
      `
        SELECT
          COUNT(*) AS spins_played,
          COALESCE(SUM(CASE WHEN net_result > 0 THEN 1 ELSE 0 END), 0) AS winning_spins,
          COALESCE(SUM(total_bet), 0) AS total_bet,
          COALESCE(SUM(total_payout), 0) AS total_paid
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

function mapCashoutRequest(row) {
  return {
    id: Number(row.id),
    amount: Number(row.amount),
    note: row.note || "",
    status: row.status,
    adminNote: row.adminNote || "",
    createdAt: row.createdAt,
    processedAt: row.processedAt || null,
    cancelledAt: row.cancelledAt || null,
    canCancel: row.status === "pending",
  };
}

async function getCashoutRequests(userId, limit = 8) {
  const rows = await all(
    `
      SELECT
        id,
        amount,
        note,
        status,
        admin_note AS adminNote,
        created_at AS createdAt,
        processed_at AS processedAt,
        cancelled_at AS cancelledAt
      FROM cashout_requests
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `,
    [userId, limit],
  );

  return rows.map(mapCashoutRequest);
}

async function getPlayerBootstrap(userId) {
  const [roundState, stats, history, leaderboard, chat, notifications, cashoutRequests] =
    await Promise.all([
      buildRoundState(userId),
      getPlayerStats(userId),
      getPlayerHistory(userId),
      getLeaderboard(),
      getChatMessages(),
      getNotifications(userId),
      getCashoutRequests(userId),
    ]);

  return {
    user: serializeUser(roundState.user),
    stats,
    history,
    lastNumbers: roundState.lastNumbers,
    leaderboard,
    chat,
    notifications,
    cashoutRequests,
    pendingCashoutRequest:
      cashoutRequests.find((request) => request.status === "pending") || null,
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
      greenMaxBet: config.greenMaxBet,
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
    const cashoutRequests = await getCashoutRequests(req.user.id);

    res.json({
      success: true,
      user: serializeUser(roundState.user),
      currentRound: roundState.currentRound,
      pendingTicket: roundState.pendingTicket,
      latestResolvedRound: roundState.latestResolvedRound,
      latestPlayerSpin: roundState.latestPlayerSpin,
      lastNumbers: roundState.lastNumbers,
      serverTime: roundState.serverTime,
      cashoutRequests,
      pendingCashoutRequest:
        cashoutRequests.find((request) => request.status === "pending") || null,
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
  "/cashout-requests",
  requireAuth,
  spinLimiter,
  spinCooldown,
  asyncHandler(async (req, res) => {
    const amount = parsePositiveInteger(req.body?.amount);
    const note = String(req.body?.note || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 180);

    if (!amount) {
      res.status(400).json({
        success: false,
        message: "Montant de cash out invalide.",
      });
      return;
    }

    const requestState = await requireCashoutRequestCreation(req.user.id, amount, note);
    const [notifications, cashoutRequests] = await Promise.all([
      getNotifications(req.user.id),
      getCashoutRequests(req.user.id),
    ]);

    res.status(201).json({
      success: true,
      message: "Demande de cash out envoyee au staff.",
      user: serializeUser(requestState.user),
      notifications,
      cashoutRequests,
      pendingCashoutRequest:
        cashoutRequests.find((request) => request.status === "pending") || null,
    });
  }),
);

router.delete(
  "/cashout-requests/:requestId",
  requireAuth,
  spinLimiter,
  spinCooldown,
  asyncHandler(async (req, res) => {
    const requestId = Number.parseInt(req.params.requestId, 10);

    if (!Number.isInteger(requestId)) {
      res.status(400).json({
        success: false,
        message: "Identifiant de demande invalide.",
      });
      return;
    }

    const requestState = await cancelCashoutRequest(req.user.id, requestId);
    const [notifications, cashoutRequests] = await Promise.all([
      getNotifications(req.user.id),
      getCashoutRequests(req.user.id),
    ]);

    res.json({
      success: true,
      message: "Demande de cash out annulee.",
      user: serializeUser(requestState.user),
      notifications,
      cashoutRequests,
      pendingCashoutRequest:
        cashoutRequests.find((request) => request.status === "pending") || null,
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

    try {
      validateTicketRules(normalizedBets, config);
    } catch (error) {
      res.status(400).json({
        success: false,
        message: error.message,
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

async function requireCashoutRequestCreation(userId, amount, note) {
  return requireCashoutMutation(async () => {
    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);

    if (!user) {
      throw new Error("Compte introuvable.");
    }

    if (Number(user.balance) < amount) {
      throw new Error("Solde insuffisant pour cette demande de cash out.");
    }

    const existingPending = await get(
      `
        SELECT id
        FROM cashout_requests
        WHERE user_id = ?
          AND status = 'pending'
        LIMIT 1
      `,
      [userId],
    );

    if (existingPending) {
      throw new Error("Une demande de cash out est deja en attente.");
    }

    await run(
      `
        INSERT INTO cashout_requests (
          user_id,
          username_snapshot,
          amount,
          note,
          status
        )
        VALUES (?, ?, ?, ?, 'pending')
      `,
      [userId, user.username, amount, note || null],
    );

    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'cashout', ?)
      `,
      [
        userId,
        `Demande de cash out envoyee pour ${amount.toLocaleString("fr-FR")} kamas.`,
      ],
    );

    return {
      user: await get("SELECT * FROM users WHERE id = ?", [userId]),
    };
  });
}

async function cancelCashoutRequest(userId, requestId) {
  return requireCashoutMutation(async () => {
    const request = await get(
      `
        SELECT *
        FROM cashout_requests
        WHERE id = ?
          AND user_id = ?
      `,
      [requestId, userId],
    );

    if (!request) {
      throw new Error("Demande de cash out introuvable.");
    }

    if (request.status !== "pending") {
      throw new Error("Seule une demande en attente peut etre annulee.");
    }

    await run(
      `
        UPDATE cashout_requests
        SET status = 'cancelled',
            cancelled_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [requestId],
    );

    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'info', ?)
      `,
      [userId, "Ta demande de cash out a ete annulee."],
    );

    return {
      user: await get("SELECT * FROM users WHERE id = ?", [userId]),
    };
  });
}

async function requireCashoutMutation(callback) {
  try {
    return await withTransaction(callback);
  } catch (error) {
    if (/idx_cashout_requests_user_pending/i.test(error.message || "")) {
      throw new Error("Une demande de cash out est deja en attente.");
    }

    throw error;
  }
}

module.exports = router;
