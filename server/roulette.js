const crypto = require("crypto");

const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const BET_CONFIG = {
  color: {
    label: "Couleur",
    probability: 18 / 37,
  },
  number: {
    label: "Numero exact",
    probability: 1 / 37,
  },
  parity: {
    label: "Pair / impair",
    probability: 18 / 37,
  },
  range: {
    label: "Manque / passe",
    probability: 18 / 37,
  },
  dozen: {
    label: "Douzaine",
    probability: 12 / 37,
  },
};

function getPocket(number) {
  if (number === 0) {
    return {
      number,
      color: "green",
      parity: "zero",
      range: "zero",
      dozen: 0,
    };
  }

  return {
    number,
    color: RED_NUMBERS.has(number) ? "red" : "black",
    parity: number % 2 === 0 ? "even" : "odd",
    range: number <= 18 ? "manque" : "passe",
    dozen: Math.ceil(number / 12),
  };
}

function totalReturnMultiplier(type, houseEdgePercent) {
  const config = BET_CONFIG[type];
  if (!config) {
    throw new Error("Unsupported bet type");
  }

  const fairReturn = 1 / config.probability;
  const houseFactor = 1 - houseEdgePercent / 100;
  return Number((fairReturn * houseFactor).toFixed(4));
}

function spinNumber() {
  return crypto.randomInt(0, 37);
}

function normalizeBet(rawBet) {
  const type = String(rawBet?.type || "").trim().toLowerCase();
  const amount = Number.parseInt(rawBet?.amount, 10);

  if (!BET_CONFIG[type]) {
    throw new Error("Type de mise invalide.");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Montant de mise invalide.");
  }

  let value;

  if (type === "color") {
    value = String(rawBet.value || "").trim().toLowerCase();
    if (!["red", "black"].includes(value)) {
      throw new Error("Couleur invalide.");
    }
  }

  if (type === "number") {
    value = Number.parseInt(rawBet.value, 10);
    if (!Number.isInteger(value) || value < 0 || value > 36) {
      throw new Error("Numero invalide.");
    }
  }

  if (type === "parity") {
    value = String(rawBet.value || "").trim().toLowerCase();
    if (!["even", "odd"].includes(value)) {
      throw new Error("Parite invalide.");
    }
  }

  if (type === "range") {
    value = String(rawBet.value || "").trim().toLowerCase();
    if (!["manque", "passe"].includes(value)) {
      throw new Error("Tranche invalide.");
    }
  }

  if (type === "dozen") {
    value = Number.parseInt(rawBet.value, 10);
    if (![1, 2, 3].includes(value)) {
      throw new Error("Douzaine invalide.");
    }
  }

  return {
    type,
    value,
    amount,
  };
}

function validateTicketRules(bets, rules) {
  if (bets.some((bet) => bet.amount < rules.minBet)) {
    throw new Error(
      `Chaque mise doit etre d'au moins ${rules.minBet.toLocaleString("fr-FR")} kamas.`,
    );
  }

  const totalBet = bets.reduce((sum, bet) => sum + bet.amount, 0);
  if (totalBet > rules.maxBet) {
    throw new Error(
      `Le total du ticket ne peut pas depasser ${rules.maxBet.toLocaleString("fr-FR")} kamas.`,
    );
  }

  const colorTotals = new Map();
  const numberTotals = new Map();

  for (const bet of bets) {
    if (bet.type === "color") {
      const key = String(bet.value);
      colorTotals.set(key, (colorTotals.get(key) || 0) + bet.amount);
    }

    if (bet.type === "number") {
      const key = String(bet.value);
      numberTotals.set(key, (numberTotals.get(key) || 0) + bet.amount);
    }
  }

  for (const total of colorTotals.values()) {
    if (total > rules.colorMaxBet) {
      throw new Error(
        `Chaque couleur est limitee a ${rules.colorMaxBet.toLocaleString("fr-FR")} kamas.`,
      );
    }
  }

  for (const total of numberTotals.values()) {
    if (total > rules.numberMaxBet) {
      throw new Error(
        `Chaque numero, y compris le 0, est limite a ${rules.numberMaxBet.toLocaleString("fr-FR")} kamas.`,
      );
    }
  }
}

function evaluateBet(bet, resultNumber, houseEdgePercent) {
  const pocket = getPocket(resultNumber);
  const didWin =
    (bet.type === "color" && bet.value === pocket.color) ||
    (bet.type === "number" && bet.value === pocket.number) ||
    (bet.type === "parity" && pocket.number !== 0 && bet.value === pocket.parity) ||
    (bet.type === "range" && pocket.number !== 0 && bet.value === pocket.range) ||
    (bet.type === "dozen" && pocket.number !== 0 && bet.value === pocket.dozen);

  const multiplier = totalReturnMultiplier(bet.type, houseEdgePercent);
  const totalReturn = didWin
    ? Math.max(
        bet.amount + 1,
        Math.floor(bet.amount * totalReturnMultiplier(bet.type, houseEdgePercent)),
      )
    : 0;

  return {
    didWin,
    probability: BET_CONFIG[bet.type].probability,
    payoutMultiplier: multiplier,
    totalReturn,
    netResult: totalReturn - bet.amount,
  };
}

function getProbabilities(houseEdgePercent) {
  return Object.entries(BET_CONFIG).map(([type, bet]) => ({
    type,
    label: bet.label,
    probability: Number((bet.probability * 100).toFixed(2)),
    totalReturnMultiplier: totalReturnMultiplier(type, houseEdgePercent),
  }));
}

module.exports = {
  BET_CONFIG,
  RED_NUMBERS,
  WHEEL_ORDER,
  evaluateBet,
  getPocket,
  getProbabilities,
  normalizeBet,
  spinNumber,
  totalReturnMultiplier,
  validateTicketRules,
};
