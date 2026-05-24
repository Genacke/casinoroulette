const crypto = require("crypto");
const { config } = require("./config");
const { all, get, run, withTransaction } = require("./db");

const BOARD_ROWS = 6;
const BOARD_COLUMNS = 7;
const TURN_TIMEOUT_GRACE_MS = 1200;
const TABLE_PRESET = {
  slug: "puissance-4-blitz",
  name: "Puissance 4 Blitz",
};

let connect4EngineStarted = false;
let connect4EngineBusy = false;
let connect4EngineTimer = null;

function toSqlTimestamp(input = Date.now()) {
  return new Date(input).toISOString().replace("T", " ").slice(0, 19);
}

function fromSqlTimestamp(value) {
  if (!value) {
    return null;
  }

  return Date.parse(String(value).replace(" ", "T") + "Z");
}

function inSeconds(seconds) {
  return toSqlTimestamp(Date.now() + seconds * 1000);
}

function secondsUntil(timestampValue) {
  const parsed = fromSqlTimestamp(timestampValue);
  if (!parsed) {
    return 0;
  }

  return Math.max(0, Math.ceil((parsed - Date.now()) / 1000));
}

function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLUMNS).fill(null));
}

function parseBoard(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    if (
      Array.isArray(parsed)
      && parsed.length === BOARD_ROWS
      && parsed.every(
        (row) =>
          Array.isArray(row)
          && row.length === BOARD_COLUMNS
          && row.every((cell) => cell === null || cell === "red" || cell === "yellow"),
      )
    ) {
      return parsed;
    }
  } catch (_error) {
    // Fallback below.
  }

  return createEmptyBoard();
}

function stringifyBoard(board) {
  return JSON.stringify(board || createEmptyBoard());
}

function otherColor(color) {
  return color === "red" ? "yellow" : "red";
}

function mapTableRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    entryFee: Number(row.entry_fee),
    turnSeconds: Number(row.turn_seconds),
    showdownSeconds: Number(row.showdown_seconds),
    status: row.status,
    board: parseBoard(row.board_json),
    redUserId: row.red_user_id ? Number(row.red_user_id) : null,
    redUsername: row.red_username_snapshot || null,
    yellowUserId: row.yellow_user_id ? Number(row.yellow_user_id) : null,
    yellowUsername: row.yellow_username_snapshot || null,
    activeColor: row.active_color || null,
    activeUserId: row.active_user_id ? Number(row.active_user_id) : null,
    winnerUserId: row.winner_user_id ? Number(row.winner_user_id) : null,
    winnerColor: row.winner_color || null,
    winnerReason: row.winner_reason || null,
    pot: Number(row.pot || 0),
    moveCount: Number(row.move_count || 0),
    actionDeadline: row.action_deadline || null,
    nextGameAt: row.next_game_at || null,
    updatedAt: row.updated_at,
  };
}

function seatForColor(table, color) {
  if (color === "red") {
    return {
      color: "red",
      userId: table.redUserId,
      username: table.redUsername,
    };
  }

  return {
    color: "yellow",
    userId: table.yellowUserId,
    username: table.yellowUsername,
  };
}

function colorForUser(table, userId) {
  if (!userId) {
    return null;
  }

  if (table.redUserId === Number(userId)) {
    return "red";
  }

  if (table.yellowUserId === Number(userId)) {
    return "yellow";
  }

  return null;
}

function isBoardFull(board) {
  return board.every((row) => row.every(Boolean));
}

function dropDisc(board, column, color) {
  for (let rowIndex = BOARD_ROWS - 1; rowIndex >= 0; rowIndex -= 1) {
    if (!board[rowIndex][column]) {
      board[rowIndex][column] = color;
      return rowIndex;
    }
  }

  return -1;
}

function countAligned(board, row, column, color, rowDelta, columnDelta) {
  let count = 1;

  for (const direction of [-1, 1]) {
    let nextRow = row + rowDelta * direction;
    let nextColumn = column + columnDelta * direction;

    while (
      nextRow >= 0
      && nextRow < BOARD_ROWS
      && nextColumn >= 0
      && nextColumn < BOARD_COLUMNS
      && board[nextRow][nextColumn] === color
    ) {
      count += 1;
      nextRow += rowDelta * direction;
      nextColumn += columnDelta * direction;
    }
  }

  return count;
}

function isWinningMove(board, row, column, color) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  return directions.some(([rowDelta, columnDelta]) =>
    countAligned(board, row, column, color, rowDelta, columnDelta) >= 4,
  );
}

function describeWinnerReason(reason) {
  if (reason === "timeout") {
    return "temps";
  }

  if (reason === "abandon") {
    return "abandon";
  }

  if (reason === "draw") {
    return "match nul";
  }

  return "alignement";
}

async function ensureConnect4Table() {
  let row = await get(
    `
      SELECT *
      FROM connect4_tables
      WHERE slug = ?
    `,
    [TABLE_PRESET.slug],
  );

  if (row) {
    const hasPlayers = Boolean(row.red_user_id || row.yellow_user_id);
    const needsRefresh =
      Number(row.entry_fee) !== config.connect4EntryFee
      || Number(row.turn_seconds) !== config.connect4TurnSeconds
      || Number(row.showdown_seconds) !== config.connect4ShowdownSeconds;

    if (needsRefresh && !hasPlayers && row.status !== "playing") {
      await run(
        `
          UPDATE connect4_tables
          SET entry_fee = ?,
              turn_seconds = ?,
              showdown_seconds = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          config.connect4EntryFee,
          config.connect4TurnSeconds,
          config.connect4ShowdownSeconds,
          row.id,
        ],
      );

      row = await get(
        `
          SELECT *
          FROM connect4_tables
          WHERE slug = ?
        `,
        [TABLE_PRESET.slug],
      );
    }

    return mapTableRow(row);
  }

  await run(
    `
      INSERT INTO connect4_tables (
        slug,
        name,
        entry_fee,
        turn_seconds,
        showdown_seconds,
        status,
        board_json,
        pot,
        move_count
      )
      VALUES (?, ?, ?, ?, ?, 'waiting', ?, 0, 0)
    `,
    [
      TABLE_PRESET.slug,
      TABLE_PRESET.name,
      config.connect4EntryFee,
      config.connect4TurnSeconds,
      config.connect4ShowdownSeconds,
      stringifyBoard(createEmptyBoard()),
    ],
  );

  row = await get(
    `
      SELECT *
      FROM connect4_tables
      WHERE slug = ?
    `,
    [TABLE_PRESET.slug],
  );

  return mapTableRow(row);
}

async function getConnect4Table() {
  return ensureConnect4Table();
}

async function recordConnect4Action(tableId, action) {
  await run(
    `
      INSERT INTO connect4_action_logs (
        table_id,
        user_id,
        username_snapshot,
        action_type,
        color,
        column_no,
        row_no,
        details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      tableId,
      action.userId || null,
      action.usernameSnapshot || "Systeme",
      action.actionType,
      action.color || null,
      action.columnNo || null,
      action.rowNo || null,
      action.details || null,
    ],
  );
}

async function pushNotification(userId, type, message) {
  if (!userId) {
    return;
  }

  await run(
    `
      INSERT INTO notifications (user_id, type, message)
      VALUES (?, ?, ?)
    `,
    [userId, type, message],
  );
}

async function applyUserLedger(userId, delta, logType, note, stats = {}) {
  const user = await get("SELECT * FROM users WHERE id = ?", [userId]);

  if (!user) {
    throw new Error("Compte introuvable.");
  }

  const balanceBefore = Number(user.balance || 0);
  const balanceAfter = balanceBefore + delta;

  if (balanceAfter < 0) {
    throw new Error("Solde insuffisant.");
  }

  const wagerIncrement = Number(stats.wagerIncrement || 0);
  const winIncrement = Number(stats.winIncrement || 0);
  const profitIncrement =
    stats.profitIncrement === undefined ? delta : Number(stats.profitIncrement || 0);
  const highestWinCandidate = Number(stats.highestWinCandidate || 0);
  const nextHighestWin = Math.max(Number(user.highest_win || 0), highestWinCandidate);

  await run(
    `
      UPDATE users
      SET balance = ?,
          total_wagered = total_wagered + ?,
          total_won = total_won + ?,
          total_profit = total_profit + ?,
          highest_win = ?
      WHERE id = ?
    `,
    [
      balanceAfter,
      wagerIncrement,
      winIncrement,
      profitIncrement,
      nextHighestWin,
      userId,
    ],
  );

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
    [userId, logType, delta, balanceBefore, balanceAfter, note || null],
  );

  return get("SELECT * FROM users WHERE id = ?", [userId]);
}

async function loadRecentActions(tableId) {
  const rows = await all(
    `
      SELECT *
      FROM (
        SELECT *
        FROM connect4_action_logs
        WHERE table_id = ?
        ORDER BY id DESC
        LIMIT 12
      )
      ORDER BY id ASC
    `,
    [tableId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    username: row.username_snapshot,
    actionType: row.action_type,
    color: row.color || null,
    columnNo: row.column_no ? Number(row.column_no) : null,
    rowNo: row.row_no ? Number(row.row_no) : null,
    details: row.details || "",
    createdAt: row.created_at,
  }));
}

function buildStatusText(table) {
  const redSeat = seatForColor(table, "red");
  const yellowSeat = seatForColor(table, "yellow");

  if (table.status === "playing") {
    const activeSeat = seatForColor(table, table.activeColor || "red");
    return activeSeat.username
      ? `A ${activeSeat.username} de jouer.`
      : "Une partie est en cours.";
  }

  if (table.status === "showdown") {
    if (table.winnerReason === "draw") {
      return "Match nul, les mises repartent aux deux joueurs.";
    }

    const winnerSeat = table.winnerColor ? seatForColor(table, table.winnerColor) : null;
    return winnerSeat?.username
      ? `${winnerSeat.username} gagne par ${describeWinnerReason(table.winnerReason)}.`
      : "La manche se termine.";
  }

  if (!redSeat.userId && !yellowSeat.userId) {
    return "Assieds-toi et attends un rival.";
  }

  if (redSeat.userId && yellowSeat.userId) {
    return "Les deux joueurs sont assis, la manche part.";
  }

  return "Un seul joueur est assis, il manque un rival.";
}

async function buildConnect4State(userId) {
  const table = await getConnect4Table();
  const [user, recentActions] = await Promise.all([
    get("SELECT * FROM users WHERE id = ?", [userId]),
    loadRecentActions(table.id),
  ]);
  const lastAction = recentActions[recentActions.length - 1] || null;
  const myColor = colorForUser(table, userId);
  const seatCount = [table.redUserId, table.yellowUserId].filter(Boolean).length;
  const activeSeat = table.activeColor ? seatForColor(table, table.activeColor) : null;
  const winnerSeat = table.winnerColor ? seatForColor(table, table.winnerColor) : null;
  const joinBlockedByBalance =
    !myColor && Number(user?.balance || 0) < Number(table.entryFee || config.connect4EntryFee);

  return {
    slug: table.slug,
    name: table.name,
    entryFee: table.entryFee,
    winnerPayout: config.connect4WinnerPayout,
    turnSeconds: table.turnSeconds,
    showdownSeconds: table.showdownSeconds,
    status: table.status,
    statusText: buildStatusText(table),
    board: table.board,
    pot: table.pot,
    moveCount: table.moveCount,
    myColor,
    myTurn: Boolean(myColor && table.activeUserId === Number(userId)),
    canJoin:
      !myColor
      && table.status === "waiting"
      && seatCount < 2
      && !joinBlockedByBalance,
    canLeave: Boolean(myColor),
    joinBlockedByBalance,
    seatCount,
    secondsToAct: table.status === "playing" ? secondsUntil(table.actionDeadline) : 0,
    secondsToNextGame: table.status === "showdown" ? secondsUntil(table.nextGameAt) : 0,
    updatedAt: table.updatedAt,
    lastActionId: lastAction ? Number(lastAction.id) : 0,
    activeColor: table.activeColor,
    activeUsername: activeSeat?.username || null,
    winnerColor: table.winnerColor,
    winnerUsername: winnerSeat?.username || null,
    winnerReason: table.winnerReason,
    seats: ["red", "yellow"].map((color) => {
      const seat = seatForColor(table, color);
      return {
        color,
        label: color === "red" ? "Rouge" : "Jaune",
        userId: seat.userId,
        username: seat.username,
        occupied: Boolean(seat.userId),
        isMe: seat.userId === Number(userId),
      };
    }),
    recentActions,
  };
}

async function resetConnect4Table(tableId) {
  await run(
    `
      UPDATE connect4_tables
      SET status = 'waiting',
          board_json = ?,
          red_user_id = NULL,
          red_username_snapshot = NULL,
          yellow_user_id = NULL,
          yellow_username_snapshot = NULL,
          active_color = NULL,
          active_user_id = NULL,
          winner_user_id = NULL,
          winner_color = NULL,
          winner_reason = NULL,
          pot = 0,
          move_count = 0,
          action_deadline = NULL,
          next_game_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [stringifyBoard(createEmptyBoard()), tableId],
  );
}

async function startConnect4Match(table) {
  const startColor = crypto.randomInt(0, 2) === 0 ? "red" : "yellow";
  const activeSeat = seatForColor(table, startColor);

  await run(
    `
      UPDATE connect4_tables
      SET status = 'playing',
          board_json = ?,
          active_color = ?,
          active_user_id = ?,
          winner_user_id = NULL,
          winner_color = NULL,
          winner_reason = NULL,
          move_count = 0,
          action_deadline = ?,
          next_game_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      stringifyBoard(createEmptyBoard()),
      startColor,
      activeSeat.userId,
      inSeconds(config.connect4TurnSeconds),
      table.id,
    ],
  );

  await recordConnect4Action(table.id, {
    actionType: "start",
    color: startColor,
    details: `Nouvelle manche, ${activeSeat.username || "joueur"} commence.`,
  });
}

async function resolveWin(table, winnerColor, reason, options = {}) {
  const winnerSeat = seatForColor(table, winnerColor);
  const loserSeat = seatForColor(table, otherColor(winnerColor));
  const board = options.board || table.board;
  const moveCount = Number(options.moveCount ?? table.moveCount);
  const reasonLabel = describeWinnerReason(reason);
  const winnerPayout = Math.max(
    0,
    Math.min(Number(config.connect4WinnerPayout || 0), Number(table.pot || 0)),
  );

  if (!winnerSeat.userId) {
    await resetConnect4Table(table.id);
    return;
  }

  await applyUserLedger(
    winnerSeat.userId,
    winnerPayout,
    "connect4_win",
    `Gain Puissance 4 Blitz (${reasonLabel})`,
    {
      winIncrement: winnerPayout,
      profitIncrement: winnerPayout,
      highestWinCandidate: winnerPayout,
    },
  );

  await pushNotification(
    winnerSeat.userId,
    "win",
    `Tu remportes ${winnerPayout.toLocaleString("fr-FR")} kamas sur Puissance 4 Blitz (${reasonLabel}).`,
  );

  if (loserSeat.userId) {
    await pushNotification(
      loserSeat.userId,
      "info",
      `Tu perds la manche Puissance 4 Blitz par ${reasonLabel}.`,
    );
  }

  await run(
    `
      UPDATE connect4_tables
      SET status = 'showdown',
          board_json = ?,
          active_color = NULL,
          active_user_id = NULL,
          winner_user_id = ?,
          winner_color = ?,
          winner_reason = ?,
          move_count = ?,
          action_deadline = NULL,
          next_game_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      stringifyBoard(board),
      winnerSeat.userId,
      winnerColor,
      reason,
      moveCount,
      inSeconds(config.connect4ShowdownSeconds),
      table.id,
    ],
  );

  await recordConnect4Action(table.id, {
    actionType: "result",
    userId: winnerSeat.userId,
    usernameSnapshot: winnerSeat.username || "Systeme",
    color: winnerColor,
    details: `${winnerSeat.username || "Joueur"} gagne par ${reasonLabel}.`,
  });
}

async function resolveDraw(table, board, moveCount) {
  const refundTargets = [seatForColor(table, "red"), seatForColor(table, "yellow")];

  for (const seat of refundTargets) {
    if (!seat.userId) {
      continue;
    }

    await applyUserLedger(
      seat.userId,
      table.entryFee,
      "connect4_refund",
      "Remboursement Puissance 4 Blitz (match nul)",
      {
        winIncrement: table.entryFee,
        profitIncrement: table.entryFee,
      },
    );

    await pushNotification(
      seat.userId,
      "info",
      `Match nul sur Puissance 4 Blitz, ${table.entryFee.toLocaleString("fr-FR")} kamas te sont rendus.`,
    );
  }

  await run(
    `
      UPDATE connect4_tables
      SET status = 'showdown',
          board_json = ?,
          active_color = NULL,
          active_user_id = NULL,
          winner_user_id = NULL,
          winner_color = NULL,
          winner_reason = 'draw',
          move_count = ?,
          action_deadline = NULL,
          next_game_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [stringifyBoard(board), moveCount, inSeconds(config.connect4ShowdownSeconds), table.id],
  );

  await recordConnect4Action(table.id, {
    actionType: "result",
    details: "La manche se termine sur un match nul.",
  });
}

async function joinConnect4Table(userId) {
  return withTransaction(async () => {
    const [user, table] = await Promise.all([
      get("SELECT * FROM users WHERE id = ?", [userId]),
      getConnect4Table(),
    ]);

    if (!user) {
      throw new Error("Compte introuvable.");
    }

    if (table.status === "showdown") {
      throw new Error("La manche precedente se termine. Attends quelques secondes.");
    }

    const myColor = colorForUser(table, userId);
    if (myColor) {
      return get("SELECT * FROM users WHERE id = ?", [userId]);
    }

    const color = !table.redUserId ? "red" : !table.yellowUserId ? "yellow" : null;
    if (!color) {
      throw new Error("La table Puissance 4 est deja complete.");
    }

    if (Number(user.balance) < table.entryFee) {
      throw new Error(
        `Il faut ${table.entryFee.toLocaleString("fr-FR")} kamas pour rejoindre cette partie.`,
      );
    }

    await applyUserLedger(
      userId,
      -table.entryFee,
      "connect4_buy_in",
      "Entree Puissance 4 Blitz",
      {
        wagerIncrement: table.entryFee,
        profitIncrement: -table.entryFee,
      },
    );

    const userColumn = color === "red" ? "red" : "yellow";
    await run(
      `
        UPDATE connect4_tables
        SET ${userColumn}_user_id = ?,
            ${userColumn}_username_snapshot = ?,
            pot = pot + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [userId, user.username, table.entryFee, table.id],
    );

    await recordConnect4Action(table.id, {
      actionType: "join",
      userId,
      usernameSnapshot: user.username,
      color,
      details: `${user.username} s'assoit en ${color === "red" ? "rouge" : "jaune"}.`,
    });

    const refreshedTable = await getConnect4Table();
    if (refreshedTable.redUserId && refreshedTable.yellowUserId && refreshedTable.status === "waiting") {
      await startConnect4Match(refreshedTable);
    }

    return get("SELECT * FROM users WHERE id = ?", [userId]);
  });
}

async function leaveConnect4Table(userId) {
  return withTransaction(async () => {
    const [user, table] = await Promise.all([
      get("SELECT * FROM users WHERE id = ?", [userId]),
      getConnect4Table(),
    ]);
    const myColor = colorForUser(table, userId);

    if (!user || !myColor) {
      throw new Error("Tu n'es pas assis a la table Puissance 4.");
    }

    if (table.status === "playing") {
      const winnerColor = otherColor(myColor);
      const winnerSeat = seatForColor(table, winnerColor);

      await recordConnect4Action(table.id, {
        actionType: "leave",
        userId,
        usernameSnapshot: user.username,
        color: myColor,
        details: `${user.username} abandonne la manche.`,
      });

      if (winnerSeat.userId) {
        await resolveWin(table, winnerColor, "abandon");
      } else {
        await resetConnect4Table(table.id);
      }

      return get("SELECT * FROM users WHERE id = ?", [userId]);
    }

    if (table.status === "waiting") {
      await applyUserLedger(
        userId,
        table.entryFee,
        "connect4_refund",
        "Remboursement Puissance 4 Blitz avant depart",
        {
          winIncrement: table.entryFee,
          profitIncrement: table.entryFee,
        },
      );
    }

    const userColumn = myColor === "red" ? "red" : "yellow";
    const potAdjustment = table.status === "waiting" ? table.entryFee : 0;

    await run(
      `
        UPDATE connect4_tables
        SET ${userColumn}_user_id = NULL,
            ${userColumn}_username_snapshot = NULL,
            pot = MAX(0, pot - ?),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [potAdjustment, table.id],
    );

    await recordConnect4Action(table.id, {
      actionType: "leave",
      userId,
      usernameSnapshot: user.username,
      color: myColor,
      details:
        table.status === "waiting"
          ? `${user.username} quitte la file et recupere sa mise.`
          : `${user.username} quitte la table.`,
    });

    const refreshedTable = await getConnect4Table();
    if (!refreshedTable.redUserId && !refreshedTable.yellowUserId && refreshedTable.status !== "playing") {
      await resetConnect4Table(refreshedTable.id);
    }

    return get("SELECT * FROM users WHERE id = ?", [userId]);
  });
}

async function playConnect4Move(userId, requestedColumn) {
  return withTransaction(async () => {
    const [user, table] = await Promise.all([
      get("SELECT * FROM users WHERE id = ?", [userId]),
      getConnect4Table(),
    ]);
    const myColor = colorForUser(table, userId);
    const column = Number.parseInt(requestedColumn, 10);

    if (!user || !myColor) {
      throw new Error("Tu n'es pas a la table Puissance 4.");
    }

    if (table.status !== "playing") {
      throw new Error("Aucune manche Puissance 4 n'est en cours.");
    }

    if (table.activeUserId !== Number(userId)) {
      throw new Error("Ce n'est pas ton tour.");
    }

    if (!Number.isInteger(column) || column < 0 || column >= BOARD_COLUMNS) {
      throw new Error("Colonne Puissance 4 invalide.");
    }

    const board = table.board.map((row) => row.slice());
    const row = dropDisc(board, column, myColor);

    if (row < 0) {
      throw new Error("Cette colonne est deja pleine.");
    }

    const nextMoveCount = table.moveCount + 1;

    await recordConnect4Action(table.id, {
      actionType: "drop",
      userId,
      usernameSnapshot: user.username,
      color: myColor,
      columnNo: column + 1,
      rowNo: row + 1,
      details: `${user.username} joue en colonne ${column + 1}.`,
    });

    if (isWinningMove(board, row, column, myColor)) {
      await resolveWin(
        {
          ...table,
          board,
          moveCount: nextMoveCount,
        },
        myColor,
        "align",
        { board, moveCount: nextMoveCount },
      );

      return get("SELECT * FROM users WHERE id = ?", [userId]);
    }

    if (isBoardFull(board)) {
      await resolveDraw(
        {
          ...table,
          board,
        },
        board,
        nextMoveCount,
      );

      return get("SELECT * FROM users WHERE id = ?", [userId]);
    }

    const nextColor = otherColor(myColor);
    const nextSeat = seatForColor(table, nextColor);

    await run(
      `
        UPDATE connect4_tables
        SET board_json = ?,
            move_count = ?,
            active_color = ?,
            active_user_id = ?,
            action_deadline = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        stringifyBoard(board),
        nextMoveCount,
        nextColor,
        nextSeat.userId,
        inSeconds(config.connect4TurnSeconds),
        table.id,
      ],
    );

    return get("SELECT * FROM users WHERE id = ?", [userId]);
  });
}

async function tickConnect4Engine() {
  if (connect4EngineBusy) {
    return;
  }

  connect4EngineBusy = true;

  try {
    const table = await getConnect4Table();
    const actionDeadlineAt = fromSqlTimestamp(table.actionDeadline);
    const nextGameAt = fromSqlTimestamp(table.nextGameAt);

    if (
      table.status === "playing"
      && actionDeadlineAt
      && Date.now() >= actionDeadlineAt + TURN_TIMEOUT_GRACE_MS
    ) {
      const winnerColor = table.activeColor ? otherColor(table.activeColor) : null;
      if (winnerColor) {
        await resolveWin(table, winnerColor, "timeout");
      } else {
        await resetConnect4Table(table.id);
      }
    } else if (
      table.status === "showdown"
      && nextGameAt
      && Date.now() >= nextGameAt + TURN_TIMEOUT_GRACE_MS
    ) {
      await resetConnect4Table(table.id);
    }
  } finally {
    connect4EngineBusy = false;
  }
}

async function startConnect4Engine() {
  if (connect4EngineStarted) {
    return;
  }

  await ensureConnect4Table();
  connect4EngineStarted = true;
  connect4EngineTimer = setInterval(() => {
    tickConnect4Engine().catch((error) => {
      console.error("Connect4 engine error:", error);
    });
  }, 1000);

  if (typeof connect4EngineTimer.unref === "function") {
    connect4EngineTimer.unref();
  }

  await tickConnect4Engine();
}

module.exports = {
  BOARD_COLUMNS,
  BOARD_ROWS,
  buildConnect4State,
  joinConnect4Table,
  leaveConnect4Table,
  playConnect4Move,
  startConnect4Engine,
};
