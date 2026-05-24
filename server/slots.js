const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { config } = require("./config");
const { all, get, run, withTransaction } = require("./db");
const { parsePositiveInteger } = require("./utils");

const SLOT_REELS = 5;
const SLOT_ROWS = 4;
const SLOT_PAYLINES = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3],
  [0, 1, 2, 1, 0],
  [3, 2, 1, 2, 3],
  [0, 0, 1, 0, 0],
  [3, 3, 2, 3, 3],
  [1, 0, 0, 0, 1],
  [2, 3, 3, 3, 2],
  [1, 2, 3, 2, 1],
  [2, 1, 0, 1, 2],
  [0, 1, 1, 1, 0],
  [3, 2, 2, 2, 3],
  [1, 1, 2, 1, 1],
  [2, 2, 1, 2, 2],
  [0, 1, 2, 3, 2],
  [3, 2, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [2, 1, 2, 1, 2],
];
const FREE_SPIN_AWARDS = {
  3: 10,
  4: 15,
  5: 20,
};
const BONUS_MULTIPLIER_START = 2;
const BONUS_MULTIPLIER_CAP = 25;
const DEFAULT_CLIENT_SEED = "aventurier";
const SLOT_MATH_PATH = path.join(config.rootDir, "database", "slots-math.json");

const SLOT_SYMBOLS = [
  {
    id: "kama",
    label: "Kama",
    shortLabel: "K",
    tier: "low",
    payouts: { 3: 0, 4: 15, 5: 37 },
    accent: "gold",
  },
  {
    id: "rune",
    label: "Rune",
    shortLabel: "R",
    tier: "low",
    payouts: { 3: 0, 4: 19, 5: 46 },
    accent: "ember",
  },
  {
    id: "potion",
    label: "Potion",
    shortLabel: "P",
    tier: "mid",
    payouts: { 3: 6, 4: 20, 5: 59 },
    accent: "teal",
  },
  {
    id: "mask",
    label: "Masque",
    shortLabel: "M",
    tier: "mid",
    payouts: { 3: 8, 4: 25, 5: 72 },
    accent: "plum",
  },
  {
    id: "shield",
    label: "Bouclier",
    shortLabel: "B",
    tier: "high",
    payouts: { 3: 11, 4: 36, 5: 118 },
    accent: "forest",
  },
  {
    id: "dragon",
    label: "Dofus",
    shortLabel: "D",
    tier: "premium",
    payouts: { 3: 17, 4: 80, 5: 345 },
    accent: "sun",
  },
  {
    id: "wild",
    label: "Wild",
    shortLabel: "W",
    tier: "special",
    payouts: { 3: 23, 4: 162, 5: 1300 },
    accent: "ruby",
    isWild: true,
  },
  {
    id: "scatter",
    label: "Portail",
    shortLabel: "S",
    tier: "special",
    payouts: {},
    accent: "violet",
    isScatter: true,
  },
];

const SYMBOL_BY_ID = Object.fromEntries(
  SLOT_SYMBOLS.map((symbol) => [symbol.id, symbol]),
);

const WEIGHT_TABLES = {
  base: [
    { kama: 33, rune: 29, potion: 24, mask: 20, shield: 14, dragon: 6, wild: 2, scatter: 3 },
    { kama: 32, rune: 29, potion: 24, mask: 20, shield: 14, dragon: 6, wild: 3, scatter: 3 },
    { kama: 31, rune: 28, potion: 24, mask: 20, shield: 14, dragon: 6, wild: 4, scatter: 2 },
    { kama: 32, rune: 29, potion: 24, mask: 20, shield: 14, dragon: 6, wild: 3, scatter: 2 },
    { kama: 32, rune: 29, potion: 24, mask: 20, shield: 14, dragon: 6, wild: 3, scatter: 2 },
  ],
  bonus: [
    { kama: 28, rune: 25, potion: 22, mask: 18, shield: 13, dragon: 8, wild: 5, scatter: 4 },
    { kama: 27, rune: 25, potion: 22, mask: 18, shield: 13, dragon: 8, wild: 6, scatter: 4 },
    { kama: 26, rune: 24, potion: 22, mask: 18, shield: 13, dragon: 9, wild: 7, scatter: 4 },
    { kama: 27, rune: 25, potion: 22, mask: 17, shield: 13, dragon: 8, wild: 6, scatter: 3 },
    { kama: 27, rune: 25, potion: 22, mask: 17, shield: 13, dragon: 8, wild: 6, scatter: 3 },
  ],
};

function hashText(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

function createServerSeed() {
  return crypto.randomBytes(32).toString("hex");
}

function createHashRng(seedText) {
  let cursor = 0;

  return {
    nextFloat() {
      const digest = crypto
        .createHash("sha256")
        .update(`${seedText}:${cursor}`)
        .digest();
      cursor += 1;
      const value = digest.readUIntBE(0, 6);
      return value / 0x1000000000000;
    },
  };
}

function createMulberry32(seed) {
  let state = seed >>> 0;

  return {
    nextFloat() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function hashToSeed(input) {
  return Number.parseInt(hashText(input).slice(0, 8), 16) >>> 0;
}

function createWeightedRoller(weightMap) {
  const entries = SLOT_SYMBOLS.map((symbol) => ({
    id: symbol.id,
    weight: Number(weightMap[symbol.id] || 0),
  })).filter((entry) => entry.weight > 0);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let running = 0;
  const thresholds = entries.map((entry) => {
    running += entry.weight;
    return {
      id: entry.id,
      threshold: running,
    };
  });

  return {
    totalWeight,
    weights: entries,
    probabilities: entries.map((entry) => ({
      symbolId: entry.id,
      probability: entry.weight / totalWeight,
    })),
    roll(rng) {
      const target = rng.nextFloat() * totalWeight;
      return thresholds.find((entry) => target < entry.threshold)?.id || thresholds[thresholds.length - 1].id;
    },
  };
}

const ROLLERS = {
  base: WEIGHT_TABLES.base.map((weightMap) => createWeightedRoller(weightMap)),
  bonus: WEIGHT_TABLES.bonus.map((weightMap) => createWeightedRoller(weightMap)),
};

function sanitizeClientSeed(input) {
  const candidate = String(input || "")
    .trim()
    .replace(/\s+/g, " ");

  if (candidate.length < 3 || candidate.length > 48) {
    throw new Error("Le client seed doit faire entre 3 et 48 caracteres.");
  }

  if (!/^[\w\-:.# ]+$/i.test(candidate)) {
    throw new Error("Le client seed contient des caracteres non autorises.");
  }

  return candidate;
}

function validateSlotBet(betAmount) {
  const bet = parsePositiveInteger(betAmount);

  if (!bet) {
    throw new Error("Mise machine a sous invalide.");
  }

  if (bet < config.slotMinBet) {
    throw new Error(`La mise mini machine a sous est ${config.slotMinBet.toLocaleString("fr-FR")} kamas.`);
  }

  if (bet > config.slotMaxBet) {
    throw new Error(`La mise max machine a sous est ${config.slotMaxBet.toLocaleString("fr-FR")} kamas.`);
  }

  if ((bet - config.slotMinBet) % config.slotBetStep !== 0) {
    throw new Error(`Les mises machine a sous avancent par pas de ${config.slotBetStep.toLocaleString("fr-FR")} kamas.`);
  }

  return bet;
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function createGrid(mode, rng) {
  return Array.from({ length: SLOT_ROWS }, (_unused, rowIndex) =>
    Array.from({ length: SLOT_REELS }, (_unusedReel, reelIndex) =>
      ROLLERS[mode][reelIndex].roll(rng),
    ),
  );
}

function countScatter(grid) {
  return grid.flat().filter((symbolId) => symbolId === "scatter").length;
}

function serializeGrid(grid) {
  return grid.map((row) =>
    row.map((symbolId) => ({
      id: symbolId,
      label: SYMBOL_BY_ID[symbolId].label,
      shortLabel: SYMBOL_BY_ID[symbolId].shortLabel,
      accent: SYMBOL_BY_ID[symbolId].accent,
      tier: SYMBOL_BY_ID[symbolId].tier,
      isWild: Boolean(SYMBOL_BY_ID[symbolId].isWild),
      isScatter: Boolean(SYMBOL_BY_ID[symbolId].isScatter),
    })),
  );
}

function buildLineMatch(symbolIds) {
  const cells = symbolIds.map((symbolId, reelIndex) => ({
    symbolId,
    reelIndex,
  }));

  const firstRegular = cells.find(
    (cell) => !SYMBOL_BY_ID[cell.symbolId].isWild && !SYMBOL_BY_ID[cell.symbolId].isScatter,
  );
  const targetSymbolId = firstRegular?.symbolId || (cells[0]?.symbolId === "wild" ? "wild" : null);

  if (!targetSymbolId || targetSymbolId === "scatter") {
    return null;
  }

  const matched = [];
  for (const cell of cells) {
    const symbol = SYMBOL_BY_ID[cell.symbolId];
    if (symbol.isScatter) {
      break;
    }

    if (targetSymbolId === "wild") {
      if (cell.symbolId !== "wild") {
        break;
      }
      matched.push(cell);
      continue;
    }

    if (cell.symbolId === targetSymbolId || symbol.isWild) {
      matched.push(cell);
      continue;
    }

    break;
  }

  if (matched.length < 3) {
    return null;
  }

  const payoutMultiplier = Number(SYMBOL_BY_ID[targetSymbolId].payouts[matched.length] || 0);

  if (!payoutMultiplier) {
    return null;
  }

  return {
    symbolId: targetSymbolId,
    matchCount: matched.length,
    payoutMultiplier,
    matched,
  };
}

function evaluateGrid(grid, lineBet) {
  const lineWins = [];
  const clearPositions = new Set();
  let totalWin = 0;

  SLOT_PAYLINES.forEach((line, index) => {
    const symbolIds = line.map((rowIndex, reelIndex) => grid[rowIndex][reelIndex]);
    const result = buildLineMatch(symbolIds);

    if (!result) {
      return;
    }

    const payout = result.payoutMultiplier * lineBet;
    totalWin += payout;
    result.matched.forEach((cell) => {
      clearPositions.add(`${line[cell.reelIndex]}:${cell.reelIndex}`);
    });

    lineWins.push({
      paylineIndex: index + 1,
      symbolId: result.symbolId,
      symbolLabel: SYMBOL_BY_ID[result.symbolId].label,
      matchCount: result.matchCount,
      payout,
      payoutMultiplier: result.payoutMultiplier,
      positions: result.matched.map((cell) => ({
        row: line[cell.reelIndex],
        reel: cell.reelIndex,
      })),
    });
  });

  return {
    totalWin,
    scatterCount: countScatter(grid),
    lineWins,
    clearPositions,
  };
}

function cascadeGrid(grid, clearPositions, mode, rng) {
  const nextGrid = Array.from({ length: SLOT_ROWS }, () => Array(SLOT_REELS).fill(null));

  for (let reelIndex = 0; reelIndex < SLOT_REELS; reelIndex += 1) {
    const column = [];

    for (let rowIndex = SLOT_ROWS - 1; rowIndex >= 0; rowIndex -= 1) {
      if (!clearPositions.has(`${rowIndex}:${reelIndex}`)) {
        column.push(grid[rowIndex][reelIndex]);
      }
    }

    while (column.length < SLOT_ROWS) {
      column.push(ROLLERS[mode][reelIndex].roll(rng));
    }

    for (let rowIndex = 0; rowIndex < SLOT_ROWS; rowIndex += 1) {
      nextGrid[rowIndex][reelIndex] = column[SLOT_ROWS - 1 - rowIndex];
    }
  }

  return nextGrid;
}

function resolveSpin({
  betAmount,
  mode,
  rng,
  bonusMultiplierStart = 1,
}) {
  const lineBet = Math.max(1, Math.floor(betAmount / SLOT_PAYLINES.length));
  const openingGrid = createGrid(mode, rng);
  let currentGrid = cloneGrid(openingGrid);
  let totalWin = 0;
  let cascadeCount = 0;
  let maxScatterCount = 0;
  let currentBonusMultiplier = mode === "bonus" ? bonusMultiplierStart : 1;
  let maxAppliedMultiplier = 1;
  const cascades = [];

  while (true) {
    const evaluation = evaluateGrid(currentGrid, lineBet);
    maxScatterCount = Math.max(maxScatterCount, evaluation.scatterCount);

    if (!evaluation.totalWin || !evaluation.clearPositions.size) {
      break;
    }

    cascadeCount += 1;
    const appliedMultiplier = mode === "bonus" ? currentBonusMultiplier : 1;
    const cascadeWin = evaluation.totalWin * appliedMultiplier;
    totalWin += cascadeWin;
    maxAppliedMultiplier = Math.max(maxAppliedMultiplier, appliedMultiplier);

    cascades.push({
      index: cascadeCount,
      grid: serializeGrid(currentGrid),
      rawWin: evaluation.totalWin,
      totalWin: cascadeWin,
      appliedMultiplier,
      scatterCount: evaluation.scatterCount,
      lineWins: evaluation.lineWins,
    });

    if (mode === "bonus") {
      currentBonusMultiplier = Math.min(
        BONUS_MULTIPLIER_CAP,
        currentBonusMultiplier + 1,
      );
    }

    currentGrid = cascadeGrid(currentGrid, evaluation.clearPositions, mode, rng);
  }

  const finalScatterCount = countScatter(currentGrid);
  maxScatterCount = Math.max(maxScatterCount, finalScatterCount);
  const freeSpinsAwarded = FREE_SPIN_AWARDS[Math.min(5, maxScatterCount)] || 0;
  const nearMiss = freeSpinsAwarded === 0 && maxScatterCount === 2;

  return {
    betAmount,
    lineBet,
    mode,
    openingGrid: serializeGrid(openingGrid),
    finalGrid: serializeGrid(currentGrid),
    cascades,
    cascadeCount,
    totalWin,
    hit: totalWin > 0,
    scatterCount: maxScatterCount,
    freeSpinsAwarded,
    nearMiss,
    maxAppliedMultiplier,
    bonusMultiplierStart: mode === "bonus" ? bonusMultiplierStart : 1,
    bonusMultiplierEnd: mode === "bonus" ? currentBonusMultiplier : 1,
    bigHit: totalWin >= betAmount * 50,
  };
}

async function ensureSlotSession(userId) {
  let session = await get("SELECT * FROM slot_sessions WHERE user_id = ?", [userId]);

  if (session) {
    return session;
  }

  const serverSeed = createServerSeed();
  const serverSeedHash = hashText(serverSeed);
  await run(
    `
      INSERT OR IGNORE INTO slot_sessions (
        user_id,
        server_seed,
        server_seed_hash,
        client_seed,
        next_nonce
      )
      VALUES (?, ?, ?, ?, 0)
    `,
    [userId, serverSeed, serverSeedHash, DEFAULT_CLIENT_SEED],
  );

  session = await get("SELECT * FROM slot_sessions WHERE user_id = ?", [userId]);
  return session;
}

function buildProvablyFairState(session) {
  return {
    serverSeedHash: session.server_seed_hash,
    clientSeed: session.client_seed,
    nextNonce: Number(session.next_nonce || 0),
    canRotate: Number(session.free_spins_remaining || 0) === 0,
    previousReveal: session.previous_server_seed
      ? {
          serverSeed: session.previous_server_seed,
          serverSeedHash: session.previous_server_seed_hash,
          clientSeed: session.previous_client_seed || DEFAULT_CLIENT_SEED,
          lastNonce: Number(session.previous_nonce || 0),
        }
      : null,
  };
}

function getProbabilityTable() {
  return ["base", "bonus"].map((mode) => ({
    mode,
    reels: ROLLERS[mode].map((roller, reelIndex) => ({
      reel: reelIndex + 1,
      rowsVisible: SLOT_ROWS,
      symbols: roller.probabilities.map((entry) => ({
        symbolId: entry.symbolId,
        symbolLabel: SYMBOL_BY_ID[entry.symbolId].label,
        probabilityPerCell: Number((entry.probability * 100).toFixed(3)),
        expectedVisiblePerSpin: Number((entry.probability * SLOT_ROWS).toFixed(3)),
      })),
    })),
  }));
}

function getPaytable() {
  return SLOT_SYMBOLS.map((symbol) => ({
    symbolId: symbol.id,
    symbolLabel: symbol.label,
    shortLabel: symbol.shortLabel,
    tier: symbol.tier,
    accent: symbol.accent,
    isWild: Boolean(symbol.isWild),
    isScatter: Boolean(symbol.isScatter),
    payouts: {
      3: Number(symbol.payouts[3] || 0),
      4: Number(symbol.payouts[4] || 0),
      5: Number(symbol.payouts[5] || 0),
    },
  }));
}

function buildMultiplierRules() {
  return {
    baseGame: "x1",
    freeSpinsStart: BONUS_MULTIPLIER_START,
    increment: 1,
    cap: BONUS_MULTIPLIER_CAP,
    bonusDescription:
      "En free spins, chaque cascade gagnante applique le multiplicateur courant puis l'augmente de +1 pour la suite de la feature.",
    retrigger:
      "3 scatters = 10 free spins, 4 scatters = 15 free spins, 5 scatters = 20 free spins.",
    wildBoost:
      "Les wilds et les scatters sont plus frequents pendant les free spins.",
  };
}

function buildPublicConfig() {
  return {
    reels: SLOT_REELS,
    rows: SLOT_ROWS,
    paylines: SLOT_PAYLINES.length,
    minBet: config.slotMinBet,
    maxBet: config.slotMaxBet,
    betStep: config.slotBetStep,
    maxWinMultiplier: config.slotMaxWinMultiplier,
    targetRtp: config.slotTargetRtp,
    targetHouseEdge: Number((100 - config.slotTargetRtp).toFixed(2)),
    volatility: "moyenne / haute",
    targetHitFrequency: "28% - 35%",
    targetBonusFrequency: "1 / 120 - 1 / 180",
    paytable: getPaytable(),
    probabilityTable: getProbabilityTable(),
    multiplierRules: buildMultiplierRules(),
  };
}

function defaultMathSnapshot() {
  return {
    sampleSize: 0,
    paidSpinCount: 0,
    totalSpinCount: 0,
    executedBonusSpins: 0,
    rtp: 0,
    hitFrequency: 0,
    bonusFrequency: 0,
    variance: 0,
    standardDeviation: 0,
    averageWin: 0,
    maxObservedWinMultiplier: 0,
    operatorProfitPerMillionWagered: 0,
    distribution: [],
    note:
      "Simulation non generee localement pour l'instant. Lance `npm run slots:simulate` pour produire le snapshot complet.",
  };
}

let cachedMathSnapshot = null;

function loadMathSnapshot() {
  if (cachedMathSnapshot) {
    return cachedMathSnapshot;
  }

  try {
    cachedMathSnapshot = JSON.parse(fs.readFileSync(SLOT_MATH_PATH, "utf8"));
    return cachedMathSnapshot;
  } catch (_error) {
    cachedMathSnapshot = defaultMathSnapshot();
    return cachedMathSnapshot;
  }
}

function slotMathExplanation() {
  return {
    formulas: [
      "RTP = gains totaux / mises totales.",
      "House edge = 100 - RTP.",
      "Variance = moyenne des (resultat net - moyenne)^2 sur les spins payants.",
      "Frequence bonus = nombre de bonus declenches / nombre de spins payants.",
    ],
    balancingStrategy: [
      "Les symbols faibles sont frequents pour produire des retours reguliers mais souvent inferieurs a la mise.",
      "Les premium et les wilds sont rares en base game pour proteger la marge long terme.",
      "Le bonus concentre une grosse partie du RTP via retriggers et multiplicateur progressif.",
      "Les near-miss viennent de la distribution naturelle des scatters par rouleau, sans post-traitement cote client.",
    ],
  };
}

function mapSlotSpinRow(row) {
  const summary = JSON.parse(row.summary_json);
  return {
    id: Number(row.id),
    spinMode: row.spin_mode,
    betAmount: Number(row.bet_amount),
    totalWin: Number(row.total_win),
    netResult: Number(row.net_result),
    hit: Boolean(row.hit),
    cascadeCount: Number(row.cascade_count),
    scatterCount: Number(row.scatter_count),
    freeSpinsAwarded: Number(row.free_spins_awarded),
    freeSpinsRemaining: Number(row.free_spins_remaining),
    bonusMultiplierStart: Number(row.bonus_multiplier_start),
    bonusMultiplierEnd: Number(row.bonus_multiplier_end),
    maxAppliedMultiplier: Number(row.max_applied_multiplier),
    nonce: Number(row.nonce),
    clientSeed: row.client_seed,
    serverSeedHash: row.server_seed_hash,
    createdAt: row.created_at,
    summary,
  };
}

async function buildSlotState(userId) {
  const [session, historyRows, stats] = await Promise.all([
    ensureSlotSession(userId),
    all(
      `
        SELECT *
        FROM slot_spins
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 12
      `,
      [userId],
    ),
    get(
      `
        SELECT
          COUNT(*) AS total_spins,
          COALESCE(SUM(CASE WHEN spin_mode = 'base' THEN 1 ELSE 0 END), 0) AS paid_spins,
          COALESCE(SUM(CASE WHEN spin_mode = 'bonus' THEN 1 ELSE 0 END), 0) AS bonus_spins,
          COALESCE(SUM(hit), 0) AS hits,
          COALESCE(SUM(CASE WHEN free_spins_awarded > 0 THEN 1 ELSE 0 END), 0) AS bonus_triggers,
          COALESCE(SUM(CASE WHEN spin_mode = 'base' THEN bet_amount ELSE 0 END), 0) AS wagered,
          COALESCE(SUM(total_win), 0) AS total_win,
          COALESCE(MAX(total_win), 0) AS biggest_win
        FROM slot_spins
        WHERE user_id = ?
      `,
      [userId],
    ),
  ]);

  const paidSpins = Number(stats?.paid_spins || 0);
  const totalSpins = Number(stats?.total_spins || 0);
  const bonusTriggers = Number(stats?.bonus_triggers || 0);
  const wagered = Number(stats?.wagered || 0);
  const totalWin = Number(stats?.total_win || 0);

  return {
    config: buildPublicConfig(),
    provablyFair: buildProvablyFairState(session),
    activeBonus: {
      freeSpinsRemaining: Number(session.free_spins_remaining || 0),
      currentMultiplier: Number(session.bonus_multiplier || BONUS_MULTIPLIER_START),
      lockedBet: Number(session.bonus_bet || 0),
    },
    recentSpins: historyRows.map(mapSlotSpinRow),
    stats: {
      totalSpins,
      paidSpins,
      bonusSpins: Number(stats?.bonus_spins || 0),
      hitFrequency: totalSpins
        ? Number(((Number(stats?.hits || 0) / totalSpins) * 100).toFixed(2))
        : 0,
      bonusFrequency: paidSpins
        ? Number((paidSpins / Math.max(1, bonusTriggers)).toFixed(1))
        : 0,
      liveRtp: wagered ? Number(((totalWin / wagered) * 100).toFixed(2)) : 0,
      wagered,
      totalWin,
      biggestWin: Number(stats?.biggest_win || 0),
    },
    mathSnapshot: loadMathSnapshot(),
    mathExplanation: slotMathExplanation(),
  };
}

function buildSpinSeed(session, nonce, mode) {
  return `${session.server_seed}:${session.client_seed}:${nonce}:${mode}`;
}

async function spinSlots(userId, requestedBet) {
  return withTransaction(async () => {
    const user = await get("SELECT * FROM users WHERE id = ?", [userId]);
    const session = await ensureSlotSession(userId);

    if (!user) {
      throw new Error("Compte introuvable.");
    }

    const hasFreeSpins = Number(session.free_spins_remaining || 0) > 0;
    const mode = hasFreeSpins ? "bonus" : "base";
    const betAmount = hasFreeSpins
      ? Number(session.bonus_bet || 0)
      : validateSlotBet(requestedBet);

    if (!hasFreeSpins && Number(user.balance) < betAmount) {
      throw new Error("Solde insuffisant pour lancer cette machine.");
    }

    const nonce = Number(session.next_nonce || 0);
    const rng = createHashRng(buildSpinSeed(session, nonce, mode));
    const outcome = resolveSpin({
      betAmount,
      mode,
      rng,
      bonusMultiplierStart: hasFreeSpins
        ? Number(session.bonus_multiplier || BONUS_MULTIPLIER_START)
        : 1,
    });
    const cappedTotalWin = Math.min(
      outcome.totalWin,
      betAmount * config.slotMaxWinMultiplier,
    );
    const netResult = mode === "bonus" ? cappedTotalWin : cappedTotalWin - betAmount;
    const freeSpinsAwarded = Number(outcome.freeSpinsAwarded || 0);
    const freeSpinsRemainingBefore = Number(session.free_spins_remaining || 0);
    let freeSpinsRemaining = freeSpinsRemainingBefore;
    let bonusMultiplier = Number(session.bonus_multiplier || BONUS_MULTIPLIER_START);
    let bonusBet = Number(session.bonus_bet || 0);

    if (mode === "bonus") {
      freeSpinsRemaining = Math.max(0, freeSpinsRemainingBefore - 1) + freeSpinsAwarded;
      bonusMultiplier = freeSpinsRemaining > 0 ? outcome.bonusMultiplierEnd : BONUS_MULTIPLIER_START;
      bonusBet = freeSpinsRemaining > 0 ? bonusBet : 0;
    } else if (freeSpinsAwarded > 0) {
      freeSpinsRemaining = freeSpinsAwarded;
      bonusMultiplier = BONUS_MULTIPLIER_START;
      bonusBet = betAmount;
    } else {
      freeSpinsRemaining = 0;
      bonusMultiplier = BONUS_MULTIPLIER_START;
      bonusBet = 0;
    }

    const balanceBefore = Number(user.balance);
    const balanceAfter = balanceBefore - (mode === "base" ? betAmount : 0) + cappedTotalWin;
    const wagerIncrement = mode === "base" ? betAmount : 0;
    const winIncrement = cappedTotalWin;
    const profitIncrement = netResult;
    const highestWin = Math.max(Number(user.highest_win || 0), cappedTotalWin);

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
        highestWin,
        userId,
      ],
    );

    await run(
      `
        UPDATE slot_sessions
        SET next_nonce = ?,
            free_spins_remaining = ?,
            bonus_multiplier = ?,
            bonus_bet = ?,
            total_spins = total_spins + 1,
            total_bonus_spins = total_bonus_spins + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `,
      [
        nonce + 1,
        freeSpinsRemaining,
        bonusMultiplier,
        bonusBet,
        mode === "bonus" ? 1 : 0,
        userId,
      ],
    );

    const summary = {
      ...outcome,
      totalWin: cappedTotalWin,
      cappedByMaxWin: cappedTotalWin !== outcome.totalWin,
      freeSpinsRemainingAfter: freeSpinsRemaining,
      triggeredBonus: mode === "base" && freeSpinsAwarded > 0,
      retriggered: mode === "bonus" && freeSpinsAwarded > 0,
      displayWinMultiplier: Number((cappedTotalWin / Math.max(1, betAmount)).toFixed(2)),
    };

    await run(
      `
        INSERT INTO slot_spins (
          user_id,
          username_snapshot,
          spin_mode,
          bet_amount,
          total_win,
          net_result,
          hit,
          cascade_count,
          scatter_count,
          free_spins_awarded,
          free_spins_remaining,
          bonus_multiplier_start,
          bonus_multiplier_end,
          max_applied_multiplier,
          server_seed_hash,
          client_seed,
          nonce,
          summary_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        user.username,
        mode,
        betAmount,
        cappedTotalWin,
        netResult,
        outcome.hit ? 1 : 0,
        outcome.cascadeCount,
        outcome.scatterCount,
        freeSpinsAwarded,
        freeSpinsRemaining,
        outcome.bonusMultiplierStart,
        mode === "bonus" ? bonusMultiplier : outcome.bonusMultiplierEnd,
        outcome.maxAppliedMultiplier,
        session.server_seed_hash,
        session.client_seed,
        nonce,
        JSON.stringify(summary),
      ],
    );

    const updatedUser = await get("SELECT * FROM users WHERE id = ?", [userId]);
    return {
      user: updatedUser,
      slotState: await buildSlotState(userId),
      spinResult: {
        mode,
        nonce,
        betAmount,
        totalWin: cappedTotalWin,
        netResult,
        freeSpinsAwarded,
        freeSpinsRemaining,
        summary,
      },
    };
  });
}

async function updateSlotClientSeed(userId, requestedClientSeed) {
  const clientSeed = sanitizeClientSeed(requestedClientSeed);

  return withTransaction(async () => {
    await ensureSlotSession(userId);
    await run(
      `
        UPDATE slot_sessions
        SET client_seed = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `,
      [clientSeed, userId],
    );

    return buildSlotState(userId);
  });
}

async function rotateSlotSeeds(userId, requestedClientSeed) {
  return withTransaction(async () => {
    const session = await ensureSlotSession(userId);

    if (Number(session.free_spins_remaining || 0) > 0) {
      throw new Error("Termine les free spins en cours avant de faire tourner les seeds.");
    }

    const nextClientSeed = requestedClientSeed
      ? sanitizeClientSeed(requestedClientSeed)
      : session.client_seed;
    const nextServerSeed = createServerSeed();
    const nextServerSeedHash = hashText(nextServerSeed);

    await run(
      `
        UPDATE slot_sessions
        SET previous_server_seed = ?,
            previous_server_seed_hash = ?,
            previous_client_seed = ?,
            previous_nonce = ?,
            server_seed = ?,
            server_seed_hash = ?,
            client_seed = ?,
            next_nonce = 0,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `,
      [
        session.server_seed,
        session.server_seed_hash,
        session.client_seed,
        session.next_nonce,
        nextServerSeed,
        nextServerSeedHash,
        nextClientSeed,
        userId,
      ],
    );

    return buildSlotState(userId);
  });
}

function createDistributionBuckets() {
  return [
    { key: "dead", label: "0x", min: -0.0001, max: 0 },
    { key: "micro", label: "0.01x - 0.49x", min: 0.0001, max: 0.49 },
    { key: "small", label: "0.5x - 0.99x", min: 0.5, max: 0.99 },
    { key: "medium", label: "1x - 4.99x", min: 1, max: 4.99 },
    { key: "large", label: "5x - 24.99x", min: 5, max: 24.99 },
    { key: "epic", label: "25x - 99.99x", min: 25, max: 99.99 },
    { key: "mythic", label: "100x+", min: 100, max: Number.POSITIVE_INFINITY },
  ].map((bucket) => ({
    ...bucket,
    count: 0,
  }));
}

function locateBucket(buckets, multiplier) {
  return (
    buckets.find((bucket) => multiplier >= bucket.min && multiplier <= bucket.max) ||
    buckets[buckets.length - 1]
  );
}

function resolvePaidSpinPackage(betAmount, packageIndex, rootSeed) {
  const rng = createMulberry32(hashToSeed(`${rootSeed}:${packageIndex}`));
  const aggregate = {
    totalWin: 0,
    totalSpins: 0,
    bonusSpins: 0,
    bonusTriggered: false,
    maxAppliedMultiplier: 1,
  };
  let bonusQueue = 0;
  let bonusMultiplier = BONUS_MULTIPLIER_START;

  const baseSpin = resolveSpin({
    betAmount,
    mode: "base",
    rng,
  });
  aggregate.totalWin += baseSpin.totalWin;
  aggregate.totalSpins += 1;
  aggregate.maxAppliedMultiplier = Math.max(
    aggregate.maxAppliedMultiplier,
    baseSpin.maxAppliedMultiplier,
  );

  if (baseSpin.freeSpinsAwarded > 0) {
    bonusQueue += baseSpin.freeSpinsAwarded;
    aggregate.bonusTriggered = true;
  }

  while (bonusQueue > 0) {
    const bonusSpin = resolveSpin({
      betAmount,
      mode: "bonus",
      rng,
      bonusMultiplierStart: bonusMultiplier,
    });
    bonusQueue -= 1;
    bonusQueue += bonusSpin.freeSpinsAwarded;
    bonusMultiplier =
      bonusQueue > 0 ? bonusSpin.bonusMultiplierEnd : BONUS_MULTIPLIER_START;
    aggregate.totalWin += bonusSpin.totalWin;
    aggregate.totalSpins += 1;
    aggregate.bonusSpins += 1;
    aggregate.maxAppliedMultiplier = Math.max(
      aggregate.maxAppliedMultiplier,
      bonusSpin.maxAppliedMultiplier,
    );
  }

  return aggregate;
}

function simulateSlotMath({
  paidSpins = 2000000,
  betAmount = config.slotMinBet,
  rootSeed = "slots-math-snapshot",
} = {}) {
  const buckets = createDistributionBuckets();
  let totalWin = 0;
  let totalBonusSpins = 0;
  let totalExecutedSpins = 0;
  let bonusTriggers = 0;
  let hitCount = 0;
  let squaredSum = 0;
  let maxObservedWinMultiplier = 0;

  for (let index = 0; index < paidSpins; index += 1) {
    const pack = resolvePaidSpinPackage(betAmount, index, rootSeed);
    const net = pack.totalWin - betAmount;
    const winMultiplier = pack.totalWin / betAmount;
    const bucket = locateBucket(buckets, winMultiplier);

    bucket.count += 1;
    totalWin += pack.totalWin;
    totalBonusSpins += pack.bonusSpins;
    totalExecutedSpins += pack.totalSpins;
    bonusTriggers += pack.bonusTriggered ? 1 : 0;
    hitCount += pack.totalWin > 0 ? 1 : 0;
    squaredSum += net * net;
    maxObservedWinMultiplier = Math.max(maxObservedWinMultiplier, winMultiplier);
  }

  const totalBet = paidSpins * betAmount;
  const meanNet = (totalWin - totalBet) / paidSpins;
  const variance = squaredSum / paidSpins - meanNet * meanNet;

  return {
    sampleSize: paidSpins,
    paidSpinCount: paidSpins,
    totalSpinCount: totalExecutedSpins,
    executedBonusSpins: totalBonusSpins,
    rtp: Number(((totalWin / totalBet) * 100).toFixed(4)),
    hitFrequency: Number(((hitCount / paidSpins) * 100).toFixed(4)),
    bonusFrequency: bonusTriggers ? Number((paidSpins / bonusTriggers).toFixed(4)) : 0,
    variance: Number(variance.toFixed(4)),
    standardDeviation: Number(Math.sqrt(Math.max(variance, 0)).toFixed(4)),
    averageWin: Number((totalWin / Math.max(1, hitCount)).toFixed(4)),
    maxObservedWinMultiplier: Number(maxObservedWinMultiplier.toFixed(2)),
    operatorProfitPerMillionWagered: Number(
      (((totalBet - totalWin) / totalBet) * 1000000).toFixed(2),
    ),
    distribution: buckets.map((bucket) => ({
      label: bucket.label,
      count: bucket.count,
      frequency: Number(((bucket.count / paidSpins) * 100).toFixed(4)),
    })),
  };
}

module.exports = {
  BONUS_MULTIPLIER_CAP,
  BONUS_MULTIPLIER_START,
  SLOT_PAYLINES,
  SLOT_REELS,
  SLOT_ROWS,
  SLOT_SYMBOLS,
  buildPublicConfig,
  buildSlotState,
  ensureSlotSession,
  loadMathSnapshot,
  rotateSlotSeeds,
  simulateSlotMath,
  spinSlots,
  updateSlotClientSeed,
};
