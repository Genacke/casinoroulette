const crypto = require("crypto");
const { config } = require("./config");
const { all, get, run, withTransaction } = require("./db");

const TABLE_PRESETS = [
  {
    slug: "grande-table-10m",
    name: "Table d'Amakna",
    vibe: "Table centrale",
    description: "La table la plus accessible pour lancer des mains sans attendre.",
    accent: "gold",
  },
  {
    slug: "table-bonta-10m",
    name: "Table de Bonta",
    vibe: "Salon clair",
    description: "Une ambiance plus propre, ideale pour les joueurs serres et methodiques.",
    accent: "ivory",
  },
  {
    slug: "table-brakmar-10m",
    name: "Table de Brakmar",
    vibe: "Tapis sombre",
    description: "Une table plus nerveuse, pensee pour ceux qui aiment faire gonfler les pots.",
    accent: "crimson",
  },
];
const DEFAULT_TABLE_SLUG = TABLE_PRESETS[0].slug;
const HAND_LABELS = [
  "Carte haute",
  "Une paire",
  "Deux paires",
  "Brelan",
  "Suite",
  "Couleur",
  "Full",
  "Carre",
  "Quinte flush",
];
const RANK_ORDER = "23456789TJQKA";
const SUITS = ["S", "H", "D", "C"];

let pokerEngineStarted = false;
let pokerEngineBusy = false;
let pokerEngineTimer = null;

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

function parseCards(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function stringifyCards(cards) {
  return JSON.stringify(cards || []);
}

function mapTableRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    buyIn: Number(row.buy_in),
    smallBlind: Number(row.small_blind),
    bigBlind: Number(row.big_blind),
    minPlayers: Number(row.min_players),
    maxPlayers: Number(row.max_players),
    status: row.status,
    phase: row.phase,
    handNumber: Number(row.hand_number || 0),
    pot: Number(row.pot || 0),
    currentBet: Number(row.current_bet || 0),
    minRaise: Number(row.min_raise || 0),
    dealerSeat: Number(row.dealer_seat || 0),
    activeSeat: Number(row.active_seat || 0),
    visibleBoardCount: Number(row.visible_board_count || 0),
    boardCards: parseCards(row.board_cards),
    winnerSummary: row.winner_summary || "",
    actionDeadline: row.action_deadline || null,
    nextHandAt: row.next_hand_at || null,
    updatedAt: row.updated_at,
  };
}

function mapSeatRow(row) {
  return {
    id: Number(row.id),
    tableId: Number(row.table_id),
    userId: Number(row.user_id),
    username: row.username,
    seatNo: Number(row.seat_no),
    stack: Number(row.stack || 0),
    seatState: row.seat_state,
    roundBet: Number(row.round_bet || 0),
    handContribution: Number(row.hand_contribution || 0),
    actedThisRound: Boolean(row.acted_this_round),
    holeCards: parseCards(row.hole_cards),
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  };
}

function getTablePreset(slug) {
  return TABLE_PRESETS.find((entry) => entry.slug === slug) || TABLE_PRESETS[0];
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANK_ORDER) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(0, index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function cardRank(card) {
  return RANK_ORDER.indexOf(card[0]) + 2;
}

function cardSuit(card) {
  return card[1];
}

function compareScore(left, right) {
  if (left.category !== right.category) {
    return left.category - right.category;
  }

  const maxLength = Math.max(left.values.length, right.values.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left.values[index] || 0;
    const rightValue = right.values[index] || 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function detectStraightHigh(ranks) {
  const uniqueRanks = [...new Set(ranks)].sort((left, right) => right - left);
  if (uniqueRanks.includes(14)) {
    uniqueRanks.push(1);
  }

  let streak = 1;
  for (let index = 1; index < uniqueRanks.length; index += 1) {
    if (uniqueRanks[index - 1] - 1 === uniqueRanks[index]) {
      streak += 1;
      if (streak >= 5) {
        return uniqueRanks[index - 4];
      }
    } else {
      streak = 1;
    }
  }

  return 0;
}

function evaluateFiveCardHand(cards) {
  const ranks = cards.map(cardRank).sort((left, right) => right - left);
  const suits = cards.map(cardSuit);
  const flush = suits.every((suit) => suit === suits[0]);
  const straightHigh = detectStraightHigh(ranks);
  const counts = new Map();

  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) || 0) + 1);
  }

  const grouped = [...counts.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return right[1] - left[1];
    }

    return right[0] - left[0];
  });

  if (flush && straightHigh) {
    return {
      category: 8,
      values: [straightHigh],
      label: HAND_LABELS[8],
      cards,
    };
  }

  if (grouped[0][1] === 4) {
    return {
      category: 7,
      values: [grouped[0][0], grouped[1][0]],
      label: HAND_LABELS[7],
      cards,
    };
  }

  if (grouped[0][1] === 3 && grouped[1][1] === 2) {
    return {
      category: 6,
      values: [grouped[0][0], grouped[1][0]],
      label: HAND_LABELS[6],
      cards,
    };
  }

  if (flush) {
    return {
      category: 5,
      values: ranks,
      label: HAND_LABELS[5],
      cards,
    };
  }

  if (straightHigh) {
    return {
      category: 4,
      values: [straightHigh],
      label: HAND_LABELS[4],
      cards,
    };
  }

  if (grouped[0][1] === 3) {
    const kickers = grouped.slice(1).map((entry) => entry[0]).sort((left, right) => right - left);
    return {
      category: 3,
      values: [grouped[0][0], ...kickers],
      label: HAND_LABELS[3],
      cards,
    };
  }

  if (grouped[0][1] === 2 && grouped[1][1] === 2) {
    const pairs = [grouped[0][0], grouped[1][0]].sort((left, right) => right - left);
    const kicker = grouped.find((entry) => entry[1] === 1)?.[0] || 0;
    return {
      category: 2,
      values: [...pairs, kicker],
      label: HAND_LABELS[2],
      cards,
    };
  }

  if (grouped[0][1] === 2) {
    const kickers = grouped.slice(1).map((entry) => entry[0]).sort((left, right) => right - left);
    return {
      category: 1,
      values: [grouped[0][0], ...kickers],
      label: HAND_LABELS[1],
      cards,
    };
  }

  return {
    category: 0,
    values: ranks,
    label: HAND_LABELS[0],
    cards,
  };
}

function evaluateSevenCardHand(cards) {
  let best = null;

  for (let first = 0; first < cards.length - 4; first += 1) {
    for (let second = first + 1; second < cards.length - 3; second += 1) {
      for (let third = second + 1; third < cards.length - 2; third += 1) {
        for (let fourth = third + 1; fourth < cards.length - 1; fourth += 1) {
          for (let fifth = fourth + 1; fifth < cards.length; fifth += 1) {
            const candidate = evaluateFiveCardHand([
              cards[first],
              cards[second],
              cards[third],
              cards[fourth],
              cards[fifth],
            ]);

            if (!best || compareScore(candidate, best) > 0) {
              best = candidate;
            }
          }
        }
      }
    }
  }

  return best || evaluateFiveCardHand(cards.slice(0, 5));
}

function nextSeatNumber(orderedSeatNumbers, currentSeat) {
  if (!orderedSeatNumbers.length) {
    return 0;
  }

  for (const seatNumber of orderedSeatNumbers) {
    if (seatNumber > currentSeat) {
      return seatNumber;
    }
  }

  return orderedSeatNumbers[0];
}

function activeSeatNumbers(seats) {
  return seats
    .filter((seat) => seat.seatState === "active")
    .map((seat) => seat.seatNo)
    .sort((left, right) => left - right);
}

function eligibleSeatNumbers(seats) {
  return seats
    .filter((seat) => seat.stack > 0)
    .map((seat) => seat.seatNo)
    .sort((left, right) => left - right);
}

function firstActiveSeatAfter(seats, fromSeat) {
  return nextSeatNumber(activeSeatNumbers(seats), fromSeat);
}

function getBlindSeats(eligibleSeats, dealerSeat) {
  if (!eligibleSeats.length) {
    return {
      dealerSeat: 0,
      smallBlindSeat: 0,
      bigBlindSeat: 0,
    };
  }

  const normalizedDealerSeat = dealerSeat || eligibleSeats[0];
  if (eligibleSeats.length === 1) {
    return {
      dealerSeat: normalizedDealerSeat,
      smallBlindSeat: normalizedDealerSeat,
      bigBlindSeat: normalizedDealerSeat,
    };
  }

  if (eligibleSeats.length === 2) {
    return {
      dealerSeat: normalizedDealerSeat,
      smallBlindSeat: normalizedDealerSeat,
      bigBlindSeat: nextSeatNumber(eligibleSeats, normalizedDealerSeat),
    };
  }

  const smallBlindSeat = nextSeatNumber(eligibleSeats, normalizedDealerSeat);
  return {
    dealerSeat: normalizedDealerSeat,
    smallBlindSeat,
    bigBlindSeat: nextSeatNumber(eligibleSeats, smallBlindSeat),
  };
}

function playersStillInHand(seats) {
  return seats.filter((seat) => ["active", "all_in"].includes(seat.seatState));
}

function isSeatInCurrentHand(seat) {
  return (
    ["active", "folded", "all_in"].includes(seat.seatState) ||
    seat.handContribution > 0 ||
    seat.holeCards.length > 0
  );
}

function isBettingRoundComplete(table, seats) {
  const contenders = playersStillInHand(seats);
  if (contenders.length <= 1) {
    return true;
  }

  const activeSeats = contenders.filter((seat) => seat.seatState === "active");
  if (!activeSeats.length) {
    return true;
  }

  return activeSeats.every(
    (seat) => seat.actedThisRound && seat.roundBet === table.currentBet,
  );
}

async function ensurePokerTable(preset) {
  await run(
    `
      INSERT INTO poker_tables (
        slug,
        name,
        buy_in,
        small_blind,
        big_blind,
        min_players,
        max_players,
        min_raise,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        buy_in = excluded.buy_in,
        small_blind = excluded.small_blind,
        big_blind = excluded.big_blind,
        min_players = excluded.min_players,
        max_players = excluded.max_players,
        min_raise = CASE
          WHEN poker_tables.status = 'waiting' THEN excluded.min_raise
          ELSE poker_tables.min_raise
        END,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      preset.slug,
      preset.name,
      config.pokerTableBuyIn,
      config.pokerSmallBlind,
      config.pokerBigBlind,
      config.pokerMinPlayers,
      config.pokerMaxPlayers,
      config.pokerBigBlind,
    ],
  );

  return getPokerTableRow(preset.slug);
}

async function ensurePokerTables() {
  const tables = [];
  for (const preset of TABLE_PRESETS) {
    tables.push(await ensurePokerTable(preset));
  }
  return tables;
}

async function getPokerTableRow(identifier = DEFAULT_TABLE_SLUG) {
  const resolvedIdentifier =
    identifier === null || identifier === undefined || identifier === ""
      ? DEFAULT_TABLE_SLUG
      : identifier;
  const whereClause = Number.isInteger(resolvedIdentifier) ? "id = ?" : "slug = ?";
  return mapTableRow(
    await get(
      `
        SELECT *
        FROM poker_tables
        WHERE ${whereClause}
      `,
      [resolvedIdentifier],
    ),
  );
}

async function getPokerTableRows() {
  const placeholders = TABLE_PRESETS.map(() => "?").join(", ");
  const rows = await all(
    `
      SELECT *
      FROM poker_tables
      WHERE slug IN (${placeholders})
      ORDER BY id ASC
    `,
    TABLE_PRESETS.map((entry) => entry.slug),
  );

  return rows.map(mapTableRow);
}

async function getPokerSeats(tableId) {
  const rows = await all(
    `
      SELECT
        poker_seats.*,
        users.username AS username
      FROM poker_seats
      INNER JOIN users ON users.id = poker_seats.user_id
      WHERE poker_seats.table_id = ?
      ORDER BY poker_seats.seat_no ASC
    `,
    [tableId],
  );

  return rows.map(mapSeatRow);
}

async function getPokerLog(tableId, limit = 18) {
  return all(
    `
      SELECT *
      FROM (
        SELECT
          id,
          hand_number AS handNumber,
          username_snapshot AS username,
          action_type AS actionType,
          amount,
          details,
          created_at AS createdAt
        FROM poker_action_logs
        WHERE table_id = ?
        ORDER BY id DESC
        LIMIT ?
      )
      ORDER BY id ASC
    `,
    [tableId, limit],
  );
}

async function loadTableBundle(identifier = DEFAULT_TABLE_SLUG) {
  const resolvedIdentifier =
    identifier === null || identifier === undefined || identifier === ""
      ? DEFAULT_TABLE_SLUG
      : identifier;
  const table =
    resolvedIdentifier &&
    typeof resolvedIdentifier === "object" &&
    Number.isInteger(resolvedIdentifier.id)
      ? resolvedIdentifier
      : await getPokerTableRow(resolvedIdentifier);

  if (!table) {
    return {
      table: null,
      seats: [],
    };
  }

  return {
    table,
    seats: await getPokerSeats(table.id),
  };
}

function formatKamasValue(value) {
  return `${Number(value || 0).toLocaleString("fr-FR")} kamas`;
}

async function logPokerAction(table, username, actionType, amount = 0, details = "", userId = null) {
  await run(
    `
      INSERT INTO poker_action_logs (
        table_id,
        hand_number,
        user_id,
        username_snapshot,
        action_type,
        amount,
        details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      table.id,
      table.handNumber,
      userId,
      username,
      actionType,
      amount,
      details || null,
    ],
  );
}

async function persistSeat(seat) {
  await run(
    `
      UPDATE poker_seats
      SET stack = ?,
          seat_state = ?,
          round_bet = ?,
          hand_contribution = ?,
          acted_this_round = ?,
          hole_cards = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      seat.stack,
      seat.seatState,
      seat.roundBet,
      seat.handContribution,
      seat.actedThisRound ? 1 : 0,
      stringifyCards(seat.holeCards),
      seat.id,
    ],
  );
}

async function persistSeats(seats) {
  for (const seat of seats) {
    await persistSeat(seat);
  }
}

async function updateWaitingTable(table, summary = "En attente de joueurs.") {
  await run(
    `
      UPDATE poker_tables
      SET status = 'waiting',
          phase = 'waiting',
          pot = 0,
          current_bet = 0,
          min_raise = ?,
          active_seat = 0,
          visible_board_count = 0,
          board_cards = '[]',
          winner_summary = ?,
          action_deadline = NULL,
          next_hand_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [table.bigBlind, summary, table.id],
  );

  await run(
    `
      UPDATE poker_seats
      SET seat_state = CASE
            WHEN stack > 0 THEN 'seated'
            ELSE 'busted'
          END,
          round_bet = 0,
          hand_contribution = 0,
          acted_this_round = 0,
          hole_cards = '[]',
          updated_at = CURRENT_TIMESTAMP
      WHERE table_id = ?
    `,
    [table.id],
  );
}

async function cleanupBustedSeats(tableId) {
  const bustedSeats = await all(
    `
      SELECT user_id AS userId
      FROM poker_seats
      WHERE table_id = ?
        AND stack <= 0
    `,
    [tableId],
  );

  if (!bustedSeats.length) {
    return;
  }

  await run(
    `
      DELETE FROM poker_seats
      WHERE table_id = ?
        AND stack <= 0
    `,
    [tableId],
  );

  for (const seat of bustedSeats) {
    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'warning', ?)
      `,
      [seat.userId, "Tu n'as plus de jetons sur la table poker. Reviens avec une nouvelle cave."],
    );
  }
}

function dealCardsToSeats(seats) {
  const deck = shuffleDeck(createDeck());
  const seatCards = new Map(seats.map((seat) => [seat.seatNo, []]));

  for (let round = 0; round < 2; round += 1) {
    for (const seat of seats) {
      seatCards.get(seat.seatNo).push(deck.pop());
    }
  }

  return {
    seatCards,
    boardCards: [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()],
  };
}

function applyBlind(seat, blindAmount) {
  const postedAmount = Math.min(seat.stack, blindAmount);
  seat.stack -= postedAmount;
  seat.roundBet += postedAmount;
  seat.handContribution += postedAmount;
  seat.actedThisRound = false;
  seat.seatState = seat.stack > 0 ? "active" : "all_in";
  return postedAmount;
}

async function startNewHand(table, seats) {
  const eligibleSeats = seats.filter((seat) => seat.stack > 0).sort((left, right) => left.seatNo - right.seatNo);

  if (eligibleSeats.length < table.minPlayers) {
    await updateWaitingTable(
      table,
      eligibleSeats.length
        ? `Encore ${table.minPlayers - eligibleSeats.length} joueur(s) pour lancer une main.`
        : "La table attend des aventuriers.",
    );
    return loadTableBundle(table.id);
  }

  const orderedSeatNumbers = eligibleSeats.map((seat) => seat.seatNo);
  const dealerSeat = nextSeatNumber(orderedSeatNumbers, table.dealerSeat || orderedSeatNumbers[orderedSeatNumbers.length - 1]);
  const blindSeats = getBlindSeats(orderedSeatNumbers, dealerSeat);
  const { seatCards, boardCards } = dealCardsToSeats(eligibleSeats);
  const seatByNumber = new Map(eligibleSeats.map((seat) => [seat.seatNo, seat]));

  for (const seat of seats) {
    if (seat.stack > 0) {
      seat.seatState = "active";
      seat.roundBet = 0;
      seat.handContribution = 0;
      seat.actedThisRound = false;
      seat.holeCards = seatCards.get(seat.seatNo) || [];
    } else {
      seat.seatState = "busted";
      seat.roundBet = 0;
      seat.handContribution = 0;
      seat.actedThisRound = false;
      seat.holeCards = [];
    }
  }

  const smallBlindSeat = seatByNumber.get(blindSeats.smallBlindSeat);
  const bigBlindSeat = seatByNumber.get(blindSeats.bigBlindSeat);
  const smallBlindPosted = smallBlindSeat ? applyBlind(smallBlindSeat, table.smallBlind) : 0;
  const bigBlindPosted = bigBlindSeat ? applyBlind(bigBlindSeat, table.bigBlind) : 0;
  const pot = seats.reduce((sum, seat) => sum + seat.handContribution, 0);
  const currentBet = Math.max(smallBlindPosted, bigBlindPosted);
  const firstToAct = firstActiveSeatAfter(seats, blindSeats.bigBlindSeat);
  const handNumber = table.handNumber + 1;

  await persistSeats(seats);

  await run(
    `
      UPDATE poker_tables
      SET status = 'playing',
          phase = 'preflop',
          hand_number = ?,
          pot = ?,
          current_bet = ?,
          min_raise = ?,
          dealer_seat = ?,
          active_seat = ?,
          visible_board_count = 0,
          board_cards = ?,
          winner_summary = NULL,
          action_deadline = ?,
          next_hand_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      handNumber,
      pot,
      currentBet,
      table.bigBlind,
      blindSeats.dealerSeat,
      firstToAct,
      stringifyCards(boardCards),
      firstToAct ? inSeconds(config.pokerTurnSeconds) : null,
      table.id,
    ],
  );

  const updatedTable = {
    ...table,
    status: "playing",
    phase: "preflop",
    handNumber,
    pot,
    currentBet,
    minRaise: table.bigBlind,
    dealerSeat: blindSeats.dealerSeat,
    activeSeat: firstToAct,
    visibleBoardCount: 0,
    boardCards,
  };

  await logPokerAction(updatedTable, "Table", "hand_start", 0, `Main #${handNumber} lancee.`);
  if (smallBlindSeat && smallBlindPosted > 0) {
    await logPokerAction(updatedTable, smallBlindSeat.username, "small_blind", smallBlindPosted, "", smallBlindSeat.userId);
  }
  if (bigBlindSeat && bigBlindPosted > 0) {
    await logPokerAction(updatedTable, bigBlindSeat.username, "big_blind", bigBlindPosted, "", bigBlindSeat.userId);
  }

  return loadTableBundle(table.id);
}

function currentBoard(table) {
  return (table.boardCards || []).slice(0, table.visibleBoardCount);
}

async function settleSingleWinner(table, seats, winner, reason) {
  const totalPot = seats.reduce((sum, seat) => sum + seat.handContribution, 0);
  winner.stack += totalPot;

  for (const seat of seats) {
    seat.roundBet = 0;
    seat.actedThisRound = seat.seatState !== "active";
  }

  await persistSeats(seats);

  const summary = `${winner.username} remporte ${formatKamasValue(totalPot)}${reason ? ` ${reason}` : ""}.`;

  await run(
    `
      UPDATE poker_tables
      SET status = 'showdown',
          phase = 'showdown',
          pot = ?,
          current_bet = 0,
          active_seat = 0,
          visible_board_count = ?,
          winner_summary = ?,
          action_deadline = NULL,
          next_hand_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      totalPot,
      table.visibleBoardCount,
      summary,
      inSeconds(config.pokerShowdownSeconds),
      table.id,
    ],
  );

  const updatedTable = {
    ...table,
    status: "showdown",
    phase: "showdown",
    pot: totalPot,
    currentBet: 0,
    activeSeat: 0,
    winnerSummary: summary,
    nextHandAt: inSeconds(config.pokerShowdownSeconds),
  };

  await logPokerAction(updatedTable, winner.username, "pot_win", totalPot, summary, winner.userId);
  await run(
    `
      INSERT INTO notifications (user_id, type, message)
      VALUES (?, 'success', ?)
    `,
    [winner.userId, summary],
  );

  return loadTableBundle(table.id);
}

function buildSidePots(seats) {
  const remaining = new Map(
    seats
      .filter((seat) => seat.handContribution > 0)
      .map((seat) => [seat.seatNo, seat.handContribution]),
  );
  const sidePots = [];

  while ([...remaining.values()].some((value) => value > 0)) {
    const activeEntries = [...remaining.entries()].filter((entry) => entry[1] > 0);
    const level = Math.min(...activeEntries.map((entry) => entry[1]));
    const participantSeats = activeEntries.map((entry) => entry[0]);

    sidePots.push({
      amount: level * participantSeats.length,
      participantSeats,
    });

    for (const [seatNo, amount] of activeEntries) {
      remaining.set(seatNo, amount - level);
    }
  }

  return sidePots;
}

async function settleShowdown(table, seats) {
  const contenders = seats.filter(
    (seat) => seat.seatState !== "folded" && seat.handContribution > 0,
  );

  if (!contenders.length) {
    await updateWaitingTable(table, "Main annulee.");
    return loadTableBundle(table.id);
  }

  const fullBoard = table.boardCards.slice(0, 5);
  const evaluations = new Map();
  for (const seat of contenders) {
    evaluations.set(
      seat.seatNo,
      evaluateSevenCardHand([...seat.holeCards, ...fullBoard]),
    );
  }

  const sidePots = buildSidePots(seats);
  const payouts = new Map(seats.map((seat) => [seat.seatNo, 0]));

  for (const sidePot of sidePots) {
    const eligibleWinners = sidePot.participantSeats
      .map((seatNo) => contenders.find((seat) => seat.seatNo === seatNo))
      .filter(Boolean);

    if (!eligibleWinners.length) {
      continue;
    }

    let winners = [eligibleWinners[0]];
    for (let index = 1; index < eligibleWinners.length; index += 1) {
      const candidate = eligibleWinners[index];
      const comparison = compareScore(
        evaluations.get(candidate.seatNo),
        evaluations.get(winners[0].seatNo),
      );

      if (comparison > 0) {
        winners = [candidate];
      } else if (comparison === 0) {
        winners.push(candidate);
      }
    }

    const splitAmount = Math.floor(sidePot.amount / winners.length);
    let remainder = sidePot.amount - splitAmount * winners.length;

    winners
      .sort((left, right) => left.seatNo - right.seatNo)
      .forEach((winner) => {
        const bonusChip = remainder > 0 ? 1 : 0;
        remainder = Math.max(0, remainder - 1);
        payouts.set(
          winner.seatNo,
          payouts.get(winner.seatNo) + splitAmount + bonusChip,
        );
      });
  }

  const winnerLines = [];
  for (const seat of seats) {
    const payout = payouts.get(seat.seatNo) || 0;
    if (payout > 0) {
      seat.stack += payout;
      const handLabel = evaluations.get(seat.seatNo)?.label || "main";
      winnerLines.push(`${seat.username} ${formatKamasValue(payout)} (${handLabel})`);
      await logPokerAction(
        table,
        seat.username,
        "showdown_win",
        payout,
        handLabel,
        seat.userId,
      );
      await run(
        `
          INSERT INTO notifications (user_id, type, message)
          VALUES (?, 'success', ?)
        `,
        [seat.userId, `Showdown gagne: ${formatKamasValue(payout)} avec ${handLabel}.`],
      );
    }

    seat.roundBet = 0;
    seat.actedThisRound = seat.seatState !== "active";
  }

  await persistSeats(seats);

  const winnerSummary = winnerLines.length
    ? `Showdown: ${winnerLines.join(" | ")}`
    : "Showdown sans gagnant.";

  await run(
    `
      UPDATE poker_tables
      SET status = 'showdown',
          phase = 'showdown',
          pot = ?,
          current_bet = 0,
          active_seat = 0,
          visible_board_count = 5,
          winner_summary = ?,
          action_deadline = NULL,
          next_hand_at = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      seats.reduce((sum, seat) => sum + seat.handContribution, 0),
      winnerSummary,
      inSeconds(config.pokerShowdownSeconds),
      table.id,
    ],
  );

  await logPokerAction(
    {
      ...table,
      phase: "showdown",
      status: "showdown",
    },
    "Table",
    "showdown",
    0,
    winnerSummary,
  );

  return loadTableBundle(table.id);
}

async function advanceStreetOrShowdown(table, seats) {
  const contenders = playersStillInHand(seats);
  if (contenders.length <= 1) {
    return settleSingleWinner(table, seats, contenders[0], "sans opposition");
  }

  const phaseVisibility = {
    preflop: 3,
    flop: 4,
    turn: 5,
  };
  const nextPhaseByPhase = {
    preflop: "flop",
    flop: "turn",
    turn: "river",
    river: "showdown",
  };
  const nextPhase = nextPhaseByPhase[table.phase] || "showdown";

  if (nextPhase === "showdown") {
    return settleShowdown(
      {
        ...table,
        visibleBoardCount: 5,
      },
      seats,
    );
  }

  for (const seat of seats) {
    seat.roundBet = 0;
    seat.actedThisRound = seat.seatState !== "active";
  }

  const firstToAct = firstActiveSeatAfter(seats, table.dealerSeat);
  if (!firstToAct) {
    return settleShowdown(
      {
        ...table,
        visibleBoardCount: 5,
      },
      seats,
    );
  }

  await persistSeats(seats);

  await run(
    `
      UPDATE poker_tables
      SET phase = ?,
          current_bet = 0,
          min_raise = ?,
          active_seat = ?,
          visible_board_count = ?,
          action_deadline = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      nextPhase,
      table.bigBlind,
      firstToAct,
      phaseVisibility[nextPhase] || 5,
      inSeconds(config.pokerTurnSeconds),
      table.id,
    ],
  );

  await logPokerAction(
    {
      ...table,
      phase: nextPhase,
    },
    "Table",
    "street",
    0,
    nextPhase,
  );

  return loadTableBundle(table.id);
}

async function continueHand(table, seats, actingSeatNo) {
  const contenders = playersStillInHand(seats);
  if (contenders.length <= 1) {
    return settleSingleWinner(table, seats, contenders[0], "apres abandon");
  }

  if (isBettingRoundComplete(table, seats)) {
    return advanceStreetOrShowdown(table, seats);
  }

  const nextActiveSeat = firstActiveSeatAfter(seats, actingSeatNo);
  await persistSeats(seats);
  await run(
    `
      UPDATE poker_tables
      SET pot = ?,
          current_bet = ?,
          min_raise = ?,
          active_seat = ?,
          action_deadline = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [
      seats.reduce((sum, seat) => sum + seat.handContribution, 0),
      table.currentBet,
      table.minRaise,
      nextActiveSeat,
      nextActiveSeat ? inSeconds(config.pokerTurnSeconds) : null,
      table.id,
    ],
  );

  return loadTableBundle(table.id);
}

async function applyLoadedPlayerAction(table, seats, seat, requestedAction, rawAmount, options = {}) {
  const action = String(requestedAction || "").trim().toLowerCase();
  const callAmount = Math.max(0, table.currentBet - seat.roundBet);
  const maxRaiseTo = seat.roundBet + seat.stack;

  if (action === "fold") {
    seat.seatState = "folded";
    seat.actedThisRound = true;
    await logPokerAction(
      table,
      seat.username,
      options.auto ? "auto_fold" : "fold",
      0,
      "",
      seat.userId,
    );
    return continueHand(table, seats, seat.seatNo);
  }

  if (action === "check") {
    if (callAmount !== 0) {
      throw new Error("Impossible de checker tant qu'il reste une mise a suivre.");
    }

    seat.actedThisRound = true;
    await logPokerAction(
      table,
      seat.username,
      options.auto ? "auto_check" : "check",
      0,
      "",
      seat.userId,
    );
    return continueHand(table, seats, seat.seatNo);
  }

  if (action === "call") {
    if (callAmount <= 0) {
      throw new Error("Rien a suivre sur cette action.");
    }

    const paidAmount = Math.min(callAmount, seat.stack);
    seat.stack -= paidAmount;
    seat.roundBet += paidAmount;
    seat.handContribution += paidAmount;
    seat.actedThisRound = true;
    seat.seatState = seat.stack > 0 ? "active" : "all_in";
    await logPokerAction(table, seat.username, "call", paidAmount, "", seat.userId);
    return continueHand(
      {
        ...table,
        pot: seats.reduce((sum, entry) => sum + entry.handContribution, 0),
      },
      seats,
      seat.seatNo,
    );
  }

  if (action !== "raise") {
    throw new Error("Action poker invalide.");
  }

  const raiseTo = Number.parseInt(rawAmount, 10);
  if (!Number.isSafeInteger(raiseTo) || raiseTo <= table.currentBet) {
    throw new Error("Montant de relance invalide.");
  }

  const minimumRaiseTo =
    table.currentBet === 0
      ? table.bigBlind
      : table.currentBet + Math.max(table.minRaise || table.bigBlind, table.bigBlind);

  if (raiseTo < minimumRaiseTo) {
    throw new Error(
      `La relance minimale est a ${minimumRaiseTo.toLocaleString("fr-FR")} kamas.`,
    );
  }

  if (raiseTo > maxRaiseTo) {
    throw new Error("Tu n'as pas assez de jetons pour cette relance.");
  }

  const addedAmount = raiseTo - seat.roundBet;
  seat.stack -= addedAmount;
  seat.roundBet = raiseTo;
  seat.handContribution += addedAmount;
  seat.actedThisRound = true;
  seat.seatState = seat.stack > 0 ? "active" : "all_in";

  const previousBet = table.currentBet;
  table.currentBet = raiseTo;
  table.minRaise = raiseTo - previousBet;
  table.pot = seats.reduce((sum, entry) => sum + entry.handContribution, 0);

  for (const otherSeat of seats) {
    if (otherSeat.id !== seat.id && otherSeat.seatState === "active") {
      otherSeat.actedThisRound = false;
    }
  }

  await logPokerAction(
    table,
    seat.username,
    "raise",
    addedAmount,
    `a ${formatKamasValue(raiseTo)}`,
    seat.userId,
  );
  return continueHand(table, seats, seat.seatNo);
}

async function processPlayerAction(userId, tableSlug, requestedAction, rawAmount, options = {}) {
  return withTransaction(async () => {
    const { table, seats } = await loadTableBundle(tableSlug);

    if (!table) {
      throw new Error("Table poker introuvable.");
    }

    const seat = seats.find((entry) => entry.userId === userId);

    if (!seat) {
      throw new Error("Tu n'es pas assis a la table poker.");
    }

    if (table.status !== "playing") {
      throw new Error("Aucune main poker n'est en cours.");
    }

    if (seat.seatNo !== table.activeSeat || seat.seatState !== "active") {
      throw new Error("Ce n'est pas ton tour.");
    }

    return applyLoadedPlayerAction(table, seats, seat, requestedAction, rawAmount, options);
  });
}

async function handleTimedOutTurn(tableReference) {
  return withTransaction(async () => {
    const { table, seats } = await loadTableBundle(tableReference);

    if (!table || table.status !== "playing" || !table.activeSeat) {
      return null;
    }

    if (fromSqlTimestamp(table.actionDeadline) > Date.now()) {
      return null;
    }

    const seat = seats.find((entry) => entry.seatNo === table.activeSeat);
    if (!seat || seat.seatState !== "active") {
      return continueHand(table, seats, table.activeSeat);
    }

    const callAmount = Math.max(0, table.currentBet - seat.roundBet);
    return applyLoadedPlayerAction(
      table,
      seats,
      seat,
      callAmount === 0 ? "check" : "fold",
      null,
      { auto: true },
    );
  });
}

async function maybeAdvanceWaitingTable(tableReference) {
  return withTransaction(async () => {
    const table = await getPokerTableRow(
      tableReference && typeof tableReference === "object" ? tableReference.id : tableReference,
    );

    if (!table || table.status === "playing") {
      return null;
    }

    await cleanupBustedSeats(table.id);
    const freshTable = await getPokerTableRow(table.id);
    const seats = await getPokerSeats(freshTable.id);

    if (freshTable.status === "showdown") {
      const nextHandAtMs = fromSqlTimestamp(freshTable.nextHandAt);
      if (nextHandAtMs && nextHandAtMs > Date.now()) {
        return null;
      }
    }

    return startNewHand(freshTable, seats);
  });
}

async function syncPokerTable(tableReference) {
  const table = await getPokerTableRow(
    tableReference && typeof tableReference === "object" ? tableReference.id : tableReference,
  );

  if (!table) {
    return;
  }

  if (table.status === "playing") {
    if (!table.activeSeat) {
      await withTransaction(async () => {
        const bundle = await loadTableBundle(table.id);
        await advanceStreetOrShowdown(bundle.table, bundle.seats);
      });
      return;
    }

    const deadlineMs = fromSqlTimestamp(table.actionDeadline);
    if (deadlineMs && deadlineMs <= Date.now()) {
      await handleTimedOutTurn(table.id);
    }
    return;
  }

  await maybeAdvanceWaitingTable(table.id);
}

async function syncPokerTables() {
  const tables = await ensurePokerTables();
  for (const table of tables) {
    await syncPokerTable(table.id);
  }
}

function describePhase(phase) {
  if (phase === "preflop") {
    return "Pre-flop";
  }

  if (phase === "flop") {
    return "Flop";
  }

  if (phase === "turn") {
    return "Turn";
  }

  if (phase === "river") {
    return "River";
  }

  if (phase === "showdown") {
    return "Showdown";
  }

  return "En attente";
}

function cardLabel(card) {
  const rank = card[0];
  const suit = card[1];
  const rankMap = {
    T: "10",
    J: "V",
    Q: "D",
    K: "R",
    A: "A",
  };
  const suitMap = {
    S: { symbol: "♠", color: "black" },
    C: { symbol: "♣", color: "black" },
    H: { symbol: "♥", color: "red" },
    D: { symbol: "♦", color: "red" },
  };
  const suitInfo = suitMap[suit] || { symbol: suit, color: "black" };

  return {
    code: card,
    rank,
    label: `${rankMap[rank] || rank}${suitInfo.symbol}`,
    suit,
    color: suitInfo.color,
  };
}

function buildJoinLeaveState(table, seats, userId, playerBalance) {
  const meSeat = seats.find((seat) => seat.userId === userId) || null;
  const eligibleSeats = eligibleSeatNumbers(seats);
  const seatsTaken = seats.filter((seat) => seat.stack > 0).length;
  const isTableFull = seatsTaken >= table.maxPlayers;
  const meParticipating = meSeat ? isSeatInCurrentHand(meSeat) : false;
  let canJoin = false;
  let joinLabel = "Rejoindre";
  let joinReason = "";

  if (meSeat) {
    joinLabel = "Deja assis";
    joinReason = meParticipating
      ? "Tu es deja engage dans cette table."
      : "Ta place est deja reservee pour la prochaine main.";
  } else if (isTableFull) {
    joinLabel = "Table complete";
    joinReason = "La table est complete pour le moment.";
  } else if (playerBalance < table.buyIn) {
    joinLabel = "Cave requise";
    joinReason = `Cave requise: ${formatKamasValue(table.buyIn)}.`;
  } else {
    canJoin = true;
    joinLabel = table.status === "playing" ? "S'asseoir" : "Rejoindre";
    joinReason =
      table.status === "playing"
        ? "Ta place sera reservee pour la prochaine main."
        : "Tu peux prendre place immediatement.";
  }

  const canLeave = Boolean(meSeat) && (table.status !== "playing" || !meParticipating);
  const leaveReason = !meSeat
    ? "Tu n'es pas assis a cette table."
    : canLeave
      ? "Tu peux recuperer ta cave maintenant."
      : "Attends la fin de la main pour quitter.";

  return {
    meSeat,
    eligibleSeats,
    seatsTaken,
    meParticipating,
    canJoin,
    joinLabel,
    joinReason,
    canLeave,
    leaveReason,
  };
}

function buildLobbyEntry(table, seats, userId, playerBalance, selectedTableSlug) {
  const preset = getTablePreset(table.slug);
  const joinState = buildJoinLeaveState(table, seats, userId, playerBalance);
  const playersSeated = joinState.eligibleSeats.length;
  const playersNeeded = Math.max(0, table.minPlayers - playersSeated);
  const secondsToNextHand = secondsUntil(table.nextHandAt);

  return {
    slug: table.slug,
    name: table.name,
    vibe: preset.vibe,
    description: preset.description,
    accent: preset.accent,
    buyIn: table.buyIn,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    minPlayers: table.minPlayers,
    maxPlayers: table.maxPlayers,
    status: table.status,
    phase: table.phase,
    phaseLabel: describePhase(table.phase),
    handNumber: table.handNumber,
    pot: table.pot,
    playersSeated,
    playersNeeded,
    isSelected: table.slug === selectedTableSlug,
    isSeated: Boolean(joinState.meSeat),
    mySeatState: joinState.meSeat?.seatState || null,
    canJoin: joinState.canJoin,
    joinLabel: joinState.joinLabel,
    joinReason: joinState.joinReason,
    occupancyLabel: `${playersSeated}/${table.maxPlayers}`,
    statusLabel:
      table.status === "playing"
        ? `Main #${table.handNumber}`
        : table.status === "showdown"
          ? secondsToNextHand > 0
            ? `Pause ${secondsToNextHand}s`
            : "Pause"
          : playersNeeded > 0
            ? `${playersNeeded} joueur(s) manquant(s)`
            : "Depart imminent",
  };
}

function resolveSelectedTableSlug(bundles, requestedSlug, userId) {
  if (requestedSlug && bundles.some((bundle) => bundle.table.slug === requestedSlug)) {
    return requestedSlug;
  }

  const occupiedBundles = bundles.filter((bundle) =>
    bundle.seats.some((seat) => seat.userId === userId && seat.stack > 0),
  );

  if (occupiedBundles.length) {
    return (
      occupiedBundles.find((bundle) => bundle.table.status === "playing")?.table.slug ||
      occupiedBundles[0].table.slug
    );
  }

  return (
    bundles.find((bundle) => bundle.table.slug === DEFAULT_TABLE_SLUG)?.table.slug ||
    bundles[0]?.table.slug ||
    DEFAULT_TABLE_SLUG
  );
}

async function buildPokerState(userId, requestedTableSlug = null) {
  await ensurePokerTables();
  const [bundles, user] = await Promise.all([
    getPokerTableRows().then((rows) => Promise.all(rows.map((row) => loadTableBundle(row)))),
    get("SELECT balance FROM users WHERE id = ?", [userId]),
  ]);

  const selectedTableSlug = resolveSelectedTableSlug(bundles, requestedTableSlug, userId);
  const selectedBundle = bundles.find((bundle) => bundle.table.slug === selectedTableSlug) || bundles[0];

  if (!selectedBundle?.table) {
    return null;
  }

  const { table, seats } = selectedBundle;
  const actionLog = await getPokerLog(table.id);
  const playerBalance = Number(user?.balance || 0);
  const joinState = buildJoinLeaveState(table, seats, userId, playerBalance);
  const blindSeats =
    table.phase === "waiting"
      ? getBlindSeats([], 0)
      : getBlindSeats(joinState.eligibleSeats, table.dealerSeat);
  const callAmount = joinState.meSeat ? Math.max(0, table.currentBet - joinState.meSeat.roundBet) : 0;
  const maxRaiseTo = joinState.meSeat ? joinState.meSeat.roundBet + joinState.meSeat.stack : 0;
  const minimumRaiseTo =
    table.currentBet === 0
      ? table.bigBlind
      : table.currentBet + Math.max(table.minRaise || table.bigBlind, table.bigBlind);
  const canAct =
    Boolean(joinState.meSeat) &&
    table.status === "playing" &&
    joinState.meSeat.seatState === "active" &&
    joinState.meSeat.seatNo === table.activeSeat;
  const visibleBoard = currentBoard(table).map(cardLabel);
  const showdownVisible = table.phase === "showdown";
  const preset = getTablePreset(table.slug);
  const lobby = bundles.map((bundle) =>
    buildLobbyEntry(bundle.table, bundle.seats, userId, playerBalance, selectedTableSlug),
  );

  return {
    tableId: table.id,
    slug: table.slug,
    name: table.name,
    tableAccent: preset.accent,
    tableVibe: preset.vibe,
    tableDescription: preset.description,
    selectedTableSlug,
    buyIn: table.buyIn,
    smallBlind: table.smallBlind,
    bigBlind: table.bigBlind,
    minPlayers: table.minPlayers,
    maxPlayers: table.maxPlayers,
    status: table.status,
    phase: table.phase,
    phaseLabel: describePhase(table.phase),
    handNumber: table.handNumber,
    pot: table.pot,
    currentBet: table.currentBet,
    minRaise: table.minRaise,
    dealerSeat: table.dealerSeat,
    activeSeat: table.activeSeat,
    playersSeated: joinState.eligibleSeats.length,
    playersNeeded: Math.max(0, table.minPlayers - joinState.eligibleSeats.length),
    boardCards: visibleBoard,
    boardCount: visibleBoard.length,
    winnerSummary: table.winnerSummary || "",
    actionDeadline: table.actionDeadline,
    nextHandAt: table.nextHandAt,
    secondsToAct: table.actionDeadline
      ? Math.max(0, Math.ceil((fromSqlTimestamp(table.actionDeadline) - Date.now()) / 1000))
      : 0,
    secondsToNextHand: table.nextHandAt
      ? Math.max(0, Math.ceil((fromSqlTimestamp(table.nextHandAt) - Date.now()) / 1000))
      : 0,
    lobby,
    seats: Array.from({ length: table.maxPlayers }, (_unused, seatIndex) => {
      const seatNumber = seatIndex + 1;
      const seat = seats.find((entry) => entry.seatNo === seatNumber);

      if (!seat) {
        return {
          seatNo: seatNumber,
          isEmpty: true,
        };
      }

      return {
        seatNo: seat.seatNo,
        userId: seat.userId,
        username: seat.username,
        stack: seat.stack,
        seatState: seat.seatState,
        roundBet: seat.roundBet,
        handContribution: seat.handContribution,
        actedThisRound: seat.actedThisRound,
        isMe: seat.userId === userId,
        isDealer: seat.seatNo === blindSeats.dealerSeat,
        isSmallBlind: seat.seatNo === blindSeats.smallBlindSeat,
        isBigBlind: seat.seatNo === blindSeats.bigBlindSeat,
        isTurn: seat.seatNo === table.activeSeat,
        cardsCount: seat.holeCards.length,
        holeCards:
          seat.userId === userId || showdownVisible
            ? seat.holeCards.map(cardLabel)
            : [],
      };
    }),
    meSeat: joinState.meSeat
      ? {
          seatNo: joinState.meSeat.seatNo,
          stack: joinState.meSeat.stack,
          seatState: joinState.meSeat.seatState,
          holeCards:
            joinState.meSeat.holeCards.map(cardLabel),
        }
      : null,
    actions: {
      canJoin: joinState.canJoin,
      joinLabel: joinState.joinLabel,
      joinReason: joinState.joinReason,
      canLeave: joinState.canLeave,
      leaveReason: joinState.leaveReason,
      canAct,
      canFold: canAct,
      canCheck: canAct && callAmount === 0,
      canCall: canAct && callAmount > 0,
      callAmount,
      canRaise:
        canAct && joinState.meSeat.stack > callAmount && maxRaiseTo >= minimumRaiseTo,
      minRaiseTo: minimumRaiseTo,
      maxRaiseTo,
    },
    actionLog,
  };
}

async function joinPokerTable(userId, tableSlug = DEFAULT_TABLE_SLUG) {
  return withTransaction(async () => {
    const { table } = await loadTableBundle(tableSlug);
    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);

    if (!table) {
      throw new Error("Table poker introuvable.");
    }

    if (!user) {
      throw new Error("Compte introuvable.");
    }

    if (Number(user.balance) < table.buyIn) {
      throw new Error(
        `Il faut ${table.buyIn.toLocaleString("fr-FR")} kamas pour rejoindre cette table.`,
      );
    }

    await cleanupBustedSeats(table.id);
    const refreshedSeats = await getPokerSeats(table.id);
    const existingSeat = refreshedSeats.find((seat) => seat.userId === userId) || null;
    const occupiedSeatNumbers = refreshedSeats
      .filter((seat) => seat.stack > 0)
      .map((seat) => seat.seatNo);

    if (existingSeat && existingSeat.stack > 0) {
      throw new Error("Tu es deja assis a cette table.");
    }

    let seatNumber = existingSeat?.seatNo || 0;
    if (!seatNumber) {
      for (let currentSeat = 1; currentSeat <= table.maxPlayers; currentSeat += 1) {
        if (!occupiedSeatNumbers.includes(currentSeat)) {
          seatNumber = currentSeat;
          break;
        }
      }
    }

    if (!seatNumber) {
      throw new Error("La table est pleine.");
    }

    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore - table.buyIn;
    await run("UPDATE users SET balance = ? WHERE id = ?", [balanceAfter, userId]);

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
        VALUES (?, 'poker_buyin', ?, ?, ?, ?)
      `,
      [
        userId,
        -table.buyIn,
        balanceBefore,
        balanceAfter,
        `${table.name} - cave`,
      ],
    );

    if (existingSeat) {
      await run(
        `
          UPDATE poker_seats
          SET stack = ?,
              seat_state = 'seated',
              round_bet = 0,
              hand_contribution = 0,
              acted_this_round = 0,
              hole_cards = '[]',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [table.buyIn, existingSeat.id],
      );
    } else {
      await run(
        `
          INSERT INTO poker_seats (
            table_id,
            user_id,
            seat_no,
            stack,
            seat_state,
            round_bet,
            hand_contribution,
            acted_this_round,
            hole_cards
          )
          VALUES (?, ?, ?, ?, 'seated', 0, 0, 0, '[]')
        `,
        [table.id, userId, seatNumber, table.buyIn],
      );
    }

    await logPokerAction(
      table,
      user.username,
      "join",
      table.buyIn,
      table.status === "playing"
        ? `Siege ${seatNumber} pour la prochaine main`
        : `Siege ${seatNumber}`,
      userId,
    );
    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'info', ?)
      `,
      [
        userId,
        table.status === "playing"
          ? `Tu rejoins ${table.name} avec ${formatKamasValue(table.buyIn)}. Ta place est reservee pour la prochaine main.`
          : `Tu rejoins ${table.name} avec une cave de ${formatKamasValue(table.buyIn)}.`,
      ],
    );

    return {
      user: await get("SELECT * FROM users WHERE id = ?", [userId]),
      poker: await buildPokerState(userId, table.slug),
    };
  });
}

async function leavePokerTable(userId, tableSlug = DEFAULT_TABLE_SLUG) {
  return withTransaction(async () => {
    const { table, seats } = await loadTableBundle(tableSlug);
    if (!table) {
      throw new Error("Table poker introuvable.");
    }

    const seat = seats.find((entry) => entry.userId === userId);
    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);

    if (!seat || !user) {
      throw new Error("Tu n'es pas installe a cette table.");
    }

    if (table.status === "playing" && isSeatInCurrentHand(seat)) {
      throw new Error("Tu peux quitter la table apres la main en cours.");
    }

    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore + seat.stack;

    if (seat.stack > 0) {
      await run("UPDATE users SET balance = ? WHERE id = ?", [balanceAfter, userId]);
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
          VALUES (?, 'poker_cashout', ?, ?, ?, ?)
        `,
        [
          userId,
          seat.stack,
          balanceBefore,
          balanceAfter,
          `${table.name} - sortie de table`,
        ],
      );
    }

    await run(
      `
        DELETE FROM poker_seats
        WHERE id = ?
      `,
      [seat.id],
    );

    await logPokerAction(table, seat.username, "leave", seat.stack, "", seat.userId);
    await run(
      `
        INSERT INTO notifications (user_id, type, message)
        VALUES (?, 'info', ?)
      `,
      [
        userId,
        seat.stack > 0
          ? `Tu quittes ${table.name} avec ${formatKamasValue(seat.stack)}.`
          : `Tu quittes ${table.name}.`,
      ],
    );

    const remainingSeats = await getPokerSeats(table.id);
    if (!remainingSeats.some((entry) => entry.stack > 0)) {
      await updateWaitingTable(table, "La table est a nouveau libre.");
    }

    return {
      user: await get("SELECT * FROM users WHERE id = ?", [userId]),
      poker: await buildPokerState(userId, table.slug),
    };
  });
}

async function actOnPokerTable(userId, tableSlug, action, amount) {
  const bundle = await processPlayerAction(userId, tableSlug, action, amount);
  return {
    user: await get("SELECT * FROM users WHERE id = ?", [userId]),
    poker: await buildPokerState(userId, tableSlug),
    rawTable: bundle?.table || null,
  };
}

async function startPokerEngine() {
  if (pokerEngineStarted) {
    return;
  }

  pokerEngineStarted = true;
  await ensurePokerTables();
  await syncPokerTables();

  pokerEngineTimer = setInterval(async () => {
    if (pokerEngineBusy) {
      return;
    }

    pokerEngineBusy = true;
    try {
      await syncPokerTables();
    } catch (error) {
      console.error("Erreur moteur poker:", error);
    } finally {
      pokerEngineBusy = false;
    }
  }, 1000);

  if (typeof pokerEngineTimer.unref === "function") {
    pokerEngineTimer.unref();
  }
}

module.exports = {
  DEFAULT_TABLE_SLUG,
  TABLE_PRESETS,
  actOnPokerTable,
  buildPokerState,
  joinPokerTable,
  leavePokerTable,
  startPokerEngine,
};
