const { config } = require("./config");
const {
  all,
  get,
  getSetting,
  run,
  setSetting,
  withTransaction,
} = require("./db");
const {
  WHEEL_ORDER,
  evaluateBet,
  getPocket,
  spinNumber,
} = require("./roulette");

const ROUND_STATUS = {
  open: "open",
  resolving: "resolving",
  resolved: "resolved",
};

let roundEngineStarted = false;
let roundEngineBusy = false;
let roundEngineTimer = null;

function toSqlTimestamp(input) {
  return new Date(input).toISOString().replace("T", " ").slice(0, 19);
}

function fromSqlTimestamp(value) {
  if (!value) {
    return null;
  }

  return Date.parse(String(value).replace(" ", "T") + "Z");
}

function roundIntervalMs() {
  return config.roundIntervalSeconds * 1000;
}

function roundBetLockMs() {
  return config.roundBetLockSeconds * 1000;
}

function currentRoundKey(nowMs = Date.now()) {
  return Math.floor(nowMs / roundIntervalMs());
}

function roundWindowByKey(roundKey) {
  const opensAtMs = roundKey * roundIntervalMs();
  const closesAtMs = opensAtMs + roundIntervalMs();

  return {
    roundKey,
    opensAtMs,
    closesAtMs,
    opensAt: toSqlTimestamp(opensAtMs),
    closesAt: toSqlTimestamp(closesAtMs),
  };
}

function parseStoredBetValue(type, value) {
  if (type === "number" || type === "dozen") {
    return Number(value);
  }

  return value;
}

function serializeRound(row, nowMs = Date.now()) {
  if (!row) {
    return null;
  }

  const closesAtMs = fromSqlTimestamp(row.closes_at);
  const lockedAtMs = closesAtMs - roundBetLockMs();

  return {
    id: row.id,
    roundKey: Number(row.round_key),
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    locksAt: toSqlTimestamp(lockedAtMs),
    resolvedAt: row.resolved_at || null,
    status: row.status,
    resultNumber:
      row.result_number === null || row.result_number === undefined
        ? null
        : Number(row.result_number),
    resultColor: row.result_color || null,
    winningPocketIndex:
      row.winning_pocket_index === null || row.winning_pocket_index === undefined
        ? null
        : Number(row.winning_pocket_index),
    totalBet: Number(row.total_bet || 0),
    totalPayout: Number(row.total_payout || 0),
    houseDelta: Number(row.house_delta || 0),
    jackpotContribution: Number(row.jackpot_contribution || 0),
    jackpotWinTotal: Number(row.jackpot_win_total || 0),
    acceptingBets:
      row.status === ROUND_STATUS.open && lockedAtMs > nowMs,
    secondsUntilClose: Math.max(
      0,
      Math.ceil((closesAtMs - nowMs) / 1000),
    ),
    secondsUntilLock: Math.max(
      0,
      Math.ceil((lockedAtMs - nowMs) / 1000),
    ),
  };
}

async function ensureRoundByKey(roundKey) {
  const window = roundWindowByKey(roundKey);

  await run(
    `
      INSERT INTO roulette_rounds (round_key, opens_at, closes_at, status)
      VALUES (?, ?, ?, 'open')
      ON CONFLICT(round_key) DO NOTHING
    `,
    [window.roundKey, window.opensAt, window.closesAt],
  );

  return get(
    `
      SELECT *
      FROM roulette_rounds
      WHERE round_key = ?
    `,
    [window.roundKey],
  );
}

async function ensureCurrentRound(nowMs = Date.now()) {
  return ensureRoundByKey(currentRoundKey(nowMs));
}

async function getLatestResolvedRoundRow() {
  return get(
    `
      SELECT *
      FROM roulette_rounds
      WHERE status = 'resolved'
      ORDER BY round_key DESC
      LIMIT 1
    `,
  );
}

async function getRecentRoundNumbers(limit = 14) {
  return all(
    `
      SELECT
        result_number AS resultNumber,
        result_color AS resultColor,
        resolved_at AS createdAt
      FROM roulette_rounds
      WHERE status = 'resolved'
      ORDER BY round_key DESC
      LIMIT ?
    `,
    [limit],
  );
}

async function getPendingTicket(userId, roundId) {
  if (!roundId) {
    return {
      roundId: null,
      bets: [],
      totalBet: 0,
      isSubmitted: false,
      submittedAt: null,
    };
  }

  const rows = await all(
    `
      SELECT
        bet_type AS betType,
        bet_value AS betValue,
        amount,
        created_at AS createdAt
      FROM scheduled_bets
      WHERE user_id = ?
        AND round_id = ?
        AND status = 'active'
      ORDER BY id ASC
    `,
    [userId, roundId],
  );

  const bets = rows.map((row) => ({
    type: row.betType,
    value: parseStoredBetValue(row.betType, row.betValue),
    amount: Number(row.amount),
  }));

  return {
    roundId,
    bets,
    totalBet: bets.reduce((sum, bet) => sum + bet.amount, 0),
    isSubmitted: bets.length > 0,
    submittedAt: rows[0]?.createdAt || null,
  };
}

async function getLatestPlayerSpin(userId, roundId) {
  if (!roundId) {
    return null;
  }

  const row = await get(
    `
      SELECT
        id AS spinId,
        round_id AS roundId,
        result_number AS resultNumber,
        result_color AS resultColor,
        total_bet AS totalBet,
        total_payout AS totalPayout,
        jackpot_win AS jackpotWin,
        net_result AS netResult,
        created_at AS createdAt
      FROM spins
      WHERE user_id = ?
        AND round_id = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [userId, roundId],
  );

  if (!row) {
    return null;
  }

  return {
    spinId: Number(row.spinId),
    roundId: Number(row.roundId),
    resultNumber: Number(row.resultNumber),
    resultColor: row.resultColor,
    totalBet: Number(row.totalBet),
    totalPayout: Number(row.totalPayout),
    jackpotWin: Number(row.jackpotWin),
    netResult: Number(row.netResult),
    createdAt: row.createdAt,
  };
}

function validateRoundOpenForBets(roundRow, nowMs = Date.now()) {
  if (!roundRow || roundRow.status !== ROUND_STATUS.open) {
    throw new Error("La manche en cours n'accepte plus de tickets.");
  }

  const closesAtMs = fromSqlTimestamp(roundRow.closes_at);
  if (closesAtMs - nowMs <= roundBetLockMs()) {
    throw new Error(
      `Les mises sont verrouillees ${config.roundBetLockSeconds} secondes avant le tirage.`,
    );
  }
}

async function setPlayerTicket(userId, normalizedBets) {
  return withTransaction(async () => {
    const nowMs = Date.now();
    const roundRow = await ensureCurrentRound(nowMs);
    validateRoundOpenForBets(roundRow, nowMs);

    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
    if (!user) {
      throw new Error("Compte introuvable.");
    }

    const existingRows = await all(
      `
        SELECT id, amount
        FROM scheduled_bets
        WHERE user_id = ?
          AND round_id = ?
          AND status = 'active'
      `,
      [userId, roundRow.id],
    );

    const existingTotal = existingRows.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );
    const newTotal = normalizedBets.reduce((sum, bet) => sum + bet.amount, 0);
    const difference = newTotal - existingTotal;

    if (difference > 0 && Number(user.balance) < difference) {
      throw new Error("Solde insuffisant pour cette mise.");
    }

    if (existingRows.length) {
      await run(
        `
          UPDATE scheduled_bets
          SET status = 'voided'
          WHERE user_id = ?
            AND round_id = ?
            AND status = 'active'
        `,
        [userId, roundRow.id],
      );
    }

    if (difference !== 0) {
      const balanceBefore = Number(user.balance);
      const balanceAfter = balanceBefore - difference;

      await run("UPDATE users SET balance = ? WHERE id = ?", [
        balanceAfter,
        userId,
      ]);

      await run(
        `
          INSERT INTO balance_logs (
            user_id,
            type,
            amount,
            balance_before,
            balance_after,
            note
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          difference > 0 ? "hold" : "refund",
          -difference,
          balanceBefore,
          balanceAfter,
          `Ticket round #${roundRow.round_key}`,
        ],
      );
    }

    for (const bet of normalizedBets) {
      await run(
        `
          INSERT INTO scheduled_bets (
            round_id,
            user_id,
            bet_type,
            bet_value,
            amount,
            status
          )
          VALUES (?, ?, ?, ?, ?, 'active')
        `,
        [
          roundRow.id,
          userId,
          bet.type,
          String(bet.value),
          bet.amount,
        ],
      );
    }

    const updatedUser = await get("SELECT * FROM users WHERE id = ?", [userId]);

    return {
      currentRound: serializeRound(roundRow),
      pendingTicket: await getPendingTicket(userId, roundRow.id),
      user: updatedUser,
    };
  });
}

async function cancelPlayerTicket(userId) {
  return withTransaction(async () => {
    const nowMs = Date.now();
    const roundRow = await ensureCurrentRound(nowMs);
    validateRoundOpenForBets(roundRow, nowMs);

    const activeRows = await all(
      `
        SELECT amount
        FROM scheduled_bets
        WHERE user_id = ?
          AND round_id = ?
          AND status = 'active'
      `,
      [userId, roundRow.id],
    );

    const refundTotal = activeRows.reduce(
      (sum, row) => sum + Number(row.amount),
      0,
    );

    if (!refundTotal) {
      const currentUser = await get("SELECT * FROM users WHERE id = ?", [userId]);
      return {
        currentRound: serializeRound(roundRow),
        pendingTicket: await getPendingTicket(userId, roundRow.id),
        user: currentUser,
      };
    }

    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore + refundTotal;

    await run(
      `
        UPDATE scheduled_bets
        SET status = 'voided'
        WHERE user_id = ?
          AND round_id = ?
          AND status = 'active'
      `,
      [userId, roundRow.id],
    );

    await run("UPDATE users SET balance = ? WHERE id = ?", [
      balanceAfter,
      userId,
    ]);

    await run(
      `
        INSERT INTO balance_logs (
          user_id,
          type,
          amount,
          balance_before,
          balance_after,
          note
        )
        VALUES (?, 'refund', ?, ?, ?, ?)
      `,
      [
        userId,
        refundTotal,
        balanceBefore,
        balanceAfter,
        `Annulation ticket round #${roundRow.round_key}`,
      ],
    );

    return {
      currentRound: serializeRound(roundRow),
      pendingTicket: await getPendingTicket(userId, roundRow.id),
      user: await get("SELECT * FROM users WHERE id = ?", [userId]),
    };
  });
}

async function buildRoundState(userId) {
  const nowMs = Date.now();
  const currentRoundRow = await ensureCurrentRound(nowMs);
  const [latestResolvedRoundRow, pendingTicket, jackpotPool, user, lastNumbers] =
    await Promise.all([
      getLatestResolvedRoundRow(),
      getPendingTicket(userId, currentRoundRow.id),
      getSetting("jackpot_pool", config.initialJackpotPool),
      get("SELECT * FROM users WHERE id = ?", [userId]),
      getRecentRoundNumbers(),
    ]);

  const latestResolvedRound = serializeRound(latestResolvedRoundRow, nowMs);
  const latestPlayerSpin = await getLatestPlayerSpin(
    userId,
    latestResolvedRound?.id || null,
  );

  return {
    user,
    currentRound: serializeRound(currentRoundRow, nowMs),
    pendingTicket,
    latestResolvedRound,
    latestPlayerSpin,
    jackpotPool: Number(jackpotPool || config.initialJackpotPool),
    lastNumbers,
    serverTime: new Date(nowMs).toISOString(),
  };
}

async function resolveNextDueRound() {
  return withTransaction(async () => {
    const nowMs = Date.now();
    const dueRound = await get(
      `
        SELECT *
        FROM roulette_rounds
        WHERE status = 'open'
          AND closes_at <= ?
        ORDER BY round_key ASC
        LIMIT 1
      `,
      [toSqlTimestamp(nowMs)],
    );

    if (!dueRound) {
      return null;
    }

    const claim = await run(
      `
        UPDATE roulette_rounds
        SET status = 'resolving'
        WHERE id = ?
          AND status = 'open'
      `,
      [dueRound.id],
    );

    if (!claim.changes) {
      return null;
    }

    const scheduledRows = await all(
      `
        SELECT
          scheduled_bets.id,
          scheduled_bets.user_id AS userId,
          scheduled_bets.bet_type AS betType,
          scheduled_bets.bet_value AS betValue,
          scheduled_bets.amount,
          users.username AS username
        FROM scheduled_bets
        INNER JOIN users ON users.id = scheduled_bets.user_id
        WHERE scheduled_bets.round_id = ?
          AND scheduled_bets.status = 'active'
        ORDER BY scheduled_bets.user_id ASC, scheduled_bets.id ASC
      `,
      [dueRound.id],
    );

    const resultNumber = spinNumber();
    const pocket = getPocket(resultNumber);
    let jackpotPool = Number(
      await getSetting("jackpot_pool", config.initialJackpotPool),
    );

    const ticketsByUser = new Map();

    for (const row of scheduledRows) {
      if (!ticketsByUser.has(row.userId)) {
        ticketsByUser.set(row.userId, {
          userId: row.userId,
          username: row.username,
          rows: [],
        });
      }

      ticketsByUser.get(row.userId).rows.push({
        id: row.id,
        type: row.betType,
        value: parseStoredBetValue(row.betType, row.betValue),
        amount: Number(row.amount),
      });
    }

    const userTickets = [];
    let totalRoundBet = 0;
    let totalRoundPayout = 0;
    let totalJackpotContribution = 0;

    for (const ticket of ticketsByUser.values()) {
      const totalBet = ticket.rows.reduce((sum, bet) => sum + bet.amount, 0);
      const resolvedBets = ticket.rows.map((bet) => ({
        ...bet,
        ...evaluateBet(
          {
            type: bet.type,
            value: bet.value,
            amount: bet.amount,
          },
          resultNumber,
          config.houseEdgePercent,
        ),
      }));
      const payout = resolvedBets.reduce(
        (sum, bet) => sum + bet.totalReturn,
        0,
      );
      const jackpotContribution = Math.floor(
        totalBet * (config.jackpotContributionPercent / 100),
      );
      const jackpotEligible = resolvedBets.some(
        (bet) => bet.type === "number" && Number(bet.value) === 0 && bet.didWin,
      );

      totalRoundBet += totalBet;
      totalRoundPayout += payout;
      totalJackpotContribution += jackpotContribution;

      userTickets.push({
        userId: ticket.userId,
        username: ticket.username,
        totalBet,
        payout,
        jackpotContribution,
        jackpotEligible,
        resolvedBets,
      });
    }

    jackpotPool += totalJackpotContribution;

    const jackpotWinners = userTickets.filter((ticket) => ticket.jackpotEligible);
    let jackpotShare = 0;
    let jackpotWinTotal = 0;

    if (jackpotWinners.length > 0 && jackpotPool > 0) {
      jackpotShare = Math.floor(jackpotPool / jackpotWinners.length);
      jackpotWinTotal = jackpotShare * jackpotWinners.length;
      const jackpotRemainder = jackpotPool - jackpotWinTotal;
      jackpotPool = config.initialJackpotPool + jackpotRemainder;
    }

    for (const ticket of userTickets) {
      const jackpotWin = ticket.jackpotEligible ? jackpotShare : 0;
      const totalPayout = ticket.payout + jackpotWin;
      const netResult = totalPayout - ticket.totalBet;
      const user = await get("SELECT * FROM users WHERE id = ?", [ticket.userId]);
      const balanceBefore = Number(user.balance);
      const balanceAfter = balanceBefore + totalPayout;

      const spinInsert = await run(
        `
          INSERT INTO spins (
            user_id,
            round_id,
            username_snapshot,
            result_number,
            result_color,
            total_bet,
            total_payout,
            net_result,
            house_delta,
            jackpot_contribution,
            jackpot_win
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          ticket.userId,
          dueRound.id,
          ticket.username,
          resultNumber,
          pocket.color,
          ticket.totalBet,
          ticket.payout,
          netResult,
          ticket.totalBet - totalPayout,
          ticket.jackpotContribution,
          jackpotWin,
        ],
      );

      for (const bet of ticket.resolvedBets) {
        await run(
          `
            INSERT INTO bets (
              user_id,
              spin_id,
              bet_type,
              bet_value,
              amount,
              did_win,
              probability,
              payout_multiplier,
              total_return,
              net_result
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            ticket.userId,
            spinInsert.lastID,
            bet.type,
            String(bet.value),
            bet.amount,
            bet.didWin ? 1 : 0,
            bet.probability,
            bet.payoutMultiplier,
            bet.totalReturn,
            bet.netResult,
          ],
        );
      }

      await run(
        `
          UPDATE users
          SET balance = ?,
              total_wagered = total_wagered + ?,
              total_won = total_won + ?,
              total_profit = total_profit + ?,
              highest_win = CASE
                WHEN highest_win < ? THEN ?
                ELSE highest_win
              END
          WHERE id = ?
        `,
        [
          balanceAfter,
          ticket.totalBet,
          totalPayout,
          netResult,
          totalPayout,
          totalPayout,
          ticket.userId,
        ],
      );

      if (ticket.payout > 0) {
        await run(
          `
            INSERT INTO balance_logs (
              user_id,
              type,
              amount,
              balance_before,
              balance_after,
              note
            )
            VALUES (?, 'win', ?, ?, ?, ?)
          `,
          [
            ticket.userId,
            ticket.payout,
            balanceBefore,
            balanceBefore + ticket.payout,
            `Paiement round #${dueRound.round_key}`,
          ],
        );
      }

      if (jackpotWin > 0) {
        await run(
          `
            INSERT INTO balance_logs (
              user_id,
              type,
              amount,
              balance_before,
              balance_after,
              note
            )
            VALUES (?, 'jackpot', ?, ?, ?, ?)
          `,
          [
            ticket.userId,
            jackpotWin,
            balanceBefore + ticket.payout,
            balanceAfter,
            `Jackpot round #${dueRound.round_key}`,
          ],
        );
      }

      await run(
        `
          INSERT INTO notifications (user_id, type, message)
          VALUES (?, ?, ?)
        `,
        [
          ticket.userId,
          netResult >= 0 ? "success" : "loss",
          netResult >= 0
            ? `Round #${dueRound.round_key} gagne: +${netResult.toLocaleString("fr-FR")} kamas.`
            : `Round #${dueRound.round_key} perdu: ${netResult.toLocaleString("fr-FR")} kamas.`,
        ],
      );

      if (jackpotWin > 0) {
        await run(
          `
            INSERT INTO notifications (user_id, type, message)
            VALUES (?, 'jackpot', ?)
          `,
          [
            ticket.userId,
            `Jackpot partage sur le 0: +${jackpotWin.toLocaleString("fr-FR")} kamas.`,
          ],
        );
      }

      await run(
        `
          UPDATE scheduled_bets
          SET status = 'resolved',
              resolved_spin_id = ?
          WHERE round_id = ?
            AND user_id = ?
            AND status = 'active'
        `,
        [spinInsert.lastID, dueRound.id, ticket.userId],
      );
    }

    const totalPaid = totalRoundPayout + jackpotWinTotal;

    await run(
      `
        UPDATE roulette_rounds
        SET status = 'resolved',
            result_number = ?,
            result_color = ?,
            winning_pocket_index = ?,
            total_bet = ?,
            total_payout = ?,
            house_delta = ?,
            jackpot_contribution = ?,
            jackpot_win_total = ?,
            resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        resultNumber,
        pocket.color,
        WHEEL_ORDER.indexOf(resultNumber),
        totalRoundBet,
        totalPaid,
        totalRoundBet - totalPaid,
        totalJackpotContribution,
        jackpotWinTotal,
        dueRound.id,
      ],
    );

    await setSetting("jackpot_pool", jackpotPool);

    const updatedRound = await get(
      `
        SELECT *
        FROM roulette_rounds
        WHERE id = ?
      `,
      [dueRound.id],
    );

    return serializeRound(updatedRound, nowMs);
  });
}

async function resolveDueRounds() {
  let resolvedAny = false;

  while (true) {
    const resolvedRound = await resolveNextDueRound();
    if (!resolvedRound) {
      break;
    }

    resolvedAny = true;
    console.log(
      `Round ${resolvedRound.roundKey} resolu sur le ${resolvedRound.resultNumber} ${resolvedRound.resultColor}`,
    );
  }

  return resolvedAny;
}

async function startRoundEngine() {
  if (roundEngineStarted) {
    return;
  }

  roundEngineStarted = true;
  await ensureCurrentRound();
  await resolveDueRounds();

  roundEngineTimer = setInterval(async () => {
    if (roundEngineBusy) {
      return;
    }

    roundEngineBusy = true;

    try {
      await ensureCurrentRound();
      await resolveDueRounds();
    } catch (error) {
      console.error("Erreur moteur roulette:", error);
    } finally {
      roundEngineBusy = false;
    }
  }, 1000);

  if (typeof roundEngineTimer.unref === "function") {
    roundEngineTimer.unref();
  }
}

module.exports = {
  buildRoundState,
  cancelPlayerTicket,
  ensureCurrentRound,
  getPendingTicket,
  getRecentRoundNumbers,
  roundIntervalMs,
  serializeRound,
  setPlayerTicket,
  startRoundEngine,
};
