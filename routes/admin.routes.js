const express = require("express");
const { serializeUser } = require("../server/auth");
const {
  all,
  get,
  run,
  withTransaction,
} = require("../server/db");
const {
  adminLimiter,
  asyncHandler,
  requireAdmin,
} = require("../server/middleware");
const { parsePositiveInteger } = require("../server/utils");

const router = express.Router();

async function getRecentLoginLogs(limit = 12) {
  return all(
    `
      SELECT
        id,
        username_attempt AS usernameAttempt,
        role_attempt AS roleAttempt,
        ip_address AS ipAddress,
        user_agent AS userAgent,
        success,
        created_at AS createdAt
      FROM login_logs
      ORDER BY id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getRecentBalanceLogs(limit = 12) {
  return all(
    `
      SELECT
        balance_logs.id,
        users.username AS username,
        admin.username AS adminUsername,
        balance_logs.type,
        balance_logs.amount,
        balance_logs.balance_before AS balanceBefore,
        balance_logs.balance_after AS balanceAfter,
        balance_logs.note,
        balance_logs.created_at AS createdAt
      FROM balance_logs
      INNER JOIN users ON users.id = balance_logs.user_id
      LEFT JOIN users AS admin ON admin.id = balance_logs.admin_user_id
      ORDER BY balance_logs.id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getRecentSpinLogs(limit = 12) {
  return all(
    `
      SELECT
        id,
        username_snapshot AS username,
        result_number AS resultNumber,
        result_color AS resultColor,
        total_bet AS totalBet,
        total_payout AS totalPayout,
        net_result AS netResult,
        created_at AS createdAt
      FROM spins
      ORDER BY id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getRecentBetLogs(limit = 20) {
  return all(
    `
      SELECT
        bets.id,
        users.username AS username,
        bets.bet_type AS betType,
        bets.bet_value AS betValue,
        bets.amount,
        bets.did_win AS didWin,
        bets.total_return AS totalReturn,
        spins.result_number AS resultNumber,
        bets.created_at AS createdAt
      FROM bets
      INNER JOIN users ON users.id = bets.user_id
      INNER JOIN spins ON spins.id = bets.spin_id
      ORDER BY bets.id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getPendingCashoutRequests(limit = 20) {
  return all(
    `
      SELECT
        cashout_requests.id,
        cashout_requests.user_id AS userId,
        cashout_requests.username_snapshot AS username,
        cashout_requests.amount,
        cashout_requests.note,
        cashout_requests.status,
        cashout_requests.created_at AS createdAt,
        users.balance AS currentBalance
      FROM cashout_requests
      INNER JOIN users ON users.id = cashout_requests.user_id
      WHERE cashout_requests.status = 'pending'
      ORDER BY cashout_requests.id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getRecentCashoutLogs(limit = 20) {
  return all(
    `
      SELECT
        cashout_requests.id,
        cashout_requests.username_snapshot AS username,
        cashout_requests.amount,
        cashout_requests.note,
        cashout_requests.status,
        cashout_requests.admin_note AS adminNote,
        admin.username AS adminUsername,
        cashout_requests.created_at AS createdAt,
        cashout_requests.processed_at AS processedAt,
        cashout_requests.cancelled_at AS cancelledAt
      FROM cashout_requests
      LEFT JOIN users AS admin ON admin.id = cashout_requests.admin_user_id
      ORDER BY cashout_requests.id DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getDashboardPayload() {
  const [
    summary,
    recentLogins,
    recentBalances,
    recentSpins,
    recentBets,
    pendingCashoutRequests,
    recentCashoutRequests,
  ] =
    await Promise.all([
      get(
        `
          SELECT
            COUNT(CASE WHEN role = 'player' THEN 1 END) AS playerCount,
            COALESCE(SUM(CASE WHEN role = 'player' THEN balance END), 0) AS playerBalance,
            COALESCE(SUM(CASE WHEN role = 'player' THEN total_wagered END), 0) AS totalWagered,
            COALESCE(SUM(CASE WHEN role = 'player' THEN total_won END), 0) AS totalWon
          FROM users
        `,
      ),
      getRecentLoginLogs(),
      getRecentBalanceLogs(),
      getRecentSpinLogs(),
      getRecentBetLogs(),
      getPendingCashoutRequests(),
      getRecentCashoutLogs(12),
    ]);

  const [spinCountRow, winningPlayers] = await Promise.all([
    get("SELECT COUNT(*) AS totalSpins FROM spins"),
    all(
      `
        SELECT
          username,
          balance,
          total_profit AS totalProfit,
          total_won AS totalWon
        FROM users
        WHERE role = 'player'
        ORDER BY total_profit DESC, total_won DESC
        LIMIT 5
      `,
    ),
  ]);

  return {
    summary: {
      playerCount: Number(summary?.playerCount || 0),
      playerBalance: Number(summary?.playerBalance || 0),
      totalWagered: Number(summary?.totalWagered || 0),
      totalWon: Number(summary?.totalWon || 0),
      totalSpins: Number(spinCountRow?.totalSpins || 0),
      pendingCashoutCount: pendingCashoutRequests.length,
    },
    winningPlayers,
    recentLogins,
    recentBalances,
    recentSpins,
    recentBets,
    pendingCashoutRequests,
    recentCashoutRequests,
  };
}

router.get(
  "/dashboard",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      ...(await getDashboardPayload()),
    });
  }),
);

router.get(
  "/users",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || "").trim();
    const likeValue = `%${search}%`;

    const users = await all(
      `
        SELECT
          id,
          username,
          role,
          balance,
          total_wagered AS totalWagered,
          total_won AS totalWon,
          total_profit AS totalProfit,
          highest_win AS highestWin,
          last_login_at AS lastLoginAt,
          created_at AS createdAt
        FROM users
        WHERE username LIKE ?
        ORDER BY
          CASE role WHEN 'admin' THEN 0 ELSE 1 END,
          username ASC
        LIMIT 25
      `,
      [likeValue],
    );

    res.json({
      success: true,
      users,
    });
  }),
);

router.post(
  "/cashout-requests/:requestId",
  requireAdmin,
  adminLimiter,
  asyncHandler(async (req, res) => {
    const requestId = Number.parseInt(req.params.requestId, 10);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const adminNote = String(req.body?.adminNote || "").trim().slice(0, 180);

    if (!Number.isInteger(requestId)) {
      res.status(400).json({
        success: false,
        message: "Identifiant de cash out invalide.",
      });
      return;
    }

    if (!["complete", "reject"].includes(action)) {
      res.status(400).json({
        success: false,
        message: "Action de cash out invalide.",
      });
      return;
    }

    const outcome = await withTransaction(async () => {
      const request = await get(
        `
          SELECT *
          FROM cashout_requests
          WHERE id = ?
            AND status = 'pending'
        `,
        [requestId],
      );

      if (!request) {
        throw new Error("Demande de cash out introuvable ou deja traitee.");
      }

      const targetUser = await get("SELECT * FROM users WHERE id = ?", [request.user_id]);
      if (!targetUser) {
        throw new Error("Joueur introuvable.");
      }

      if (action === "complete") {
        const balanceBefore = Number(targetUser.balance);
        const balanceAfter = balanceBefore - Number(request.amount);

        if (balanceAfter < 0) {
          throw new Error("Le solde actuel du joueur est insuffisant pour ce cash out.");
        }

        await run("UPDATE users SET balance = ? WHERE id = ?", [balanceAfter, targetUser.id]);

        await run(
          `
            INSERT INTO balance_logs (
              user_id,
              admin_user_id,
              type,
              amount,
              balance_before,
              balance_after,
              note
            )
            VALUES (?, ?, 'cashout', ?, ?, ?, ?)
          `,
          [
            targetUser.id,
            req.user.id,
            -Number(request.amount),
            balanceBefore,
            balanceAfter,
            adminNote || `Cash out #${request.id}`,
          ],
        );

        await run(
          `
            UPDATE cashout_requests
            SET status = 'completed',
                admin_user_id = ?,
                admin_note = ?,
                processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [req.user.id, adminNote || null, request.id],
        );

        await run(
          `
            INSERT INTO notifications (user_id, type, message)
            VALUES (?, 'cashout', ?)
          `,
          [
            targetUser.id,
            `Ta demande de cash out de ${Number(request.amount).toLocaleString("fr-FR")} kamas a ete validee.`,
          ],
        );
      } else {
        await run(
          `
            UPDATE cashout_requests
            SET status = 'rejected',
                admin_user_id = ?,
                admin_note = ?,
                processed_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [req.user.id, adminNote || null, request.id],
        );

        await run(
          `
            INSERT INTO notifications (user_id, type, message)
            VALUES (?, 'warning', ?)
          `,
          [
            targetUser.id,
            adminNote
              ? `Ta demande de cash out a ete refusee: ${adminNote}`
              : "Ta demande de cash out a ete refusee par le staff.",
          ],
        );
      }

      return {
        user: await get("SELECT * FROM users WHERE id = ?", [targetUser.id]),
      };
    });

    res.json({
      success: true,
      message: action === "complete" ? "Cash out valide et debite." : "Cash out refuse.",
      user: serializeUser(outcome.user),
      dashboard: await getDashboardPayload(),
    });
  }),
);

router.post(
  "/users/:userId/balance",
  requireAdmin,
  adminLimiter,
  asyncHandler(async (req, res) => {
    const userId = Number.parseInt(req.params.userId, 10);
    const amount = parsePositiveInteger(req.body?.amount);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const note = String(req.body?.note || "").trim().slice(0, 180);

    if (!Number.isInteger(userId)) {
      res.status(400).json({
        success: false,
        message: "Identifiant joueur invalide.",
      });
      return;
    }

    if (!amount) {
      res.status(400).json({
        success: false,
        message: "Montant invalide.",
      });
      return;
    }

    if (!["credit", "debit"].includes(action)) {
      res.status(400).json({
        success: false,
        message: "Action invalide.",
      });
      return;
    }

    if (note.length < 3) {
      res.status(400).json({
        success: false,
        message: "Ajoute une raison courte pour garder des logs propres.",
      });
      return;
    }

    const updatedUser = await withTransaction(async () => {
      const targetUser = await get("SELECT * FROM users WHERE id = ?", [userId]);
      if (!targetUser) {
        throw new Error("Joueur introuvable.");
      }

      const balanceBefore = Number(targetUser.balance);
      const balanceAfter =
        action === "credit" ? balanceBefore + amount : balanceBefore - amount;

      if (balanceAfter < 0) {
        throw new Error("Impossible de retirer plus que le solde actuel.");
      }

      await run("UPDATE users SET balance = ? WHERE id = ?", [balanceAfter, targetUser.id]);

      await run(
        `
          INSERT INTO balance_logs (
            user_id,
            admin_user_id,
            type,
            amount,
            balance_before,
            balance_after,
            note
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          targetUser.id,
          req.user.id,
          action,
          action === "credit" ? amount : -amount,
          balanceBefore,
          balanceAfter,
          note,
        ],
      );

      await run(
        `
          INSERT INTO notifications (user_id, type, message)
          VALUES (?, ?, ?)
        `,
        [
          targetUser.id,
          action === "credit" ? "admin" : "warning",
          action === "credit"
            ? `Votre compte a ete credite de ${amount.toLocaleString("fr-FR")} kamas.`
            : `Votre compte a ete debite de ${amount.toLocaleString("fr-FR")} kamas.`,
        ],
      );

      return get("SELECT * FROM users WHERE id = ?", [targetUser.id]);
    });

    res.json({
      success: true,
      message: action === "credit" ? "Compte credite." : "Compte debite.",
      user: serializeUser(updatedUser),
      dashboard: await getDashboardPayload(),
    });
  }),
);

router.get(
  "/logs",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const type = String(req.query.type || "spins").trim().toLowerCase();
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100,
    );

    if (type === "logins") {
      res.json({
        success: true,
        type,
        rows: await getRecentLoginLogs(limit),
      });
      return;
    }

    if (type === "balances") {
      res.json({
        success: true,
        type,
        rows: await getRecentBalanceLogs(limit),
      });
      return;
    }

    if (type === "bets") {
      res.json({
        success: true,
        type,
        rows: await getRecentBetLogs(limit),
      });
      return;
    }

    if (type === "cashouts") {
      res.json({
        success: true,
        type,
        rows: await getRecentCashoutLogs(limit),
      });
      return;
    }

    res.json({
      success: true,
      type: "spins",
      rows: await getRecentSpinLogs(limit),
    });
  }),
);

module.exports = router;
