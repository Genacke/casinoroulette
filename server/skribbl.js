const crypto = require("crypto");
const { config } = require("./config");
const { all, get, run, withTransaction } = require("./db");
const { SKRIBBL_WORDS } = require("./skribbl-words");

const ROOM_PRESET = {
  slug: "skribbl-des-douze",
  name: "Skribbl des Douze",
};
const PODIUM_WEIGHTS = [50, 30, 20];
const MAX_GUESS_LENGTH = 48;
const MAX_STROKE_POINTS = 180;
const MIN_STROKE_WIDTH = 2;
const MAX_STROKE_WIDTH = 28;
const ALLOWED_COLORS = new Set([
  "#f6eed9",
  "#201912",
  "#d69438",
  "#b8573f",
  "#5e8d46",
  "#4f76c7",
  "#9a72dd",
  "#f08d8d",
]);

let skribblEngineStarted = false;
let skribblEngineBusy = false;
let skribblEngineTimer = null;

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

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeGuessInput(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_GUESS_LENGTH);
}

function normalizeComparableWord(value) {
  return normalizeGuessInput(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildWordMask(word) {
  return Array.from(String(word || ""))
    .map((character) => (/^[a-z0-9]$/i.test(character) ? "_" : character))
    .join(" ");
}

function pickRandomWord() {
  return SKRIBBL_WORDS[crypto.randomInt(0, SKRIBBL_WORDS.length)];
}

function computePrizeShares(totalAmount, winnerCount) {
  const selectedWeights = PODIUM_WEIGHTS.slice(0, winnerCount);
  const weightTotal = selectedWeights.reduce((sum, weight) => sum + weight, 0);
  let remainder = Math.max(0, Number(totalAmount || 0));

  return selectedWeights.map((weight, index) => {
    if (index === selectedWeights.length - 1) {
      return remainder;
    }

    const share = Math.floor((totalAmount * weight) / weightTotal);
    remainder -= share;
    return share;
  });
}

function mapRoomRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    entryFee: Number(row.entry_fee),
    drawSeconds: Number(row.draw_seconds),
    showdownSeconds: Number(row.showdown_seconds),
    minPlayers: Number(row.min_players),
    maxPlayers: Number(row.max_players),
    status: row.status,
    roundNumber: Number(row.round_number || 0),
    drawerUserId: row.drawer_user_id ? Number(row.drawer_user_id) : null,
    drawerUsername: row.drawer_username_snapshot || null,
    currentWord: row.current_word || null,
    pot: Number(row.pot || 0),
    phaseDeadline: row.phase_deadline || null,
    nextRoundAt: row.next_round_at || null,
    updatedAt: row.updated_at,
  };
}

function mapPlayerRow(row) {
  return {
    id: Number(row.id),
    roomId: Number(row.room_id),
    userId: Number(row.user_id),
    username: row.username_snapshot,
    seatOrder: Number(row.seat_order),
    guessedCorrect: Boolean(row.guessed_correct),
    guessRank: row.guess_rank ? Number(row.guess_rank) : null,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

function parseStoredStroke(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "{}");
    if (!parsed || !Array.isArray(parsed.points)) {
      return null;
    }

    return {
      color: parsed.color,
      width: Number(parsed.width),
      points: parsed.points.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      })),
    };
  } catch (_error) {
    return null;
  }
}

function parseStrokeInput(input) {
  const color = String(input?.color || "").toLowerCase();
  const width = Math.round(clampNumber(Number(input?.width || 5), MIN_STROKE_WIDTH, MAX_STROKE_WIDTH));
  const rawPoints = Array.isArray(input?.points) ? input.points.slice(0, MAX_STROKE_POINTS) : [];

  if (!ALLOWED_COLORS.has(color)) {
    throw new Error("Couleur de trait invalide.");
  }

  const points = rawPoints
    .map((point) => ({
      x: Number(point?.x),
      y: Number(point?.y),
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: Number(clampNumber(point.x, 0, 1).toFixed(4)),
      y: Number(clampNumber(point.y, 0, 1).toFixed(4)),
    }));

  if (!points.length) {
    throw new Error("Trait invalide.");
  }

  if (points.length === 1) {
    points.push({ ...points[0] });
  }

  return {
    color,
    width,
    points,
  };
}

async function getFreshUser(userId) {
  return get("SELECT * FROM users WHERE id = ?", [userId]);
}

async function getRoomRowBySlug(slug = ROOM_PRESET.slug) {
  return get(
    `
      SELECT *
      FROM skribbl_rooms
      WHERE slug = ?
    `,
    [slug],
  );
}

async function getRoomById(roomId) {
  return get(
    `
      SELECT *
      FROM skribbl_rooms
      WHERE id = ?
    `,
    [roomId],
  );
}

async function countPlayers(roomId) {
  const row = await get(
    `
      SELECT COUNT(*) AS total
      FROM skribbl_players
      WHERE room_id = ?
    `,
    [roomId],
  );

  return Number(row?.total || 0);
}

async function ensureSkribblRoom() {
  let row = await getRoomRowBySlug();

  if (row) {
    const playerCount = await countPlayers(row.id);
    const needsRefresh =
      Number(row.entry_fee) !== config.skribblEntryFee
      || Number(row.draw_seconds) !== config.skribblDrawSeconds
      || Number(row.showdown_seconds) !== config.skribblShowdownSeconds
      || Number(row.min_players) !== config.skribblMinPlayers
      || Number(row.max_players) !== config.skribblMaxPlayers;

    if (needsRefresh && playerCount === 0 && row.status === "waiting") {
      await run(
        `
          UPDATE skribbl_rooms
          SET entry_fee = ?,
              draw_seconds = ?,
              showdown_seconds = ?,
              min_players = ?,
              max_players = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [
          config.skribblEntryFee,
          config.skribblDrawSeconds,
          config.skribblShowdownSeconds,
          config.skribblMinPlayers,
          config.skribblMaxPlayers,
          row.id,
        ],
      );

      row = await getRoomRowBySlug();
    }

    return mapRoomRow(row);
  }

  await run(
    `
      INSERT INTO skribbl_rooms (
        slug,
        name,
        entry_fee,
        draw_seconds,
        showdown_seconds,
        min_players,
        max_players,
        status,
        pot,
        round_number
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', 0, 0)
    `,
    [
      ROOM_PRESET.slug,
      ROOM_PRESET.name,
      config.skribblEntryFee,
      config.skribblDrawSeconds,
      config.skribblShowdownSeconds,
      config.skribblMinPlayers,
      config.skribblMaxPlayers,
    ],
  );

  row = await getRoomRowBySlug();
  return mapRoomRow(row);
}

async function loadPlayers(roomId) {
  const rows = await all(
    `
      SELECT *
      FROM skribbl_players
      WHERE room_id = ?
      ORDER BY seat_order ASC, id ASC
    `,
    [roomId],
  );

  return rows.map(mapPlayerRow);
}

async function loadStrokes(roomId, roundNumber) {
  if (!roundNumber) {
    return [];
  }

  const rows = await all(
    `
      SELECT *
      FROM skribbl_strokes
      WHERE room_id = ?
        AND round_number = ?
      ORDER BY id ASC
    `,
    [roomId, roundNumber],
  );

  return rows
    .map((row) => ({
      id: Number(row.id),
      userId: Number(row.user_id),
      stroke: parseStoredStroke(row.stroke_json),
      createdAt: row.created_at,
    }))
    .filter((row) => row.stroke)
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      createdAt: row.createdAt,
      ...row.stroke,
    }));
}

async function loadGuessLogs(roomId, roundNumber) {
  if (!roundNumber) {
    return [];
  }

  const rows = await all(
    `
      SELECT *
      FROM (
        SELECT *
        FROM skribbl_guess_logs
        WHERE room_id = ?
          AND round_number = ?
        ORDER BY id DESC
        LIMIT 30
      )
      ORDER BY id ASC
    `,
    [roomId, roundNumber],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    username: row.username_snapshot,
    guessText: row.guess_text,
    normalizedGuess: row.normalized_guess,
    isCorrect: Boolean(row.is_correct),
    guessRank: row.guess_rank ? Number(row.guess_rank) : null,
    createdAt: row.created_at,
  }));
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

  return getFreshUser(userId);
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

async function appendGuessLog(roomId, roundNumber, payload) {
  await run(
    `
      INSERT INTO skribbl_guess_logs (
        room_id,
        round_number,
        user_id,
        username_snapshot,
        guess_text,
        normalized_guess,
        is_correct,
        guess_rank
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      roomId,
      roundNumber,
      payload.userId || null,
      payload.usernameSnapshot || "Systeme",
      payload.guessText || "",
      payload.normalizedGuess || "",
      payload.isCorrect ? 1 : 0,
      payload.guessRank || null,
    ],
  );
}

function getPodiumPlayers(players) {
  return players
    .filter((player) => player.guessedCorrect && player.guessRank && player.guessRank <= 3)
    .sort((left, right) => left.guessRank - right.guessRank);
}

function shouldResolveRound(room, players) {
  const guesserCount = players.filter((player) => player.userId !== room.drawerUserId).length;
  const correctCount = getPodiumPlayers(players).length;

  if (!guesserCount) {
    return true;
  }

  return correctCount >= Math.min(3, guesserCount);
}

async function startSkribblRound(room, players = null) {
  const seatedPlayers = players || (await loadPlayers(room.id));

  if (seatedPlayers.length < room.minPlayers) {
    return;
  }

  const drawer = seatedPlayers[crypto.randomInt(0, seatedPlayers.length)];
  const word = pickRandomWord();

  await run(
    `
      UPDATE skribbl_rooms
      SET status = 'playing',
          round_number = ?,
          drawer_user_id = ?,
          drawer_username_snapshot = ?,
          current_word = ?,
          phase_deadline = ?,
          next_round_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      Number(room.roundNumber || 0) + 1,
      drawer.userId,
      drawer.username,
      word,
      inSeconds(room.drawSeconds),
      room.id,
    ],
  );

  await run("DELETE FROM skribbl_strokes WHERE room_id = ?", [room.id]);
  await run(
    `
      UPDATE skribbl_players
      SET guessed_correct = 0,
          guess_rank = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE room_id = ?
    `,
    [room.id],
  );
}

async function resolveSkribblRound(room, players = null) {
  const seatedPlayers = players || (await loadPlayers(room.id));
  const podiumPlayers = getPodiumPlayers(seatedPlayers);
  const payoutPool = Math.max(
    0,
    Math.floor(Number(room.pot || 0) * ((100 - config.skribblHousePercent) / 100)),
  );
  const prizes = computePrizeShares(payoutPool, podiumPlayers.length);

  for (let index = 0; index < podiumPlayers.length; index += 1) {
    const player = podiumPlayers[index];
    const prize = prizes[index] || 0;

    if (!prize) {
      continue;
    }

    await applyUserLedger(
      player.userId,
      prize,
      "skribbl_win",
      `Gain Skribbl rang ${index + 1}`,
      {
        winIncrement: prize,
        profitIncrement: prize,
        highestWinCandidate: prize,
      },
    );

    await pushNotification(
      player.userId,
      "win",
      `Tu termines #${index + 1} sur Skribbl et prends ${prize.toLocaleString("fr-FR")} kamas.`,
    );
  }

  await run(
    `
      UPDATE skribbl_rooms
      SET status = 'showdown',
          phase_deadline = NULL,
          next_round_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [inSeconds(room.showdownSeconds), room.id],
  );
}

async function resetSkribblRoom(roomId) {
  await run("DELETE FROM skribbl_players WHERE room_id = ?", [roomId]);
  await run("DELETE FROM skribbl_strokes WHERE room_id = ?", [roomId]);
  await run(
    `
      UPDATE skribbl_rooms
      SET status = 'waiting',
          drawer_user_id = NULL,
          drawer_username_snapshot = NULL,
          current_word = NULL,
          pot = 0,
          phase_deadline = NULL,
          next_round_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [roomId],
  );
}

function buildStatusText(room, players, viewerId) {
  const playersNeeded = Math.max(0, room.minPlayers - players.length);
  const podiumPlayers = getPodiumPlayers(players);

  if (room.status === "playing") {
    if (room.drawerUserId === Number(viewerId)) {
      return "Dessine le mot sans jamais l'ecrire dans le chat.";
    }

    return room.drawerUsername
      ? `${room.drawerUsername} dessine. Trouve le mot avant la fin du sablier.`
      : "Un dessinateur est en scene.";
  }

  if (room.status === "showdown") {
    if (!room.currentWord) {
      return "La manche se termine.";
    }

    if (!podiumPlayers.length) {
      return `Personne n'a trouve ${room.currentWord}. La salle reset.`;
    }

    return `${podiumPlayers[0].username} prend la premiere place. Mot: ${room.currentWord}.`;
  }

  if (!players.length) {
    return "Pose 100 000 kamas pour entrer dans la manche de dessin.";
  }

  if (playersNeeded > 0) {
    return `Encore ${playersNeeded} joueur(s) pour lancer une manche.`;
  }

  return "Le croupier choisit un dessinateur.";
}

function buildWordView(room, myPlayer) {
  if (!room.currentWord) {
    return {
      label: "Mot",
      value: "En attente",
    };
  }

  if (room.status === "showdown") {
    return {
      label: "Mot revele",
      value: room.currentWord,
    };
  }

  if (room.drawerUserId === myPlayer?.userId) {
    return {
      label: "Ton mot",
      value: room.currentWord,
    };
  }

  if (myPlayer?.guessedCorrect) {
    return {
      label: "Mot trouve",
      value: room.currentWord,
    };
  }

  return {
    label: "Indice",
    value: buildWordMask(room.currentWord),
  };
}

function buildGuessFeed(room, guessLogs) {
  return guessLogs.map((guess) => ({
    id: guess.id,
    username: guess.username,
    isCorrect: guess.isCorrect,
    guessRank: guess.guessRank,
    createdAt: guess.createdAt,
    text:
      guess.isCorrect && room.status === "playing"
        ? `${guess.username} a trouve le mot !`
        : guess.guessText,
  }));
}

function buildPlayersState(room, players, myUserId, payoutPool) {
  const podiumPlayers = getPodiumPlayers(players);
  const podiumPrizes =
    room.status === "showdown"
      ? computePrizeShares(payoutPool, podiumPlayers.length)
      : [];

  return players.map((player) => {
    const podiumIndex = podiumPlayers.findIndex((candidate) => candidate.userId === player.userId);
    const isDrawer = room.drawerUserId === player.userId;

    return {
      userId: player.userId,
      username: player.username,
      seatOrder: player.seatOrder,
      isMe: player.userId === Number(myUserId),
      isDrawer,
      guessedCorrect: player.guessedCorrect,
      guessRank: player.guessRank,
      prize:
        podiumIndex >= 0 && room.status === "showdown"
          ? podiumPrizes[podiumIndex] || 0
          : 0,
      badge: isDrawer
        ? "Dessine"
        : player.guessRank
          ? `#${player.guessRank}`
          : room.status === "playing"
            ? "En piste"
            : "Pret",
    };
  });
}

function buildPodiumState(players, payoutPool, roomStatus) {
  const podiumPlayers = getPodiumPlayers(players);
  const prizes =
    roomStatus === "showdown"
      ? computePrizeShares(payoutPool, podiumPlayers.length)
      : [];

  return podiumPlayers.map((player, index) => ({
    rank: index + 1,
    username: player.username,
    prize: prizes[index] || 0,
  }));
}

async function buildSkribblState(userId) {
  const room = await ensureSkribblRoom();
  const [user, players, strokes, guessLogs] = await Promise.all([
    getFreshUser(userId),
    loadPlayers(room.id),
    loadStrokes(room.id, room.roundNumber),
    loadGuessLogs(room.id, room.roundNumber),
  ]);

  const myPlayer = players.find((player) => player.userId === Number(userId)) || null;
  const wordView = buildWordView(room, myPlayer);
  const payoutPool = Math.max(
    0,
    Math.floor(Number(room.pot || 0) * ((100 - config.skribblHousePercent) / 100)),
  );
  const previewPrizes = computePrizeShares(payoutPool, 3);
  const playersNeeded = Math.max(0, room.minPlayers - players.length);
  const joinBlockedByBalance =
    !myPlayer && Number(user?.balance || 0) < Number(room.entryFee || config.skribblEntryFee);

  return {
    slug: room.slug,
    name: room.name,
    entryFee: room.entryFee,
    drawSeconds: room.drawSeconds,
    showdownSeconds: room.showdownSeconds,
    housePercent: config.skribblHousePercent,
    librarySize: SKRIBBL_WORDS.length,
    minPlayers: room.minPlayers,
    maxPlayers: room.maxPlayers,
    status: room.status,
    statusText: buildStatusText(room, players, userId),
    roundNumber: room.roundNumber,
    seatCount: players.length,
    playersNeeded,
    pot: room.pot,
    payoutPool,
    houseCutAmount: Math.max(0, room.pot - payoutPool),
    drawerUserId: room.drawerUserId,
    drawerUsername: room.drawerUsername,
    secondsToEnd: room.status === "playing" ? secondsUntil(room.phaseDeadline) : 0,
    secondsToNextRound: room.status === "showdown" ? secondsUntil(room.nextRoundAt) : 0,
    canJoin:
      room.status === "waiting"
      && !myPlayer
      && players.length < room.maxPlayers
      && !joinBlockedByBalance,
    canLeave:
      Boolean(myPlayer)
      && !(room.status === "playing" && myPlayer?.guessedCorrect),
    joinBlockedByBalance,
    canDraw: room.status === "playing" && room.drawerUserId === Number(userId),
    canClear: room.status === "playing" && room.drawerUserId === Number(userId),
    canGuess:
      room.status === "playing"
      && Boolean(myPlayer)
      && room.drawerUserId !== Number(userId)
      && !myPlayer?.guessedCorrect,
    isDrawer: room.drawerUserId === Number(userId),
    hasGuessedCorrect: Boolean(myPlayer?.guessedCorrect),
    myGuessRank: myPlayer?.guessRank || null,
    wordLabel: wordView.label,
    wordDisplay: wordView.value,
    players: buildPlayersState(room, players, userId, payoutPool),
    podium: buildPodiumState(players, payoutPool, room.status),
    prizePreview: [
      { rank: 1, amount: previewPrizes[0] || 0 },
      { rank: 2, amount: previewPrizes[1] || 0 },
      { rank: 3, amount: previewPrizes[2] || 0 },
    ],
    guessFeed: buildGuessFeed(room, guessLogs),
    strokes,
    strokeCount: strokes.length,
    lastStrokeId: strokes.length ? strokes[strokes.length - 1].id : 0,
  };
}

async function joinSkribblRoom(userId) {
  return withTransaction(async () => {
    const room = await ensureSkribblRoom();
    const user = await getFreshUser(userId);
    const players = await loadPlayers(room.id);

    if (!user) {
      throw new Error("Compte introuvable.");
    }

    if (room.status !== "waiting") {
      throw new Error("La manche de dessin est deja en cours.");
    }

    if (players.some((player) => player.userId === Number(userId))) {
      throw new Error("Tu es deja assis dans la salle Skribbl.");
    }

    if (players.length >= room.maxPlayers) {
      throw new Error("La salle Skribbl est complete.");
    }

    if (Number(user.balance || 0) < room.entryFee) {
      throw new Error(`Il faut ${room.entryFee.toLocaleString("fr-FR")} kamas pour entrer.`);
    }

    await applyUserLedger(userId, -room.entryFee, "skribbl_buyin", "Entree Skribbl", {
      wagerIncrement: room.entryFee,
      profitIncrement: -room.entryFee,
    });

    const seatOrder = players.length
      ? Math.max(...players.map((player) => player.seatOrder)) + 1
      : 1;

    await run(
      `
        INSERT INTO skribbl_players (
          room_id,
          user_id,
          username_snapshot,
          seat_order
        )
        VALUES (?, ?, ?, ?)
      `,
      [room.id, userId, user.username, seatOrder],
    );

    await run(
      `
        UPDATE skribbl_rooms
        SET pot = pot + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [room.entryFee, room.id],
    );

    const refreshedRoom = mapRoomRow(await getRoomById(room.id));
    const refreshedPlayers = await loadPlayers(room.id);

    if (refreshedPlayers.length >= refreshedRoom.minPlayers) {
      await startSkribblRound(refreshedRoom, refreshedPlayers);
    }

    return getFreshUser(userId);
  });
}

async function leaveSkribblRoom(userId) {
  return withTransaction(async () => {
    const room = await ensureSkribblRoom();
    const player = await get(
      `
        SELECT *
        FROM skribbl_players
        WHERE room_id = ?
          AND user_id = ?
      `,
      [room.id, userId],
    );

    if (!player) {
      throw new Error("Tu n'es pas assis dans la salle Skribbl.");
    }

    const wasDrawer = room.drawerUserId === Number(userId);

    if (room.status === "playing" && player.guessed_correct) {
      throw new Error("Tu es deja classe, attends la fin de la manche.");
    }

    if (room.status === "waiting") {
      await applyUserLedger(userId, room.entryFee, "skribbl_refund", "Sortie salle Skribbl", {
        profitIncrement: room.entryFee,
      });
      await run(
        `
          UPDATE skribbl_rooms
          SET pot = MAX(0, pot - ?),
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [room.entryFee, room.id],
      );
    }

    await run(
      `
        DELETE FROM skribbl_players
        WHERE room_id = ?
          AND user_id = ?
      `,
      [room.id, userId],
    );

    if (room.status === "playing") {
      const refreshedRoom = mapRoomRow(await getRoomById(room.id));
      const remainingPlayers = await loadPlayers(room.id);

      if (
        wasDrawer
        || !remainingPlayers.length
        || remainingPlayers.length < refreshedRoom.minPlayers
      ) {
        await resolveSkribblRound(refreshedRoom, remainingPlayers);
      } else if (shouldResolveRound(refreshedRoom, remainingPlayers)) {
        await resolveSkribblRound(refreshedRoom, remainingPlayers);
      }
    }

    return getFreshUser(userId);
  });
}

async function submitSkribblGuess(userId, guessText) {
  return withTransaction(async () => {
    const room = await ensureSkribblRoom();
    const player = await get(
      `
        SELECT *
        FROM skribbl_players
        WHERE room_id = ?
          AND user_id = ?
      `,
      [room.id, userId],
    );

    if (!player) {
      throw new Error("Rejoins la salle Skribbl avant de deviner.");
    }

    if (room.status !== "playing") {
      throw new Error("Aucune manche de dessin n'est en cours.");
    }

    if (room.drawerUserId === Number(userId)) {
      throw new Error("Le dessinateur ne peut pas proposer de mot.");
    }

    if (player.guessed_correct) {
      throw new Error("Tu as deja trouve le mot.");
    }

    const cleanedGuess = normalizeGuessInput(guessText);
    if (cleanedGuess.length < 2) {
      throw new Error("Proposition trop courte.");
    }

    const normalizedGuess = normalizeComparableWord(cleanedGuess);
    const normalizedTarget = normalizeComparableWord(room.currentWord);

    if (!normalizedGuess) {
      throw new Error("Proposition invalide.");
    }

    if (normalizedGuess === normalizedTarget) {
      const rankedPlayers = await get(
        `
          SELECT COUNT(*) AS total
          FROM skribbl_players
          WHERE room_id = ?
            AND guessed_correct = 1
        `,
        [room.id],
      );
      const nextRank = Number(rankedPlayers?.total || 0) + 1;

      await run(
        `
          UPDATE skribbl_players
          SET guessed_correct = 1,
              guess_rank = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE room_id = ?
            AND user_id = ?
        `,
        [nextRank, room.id, userId],
      );

      const user = await getFreshUser(userId);

      await appendGuessLog(room.id, room.roundNumber, {
        userId,
        usernameSnapshot: user?.username || player.username_snapshot,
        guessText: cleanedGuess,
        normalizedGuess,
        isCorrect: true,
        guessRank: nextRank,
      });

      const refreshedRoom = mapRoomRow(await getRoomById(room.id));
      const refreshedPlayers = await loadPlayers(room.id);

      if (shouldResolveRound(refreshedRoom, refreshedPlayers)) {
        await resolveSkribblRound(refreshedRoom, refreshedPlayers);
      }

      return {
        user: await getFreshUser(userId),
        isCorrect: true,
        rank: nextRank,
      };
    }

    const user = await getFreshUser(userId);

    await appendGuessLog(room.id, room.roundNumber, {
      userId,
      usernameSnapshot: user?.username || player.username_snapshot,
      guessText: cleanedGuess,
      normalizedGuess,
      isCorrect: false,
      guessRank: null,
    });

    return {
      user,
      isCorrect: false,
      rank: null,
    };
  });
}

async function submitSkribblStroke(userId, strokeInput) {
  return withTransaction(async () => {
    const room = await ensureSkribblRoom();

    if (room.status !== "playing") {
      throw new Error("Le tableau n'accepte plus de traits.");
    }

    if (room.drawerUserId !== Number(userId)) {
      throw new Error("Seul le dessinateur peut tracer sur le tableau.");
    }

    const stroke = parseStrokeInput(strokeInput);

    await run(
      `
        INSERT INTO skribbl_strokes (
          room_id,
          round_number,
          user_id,
          stroke_json
        )
        VALUES (?, ?, ?, ?)
      `,
      [room.id, room.roundNumber, userId, JSON.stringify(stroke)],
    );

    return getFreshUser(userId);
  });
}

async function clearSkribblCanvas(userId) {
  return withTransaction(async () => {
    const room = await ensureSkribblRoom();

    if (room.status !== "playing") {
      throw new Error("Aucune manche active a effacer.");
    }

    if (room.drawerUserId !== Number(userId)) {
      throw new Error("Seul le dessinateur peut effacer la toile.");
    }

    await run(
      `
        DELETE FROM skribbl_strokes
        WHERE room_id = ?
          AND round_number = ?
      `,
      [room.id, room.roundNumber],
    );

    return getFreshUser(userId);
  });
}

async function tickSkribblEngine() {
  if (skribblEngineBusy) {
    return;
  }

  skribblEngineBusy = true;

  try {
    await withTransaction(async () => {
      const room = await ensureSkribblRoom();
      const players = await loadPlayers(room.id);

      if (room.status === "waiting" && players.length >= room.minPlayers) {
        await startSkribblRound(room, players);
        return;
      }

      if (room.status === "playing" && secondsUntil(room.phaseDeadline) <= 0) {
        await resolveSkribblRound(room, players);
        return;
      }

      if (room.status === "showdown" && secondsUntil(room.nextRoundAt) <= 0) {
        await resetSkribblRoom(room.id);
      }
    });
  } catch (error) {
    console.error("Erreur moteur Skribbl:", error);
  } finally {
    skribblEngineBusy = false;
  }
}

async function startSkribblEngine() {
  if (skribblEngineStarted) {
    return;
  }

  await ensureSkribblRoom();
  skribblEngineStarted = true;
  skribblEngineTimer = setInterval(() => {
    tickSkribblEngine();
  }, 1000);

  if (typeof skribblEngineTimer.unref === "function") {
    skribblEngineTimer.unref();
  }
}

module.exports = {
  buildSkribblState,
  clearSkribblCanvas,
  joinSkribblRoom,
  leaveSkribblRoom,
  startSkribblEngine,
  submitSkribblGuess,
  submitSkribblStroke,
};
