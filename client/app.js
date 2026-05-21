const {
  api,
  createAudioEngine,
  escapeHtml,
  formatDate,
  formatKamas,
  showToast,
} = window.CasinoCommon;

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

const CHIP_VALUES = [100, 500, 1000, 5000, 10000];
const DEFAULT_PROBABILITIES = [
  { type: "number", label: "Numero exact", probability: 2.7, totalReturnMultiplier: 36.26 },
  { type: "color", label: "Couleur", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "parity", label: "Pair / impair", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "range", label: "Manque / passe", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "dozen", label: "Douzaine", probability: 32.43, totalReturnMultiplier: 3.02 },
];

const state = {
  me: null,
  bootstrap: null,
  selectedChip: 1000,
  betSlip: new Map(),
  pendingTicket: {
    bets: [],
    totalBet: 0,
    isSubmitted: false,
  },
  soundEnabled: false,
  audio: createAudioEngine(),
  isSubmittingTicket: false,
  isAnimatingRound: false,
  isRoundPollInFlight: false,
  wheelRotation: 0,
  autoQueue: {
    active: false,
    remaining: 0,
    template: [],
  },
  sideRefreshTimer: null,
  roundPollTimer: null,
  countdownTimer: null,
  lastAnimatedRoundId: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  buildChipRow();
  buildNumberGrid();
  renderProbabilityCards(DEFAULT_PROBABILITIES);
  drawWheel();
  hydrateSession();
});

function cacheElements() {
  Object.assign(elements, {
    adminShortcut: document.getElementById("adminShortcut"),
    authGate: document.getElementById("authGate"),
    autoSpinButton: document.getElementById("autoSpinButton"),
    autoSpinRounds: document.getElementById("autoSpinRounds"),
    balanceValue: document.getElementById("balanceValue"),
    betPanel: document.querySelector(".bet-panel"),
    betSlip: document.getElementById("betSlip"),
    cancelTicketButton: document.getElementById("cancelTicketButton"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatMessages: document.getElementById("chatMessages"),
    chipRow: document.getElementById("chipRow"),
    clearBetsButton: document.getElementById("clearBetsButton"),
    closeResultModal: document.getElementById("closeResultModal"),
    confirmedTicketValue: document.getElementById("confirmedTicketValue"),
    historyList: document.getElementById("historyList"),
    jackpotValue: document.getElementById("jackpotValue"),
    lastNumbers: document.getElementById("lastNumbers"),
    leaderboardList: document.getElementById("leaderboardList"),
    levelValue: document.getElementById("levelValue"),
    loginForm: document.getElementById("loginForm"),
    logoutButton: document.getElementById("logoutButton"),
    notificationList: document.getElementById("notificationList"),
    numberGrid: document.getElementById("numberGrid"),
    playerApp: document.getElementById("playerApp"),
    probabilityCards: document.getElementById("probabilityCards"),
    profitValue: document.getElementById("profitValue"),
    readNotificationsButton: document.getElementById("readNotificationsButton"),
    registerForm: document.getElementById("registerForm"),
    resultMeta: document.getElementById("resultMeta"),
    resultModal: document.getElementById("resultModal"),
    resultSubtitle: document.getElementById("resultSubtitle"),
    resultTitle: document.getElementById("resultTitle"),
    rouletteCanvas: document.getElementById("rouletteCanvas"),
    roundLabel: document.getElementById("roundLabel"),
    roundStatusValue: document.getElementById("roundStatusValue"),
    roundTimerValue: document.getElementById("roundTimerValue"),
    soundToggle: document.getElementById("soundToggle"),
    spinButton: document.getElementById("spinButton"),
    statsGrid: document.getElementById("statsGrid"),
    stopAutoSpinButton: document.getElementById("stopAutoSpinButton"),
    ticketTotal: document.getElementById("ticketTotal"),
  });
}

function bindEvents() {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
  });

  elements.loginForm.addEventListener("submit", onLogin);
  elements.registerForm.addEventListener("submit", onRegister);
  elements.logoutButton.addEventListener("click", logout);
  elements.soundToggle.addEventListener("click", toggleSound);
  elements.clearBetsButton.addEventListener("click", clearBets);
  elements.cancelTicketButton.addEventListener("click", cancelTicket);
  elements.spinButton.addEventListener("click", submitCurrentTicket);
  elements.autoSpinButton.addEventListener("click", startAutoQueue);
  elements.stopAutoSpinButton.addEventListener("click", stopAutoQueue);
  elements.closeResultModal.addEventListener("click", () => {
    elements.resultModal.classList.add("hidden");
  });
  elements.chatForm.addEventListener("submit", onChatSubmit);
  elements.readNotificationsButton.addEventListener("click", readAllNotifications);

  elements.betPanel.addEventListener("click", (event) => {
    const shortcut = event.target.closest("[data-bet-type]");
    const removal = event.target.closest("[data-remove-bet]");

    if (removal) {
      state.betSlip.delete(removal.dataset.removeBet);
      renderBetSlip();
      return;
    }

    if (!shortcut) {
      return;
    }

    const { betType, betValue } = shortcut.dataset;
    addBet(betType, coerceBetValue(betType, betValue));
  });
}

async function hydrateSession() {
  try {
    const payload = await api("/api/auth/me");
    if (!payload.user) {
      showAuth();
      return;
    }

    state.me = payload.user;
    await loadBootstrap({ seedSlip: true });
    showApp();
  } catch (error) {
    showToast(error.message, "error");
    showAuth();
  }
}

async function loadBootstrap(options = {}) {
  const payload = await api("/api/game/bootstrap");
  applyBootstrap(payload, options);
}

function applyBootstrap(payload, options = {}) {
  state.bootstrap = payload;
  state.me = payload.user;
  state.pendingTicket = payload.pendingTicket || emptyPendingTicket(payload.currentRound?.id);

  if (state.lastAnimatedRoundId === null) {
    state.lastAnimatedRoundId = payload.latestResolvedRound?.id || 0;
  }

  if (options.seedSlip && !state.betSlip.size && state.pendingTicket.bets?.length) {
    replaceBetSlip(state.pendingTicket.bets);
  }

  renderMetrics();
  renderRoundPanel();
  renderLastNumbers(payload.lastNumbers);
  renderHistory(payload.history);
  renderLeaderboard(payload.leaderboard);
  renderNotifications(payload.notifications);
  renderStats(payload.stats);
  renderChat(payload.chat);
  renderProbabilityCards(payload.roulette?.probabilities || DEFAULT_PROBABILITIES);
  syncAdminShortcut();
  renderBetSlip();
  updateSpinButtons();
  resetRoundTimers();
  resetSideRefresh();
}

function showApp() {
  elements.authGate.classList.add("hidden");
  elements.playerApp.classList.remove("hidden");
  elements.logoutButton.classList.remove("hidden");
}

function showAuth() {
  elements.authGate.classList.remove("hidden");
  elements.playerApp.classList.add("hidden");
  elements.logoutButton.classList.add("hidden");
  elements.adminShortcut.classList.add("hidden");
}

function syncAdminShortcut() {
  if (state.me?.role === "admin") {
    elements.adminShortcut.classList.remove("hidden");
  } else {
    elements.adminShortcut.classList.add("hidden");
  }
}

function setAuthTab(tab) {
  document.querySelectorAll("[data-auth-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authTab === tab);
  });
  elements.loginForm.classList.toggle("hidden", tab !== "login");
  elements.registerForm.classList.toggle("hidden", tab !== "register");
}

async function onLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });

    showToast(payload.message, "success");
    state.me = payload.user;
    await loadBootstrap({ seedSlip: true });
    showApp();
    event.currentTarget.reset();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function onRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);

  try {
    const payload = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username: formData.get("username"),
        password: formData.get("password"),
      }),
    });

    showToast(payload.message, "success");
    state.me = payload.user;
    await loadBootstrap({ seedSlip: true });
    showApp();
    event.currentTarget.reset();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (error) {
    showToast(error.message, "error");
  }

  stopAutoQueue();
  clearTimers();
  state.me = null;
  state.bootstrap = null;
  state.pendingTicket = emptyPendingTicket(null);
  state.betSlip.clear();
  state.lastAnimatedRoundId = null;
  renderBetSlip();
  showAuth();
}

function clearTimers() {
  if (state.sideRefreshTimer) {
    window.clearInterval(state.sideRefreshTimer);
    state.sideRefreshTimer = null;
  }

  if (state.roundPollTimer) {
    window.clearInterval(state.roundPollTimer);
    state.roundPollTimer = null;
  }

  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
}

function toggleSound() {
  state.soundEnabled = !state.soundEnabled;
  elements.soundToggle.textContent = state.soundEnabled ? "Son ON" : "Son OFF";
  showToast(
    state.soundEnabled ? "Theme sonore active." : "Theme sonore coupe.",
    "info",
  );
}

function buildChipRow() {
  elements.chipRow.innerHTML = CHIP_VALUES.map(
    (value) => `
      <button
        class="chip-button ${state.selectedChip === value ? "active" : ""}"
        data-chip-value="${value}"
        type="button"
      >
        ${value.toLocaleString("fr-FR")}
      </button>
    `,
  ).join("");

  elements.chipRow.querySelectorAll("[data-chip-value]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedChip = Number(button.dataset.chipValue);
      buildChipRow();
    });
  });
}

function buildNumberGrid() {
  const buttons = [];
  for (let number = 0; number <= 36; number += 1) {
    const color = number === 0 ? "green" : RED_NUMBERS.has(number) ? "red" : "black";
    buttons.push(`
      <button
        class="number-button ${color}"
        data-bet-type="number"
        data-bet-value="${number}"
        type="button"
      >
        ${number}
      </button>
    `);
  }

  elements.numberGrid.innerHTML = buttons.join("");
}

function coerceBetValue(type, value) {
  if (type === "number" || type === "dozen") {
    return Number(value);
  }

  return value;
}

function betKey(type, value) {
  return `${type}:${value}`;
}

function describeBet(type, value) {
  if (type === "color") {
    return value === "red" ? "Rouge" : "Noir";
  }

  if (type === "number") {
    return `Numero ${value}`;
  }

  if (type === "parity") {
    return value === "even" ? "Pair" : "Impair";
  }

  if (type === "range") {
    return value === "manque" ? "Manque 1-18" : "Passe 19-36";
  }

  if (type === "dozen") {
    return `${value}e douzaine`;
  }

  return `${type}:${value}`;
}

function emptyPendingTicket(roundId) {
  return {
    roundId: roundId || null,
    bets: [],
    totalBet: 0,
    isSubmitted: false,
    submittedAt: null,
  };
}

function replaceBetSlip(bets) {
  state.betSlip.clear();
  for (const bet of bets) {
    state.betSlip.set(betKey(bet.type, bet.value), {
      type: bet.type,
      value: bet.value,
      amount: Number(bet.amount),
    });
  }
  renderBetSlip();
}

function addBet(type, value) {
  if (!state.me) {
    showToast("Connecte-toi d'abord pour preparer un ticket.", "error");
    return;
  }

  const key = betKey(type, value);
  const existing = state.betSlip.get(key);
  const amount = (existing?.amount || 0) + state.selectedChip;

  state.betSlip.set(key, { type, value, amount });
  renderBetSlip();
}

function clearBets() {
  state.betSlip.clear();
  renderBetSlip();
}

function getSerializedSlip() {
  return Array.from(state.betSlip.values()).map((bet) => ({
    type: bet.type,
    value: bet.value,
    amount: bet.amount,
  }));
}

function getSlipTotal() {
  return getSerializedSlip().reduce((total, bet) => total + bet.amount, 0);
}

function renderBetSlip() {
  const bets = getSerializedSlip();
  elements.ticketTotal.textContent = formatKamas(getSlipTotal());

  if (!bets.length) {
    elements.betSlip.innerHTML = `
      <div class="empty-state">
        Choisis un jeton puis prepare ton ticket pour la prochaine manche.
      </div>
    `;
    return;
  }

  elements.betSlip.innerHTML = bets
    .map((bet) => {
      const key = betKey(bet.type, bet.value);
      return `
        <div class="bet-item">
          <div>
            <strong>${escapeHtml(describeBet(bet.type, bet.value))}</strong>
            <div class="bet-meta">${formatKamas(bet.amount)}</div>
          </div>
          <button class="ghost-button" data-remove-bet="${escapeHtml(key)}" type="button">
            Retirer
          </button>
        </div>
      `;
    })
    .join("");
}

function renderMetrics() {
  elements.balanceValue.textContent = formatKamas(state.me?.balance);
  elements.jackpotValue.textContent = formatKamas(state.bootstrap?.jackpotPool);
  elements.levelValue.textContent = String(state.me?.level || 1);
  elements.profitValue.textContent = formatKamas(state.me?.totalProfit || 0);
}

function renderRoundPanel() {
  const currentRound = state.bootstrap?.currentRound;
  const pendingTicket = state.pendingTicket || emptyPendingTicket(currentRound?.id);

  elements.confirmedTicketValue.textContent = formatKamas(pendingTicket.totalBet || 0);

  if (!currentRound) {
    elements.roundLabel.textContent = "--";
    elements.roundTimerValue.textContent = "--:--";
    elements.roundStatusValue.textContent = "En attente";
    return;
  }

  elements.roundLabel.textContent = `#${currentRound.roundKey}`;
  elements.roundTimerValue.textContent = formatCountdown(
    currentRound.secondsUntilLock ?? currentRound.secondsUntilClose ?? 0,
  );

  if (currentRound.acceptingBets) {
    elements.roundStatusValue.textContent = pendingTicket.isSubmitted
      ? "Ticket en attente"
      : "Mises ouvertes";
  } else if (currentRound.status === "open") {
    elements.roundStatusValue.textContent = "Tirage imminent";
  } else if (currentRound.status === "resolved") {
    elements.roundStatusValue.textContent = "Manche resolue";
  } else {
    elements.roundStatusValue.textContent = "Tirage en cours";
  }
}

function renderLastNumbers(numbers) {
  if (!numbers?.length) {
    elements.lastNumbers.innerHTML = `<span class="status-pill">Aucune manche resolue</span>`;
    return;
  }

  elements.lastNumbers.innerHTML = numbers
    .map(
      (entry) => `
        <span class="number-pill ${entry.resultColor}">
          ${entry.resultNumber}
        </span>
      `,
    )
    .join("");
}

function renderHistory(history) {
  if (!history?.length) {
    elements.historyList.innerHTML = `<div class="empty-state">Aucune mise enregistree pour l'instant.</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(describeBet(item.betType, item.betValue))}</strong>
            <div class="history-meta">
              Resultat ${item.resultNumber} - ${formatDate(item.createdAt)}
            </div>
          </div>
          <div>
            <div class="history-number ${item.resultColor}">${item.resultNumber}</div>
            <div class="${item.didWin ? "result-positive" : "result-negative"}">
              ${item.didWin ? "+" : ""}${Number(item.netResult).toLocaleString("fr-FR")} kamas
            </div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderLeaderboard(leaderboard) {
  if (!leaderboard?.length) {
    elements.leaderboardList.innerHTML = `<div class="empty-state">Le classement se remplit...</div>`;
    return;
  }

  elements.leaderboardList.innerHTML = leaderboard
    .map(
      (entry, index) => `
        <div class="leaderboard-item">
          <div>
            <strong>#${index + 1} ${escapeHtml(entry.username)}</strong>
            <div class="bet-meta">
              Profit ${formatKamas(entry.totalProfit)} - Solde ${formatKamas(entry.balance)}
            </div>
          </div>
          <span>${formatKamas(entry.highestWin)}</span>
        </div>
      `,
    )
    .join("");
}

function renderNotifications(notifications) {
  if (!notifications?.length) {
    elements.notificationList.innerHTML = `<div class="empty-state">Pas de notification.</div>`;
    return;
  }

  elements.notificationList.innerHTML = notifications
    .map(
      (item) => `
        <div class="notification-item">
          <div>
            <strong>${escapeHtml(item.type.toUpperCase())}</strong>
            <div class="bet-meta">${escapeHtml(item.message)}</div>
          </div>
          <span>${formatDate(item.createdAt)}</span>
        </div>
      `,
    )
    .join("");
}

function renderStats(stats) {
  const entries = [
    ["Manches jouees", stats?.spinsPlayed || 0],
    ["Manches gagnees", stats?.winningSpins || 0],
    ["Win rate", `${stats?.winRate || 0}%`],
    ["ROI", `${stats?.roi || 0}%`],
    ["Bet favori", stats?.favoriteBetType || "Aucune"],
    ["House edge", `${state.bootstrap?.roulette?.houseEdgePercent || 2}%`],
  ];

  elements.statsGrid.innerHTML = entries
    .map(
      ([label, value]) => `
        <div class="stats-card">
          <span>${escapeHtml(String(label))}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `,
    )
    .join("");
}

function renderChat(messages) {
  if (!messages?.length) {
    elements.chatMessages.innerHTML = `<div class="empty-state">La table est silencieuse.</div>`;
    return;
  }

  elements.chatMessages.innerHTML = messages
    .map(
      (message) => `
        <div class="chat-item">
          <strong>${escapeHtml(message.username)}</strong>
          <div>${escapeHtml(message.message)}</div>
          <div class="chat-meta">${formatDate(message.createdAt)}</div>
        </div>
      `,
    )
    .join("");

  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function renderProbabilityCards(probabilities) {
  elements.probabilityCards.innerHTML = probabilities
    .map(
      (item) => `
        <div class="probability-card">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.probability}%</strong>
          <span>Payout total x${item.totalReturnMultiplier}</span>
        </div>
      `,
    )
    .join("");
}

function updateSpinButtons() {
  const roundAcceptingBets = Boolean(state.bootstrap?.currentRound?.acceptingBets);

  elements.spinButton.disabled =
    !state.me ||
    !roundAcceptingBets ||
    state.isSubmittingTicket ||
    state.isAnimatingRound ||
    state.autoQueue.active;
  elements.clearBetsButton.disabled = state.isSubmittingTicket || state.isAnimatingRound;
  elements.cancelTicketButton.disabled =
    !roundAcceptingBets ||
    !state.pendingTicket?.isSubmitted ||
    state.isSubmittingTicket ||
    state.isAnimatingRound;
  elements.autoSpinButton.disabled = state.isSubmittingTicket || state.isAnimatingRound;
  elements.stopAutoSpinButton.disabled = !state.autoQueue.active;

  elements.autoSpinButton.textContent = state.autoQueue.active
    ? `Auto (${state.autoQueue.remaining})`
    : "Demarrer";
}

async function submitCurrentTicket() {
  await submitTicket(getSerializedSlip());
}

async function submitTicket(bets, options = {}) {
  if (!bets.length) {
    showToast("Ton brouillon est vide.", "error");
    return false;
  }

  if (state.isSubmittingTicket || state.isAnimatingRound) {
    return false;
  }

  state.isSubmittingTicket = true;
  updateSpinButtons();

  try {
    const payload = await api("/api/game/ticket", {
      method: "POST",
      body: JSON.stringify({ bets }),
    });

    state.me = payload.user;
    state.pendingTicket = payload.pendingTicket || emptyPendingTicket(payload.currentRound?.id);
    state.bootstrap = {
      ...state.bootstrap,
      currentRound: payload.currentRound,
      jackpotPool: state.bootstrap?.jackpotPool,
      notifications: payload.notifications || state.bootstrap?.notifications || [],
      lastNumbers: payload.lastNumbers || state.bootstrap?.lastNumbers || [],
    };

    renderMetrics();
    renderRoundPanel();
    renderNotifications(payload.notifications || []);
    renderLastNumbers(payload.lastNumbers || state.bootstrap.lastNumbers || []);
    updateSpinButtons();

    if (options.showToast !== false) {
      showToast(payload.message, "success");
    }

    return true;
  } catch (error) {
    if (options.showToast !== false) {
      showToast(error.message, "error");
    }
    if (options.stopAutoOnError !== false) {
      stopAutoQueue();
    }
    return false;
  } finally {
    state.isSubmittingTicket = false;
    updateSpinButtons();
  }
}

async function cancelTicket() {
  if (state.isSubmittingTicket || state.isAnimatingRound) {
    return;
  }

  state.isSubmittingTicket = true;
  updateSpinButtons();

  try {
    const payload = await api("/api/game/ticket", {
      method: "DELETE",
    });

    state.me = payload.user;
    state.pendingTicket = payload.pendingTicket || emptyPendingTicket(payload.currentRound?.id);
    state.bootstrap = {
      ...state.bootstrap,
      currentRound: payload.currentRound,
      notifications: payload.notifications || [],
    };

    renderMetrics();
    renderRoundPanel();
    renderNotifications(payload.notifications || []);
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingTicket = false;
    updateSpinButtons();
  }
}

function startAutoQueue() {
  const rounds = Number.parseInt(elements.autoSpinRounds.value, 10) || 0;
  const template = getSerializedSlip();

  if (!template.length) {
    showToast("Prepare un brouillon avant de lancer l'auto inscription.", "error");
    return;
  }

  if (rounds < 1 || rounds > (state.bootstrap?.roulette?.autoSpinMaxRounds || 25)) {
    showToast("Nombre de manches auto invalide.", "error");
    return;
  }

  state.autoQueue.active = true;
  state.autoQueue.remaining = rounds;
  state.autoQueue.template = template.map((bet) => ({ ...bet }));
  updateSpinButtons();
  maybeSubmitAutoTicket();
}

function stopAutoQueue(showNotice = false) {
  const wasActive = state.autoQueue.active;
  state.autoQueue.active = false;
  state.autoQueue.remaining = 0;
  state.autoQueue.template = [];
  updateSpinButtons();

  if (showNotice && wasActive) {
    showToast("Auto inscription terminee.", "success");
  }
}

async function maybeSubmitAutoTicket() {
  if (!state.autoQueue.active || state.autoQueue.remaining <= 0) {
    if (state.autoQueue.active) {
      stopAutoQueue(true);
    }
    return;
  }

  if (state.isSubmittingTicket || state.isAnimatingRound) {
    return;
  }

  const currentRound = state.bootstrap?.currentRound;
  if (!currentRound?.acceptingBets) {
    return;
  }

  if (state.pendingTicket?.isSubmitted && state.pendingTicket.roundId === currentRound.id) {
    return;
  }

  const templateTotal = state.autoQueue.template.reduce(
    (sum, bet) => sum + Number(bet.amount),
    0,
  );

  if ((state.me?.balance || 0) < templateTotal) {
    showToast("Solde insuffisant pour continuer l'auto inscription.", "error");
    stopAutoQueue();
    return;
  }

  const success = await submitTicket(state.autoQueue.template, {
    showToast: state.autoQueue.remaining === 1,
    stopAutoOnError: true,
  });

  if (!success) {
    return;
  }

  state.autoQueue.remaining -= 1;
  updateSpinButtons();

  if (state.autoQueue.remaining <= 0) {
    stopAutoQueue(true);
  }
}

async function onChatSubmit(event) {
  event.preventDefault();
  const message = elements.chatInput.value.trim();
  if (!message) {
    return;
  }

  try {
    const payload = await api("/api/game/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    renderChat(payload.chat);
    elements.chatInput.value = "";
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function readAllNotifications() {
  try {
    await api("/api/game/notifications/read-all", { method: "POST" });
    showToast("Notifications mises a jour.", "success");
    const freshNotifications = await api("/api/game/notifications");
    renderNotifications(freshNotifications.notifications);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function resetSideRefresh() {
  if (state.sideRefreshTimer) {
    window.clearInterval(state.sideRefreshTimer);
  }

  state.sideRefreshTimer = window.setInterval(async () => {
    if (!state.me) {
      return;
    }

    try {
      const [chatPayload, notificationsPayload, leaderboardPayload] = await Promise.all([
        api("/api/game/chat"),
        api("/api/game/notifications"),
        api("/api/game/leaderboard"),
      ]);

      renderChat(chatPayload.chat);
      renderNotifications(notificationsPayload.notifications);
      renderLeaderboard(leaderboardPayload.leaderboard);
    } catch (_error) {
      // Le prochain cycle tentera de recuperer les donnees.
    }
  }, 15000);
}

function resetRoundTimers() {
  if (state.roundPollTimer) {
    window.clearInterval(state.roundPollTimer);
  }

  if (state.countdownTimer) {
    window.clearInterval(state.countdownTimer);
  }

  state.roundPollTimer = window.setInterval(() => {
    pollRoundState();
  }, 3000);

  state.countdownTimer = window.setInterval(() => {
    tickRoundCountdown();
  }, 1000);
}

function tickRoundCountdown() {
  const currentRound = state.bootstrap?.currentRound;
  if (!currentRound) {
    renderRoundPanel();
    return;
  }

  const secondsLeft = Math.max(
    0,
    (currentRound.secondsUntilLock || 0) - 1,
  );

  currentRound.secondsUntilLock = secondsLeft;
  currentRound.secondsUntilClose = Math.max(
    0,
    (currentRound.secondsUntilClose || 0) - 1,
  );

  if (secondsLeft === 0) {
    currentRound.acceptingBets = false;
  }

  renderRoundPanel();
  updateSpinButtons();
}

async function pollRoundState() {
  if (!state.me || state.isRoundPollInFlight) {
    return;
  }

  state.isRoundPollInFlight = true;

  try {
    const payload = await api("/api/game/round-state");
    await handleRoundState(payload);
  } catch (_error) {
    // Le prochain cycle reessaiera.
  } finally {
    state.isRoundPollInFlight = false;
  }
}

async function handleRoundState(payload) {
  state.me = payload.user;
  state.pendingTicket = payload.pendingTicket || emptyPendingTicket(payload.currentRound?.id);
  state.bootstrap = {
    ...state.bootstrap,
    currentRound: payload.currentRound,
    pendingTicket: state.pendingTicket,
    latestResolvedRound: payload.latestResolvedRound,
    latestPlayerSpin: payload.latestPlayerSpin,
    jackpotPool: payload.jackpotPool,
    lastNumbers: payload.lastNumbers,
    serverTime: payload.serverTime,
  };

  renderMetrics();
  renderRoundPanel();
  renderLastNumbers(payload.lastNumbers);
  updateSpinButtons();

  if (
    payload.latestResolvedRound &&
    payload.latestResolvedRound.id > (state.lastAnimatedRoundId || 0)
  ) {
    await onRoundResolved(payload.latestResolvedRound, payload.latestPlayerSpin);
    return;
  }

  await maybeSubmitAutoTicket();
}

async function onRoundResolved(round, playerSpin) {
  if (state.isAnimatingRound) {
    return;
  }

  state.isAnimatingRound = true;
  state.lastAnimatedRoundId = round.id;
  updateSpinButtons();

  try {
    if (state.soundEnabled) {
      state.audio.spin().catch(() => {});
    }

    await animateWheel(round.winningPocketIndex);

    if (playerSpin) {
      openResultModal(round, playerSpin);

      if (state.soundEnabled) {
        if (playerSpin.jackpotWin > 0) {
          state.audio.jackpot().catch(() => {});
        } else if (playerSpin.netResult >= 0) {
          state.audio.win().catch(() => {});
        } else {
          state.audio.lose().catch(() => {});
        }
      }

      showToast(
        playerSpin.netResult >= 0
          ? `Round gagne: ${formatKamas(playerSpin.netResult)}`
          : `Round termine: ${formatKamas(playerSpin.netResult)}`,
        playerSpin.netResult >= 0 ? "success" : "info",
      );
    } else {
      showToast(
        `Round #${round.roundKey}: ${round.resultNumber} ${formatRoundColor(round.resultColor)}`,
        "info",
      );
    }

    await loadBootstrap({ seedSlip: false });
    await maybeSubmitAutoTicket();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isAnimatingRound = false;
    updateSpinButtons();
  }
}

function formatRoundColor(color) {
  if (color === "green") {
    return "Vert";
  }

  if (color === "red") {
    return "Rouge";
  }

  return "Noir";
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function drawWheel(rotation = state.wheelRotation) {
  const canvas = elements.rouletteCanvas;
  const context = canvas.getContext("2d");
  const size = canvas.width;
  const center = size / 2;
  const radius = center - 28;
  const pocketCount = 37;
  const angleSize = (Math.PI * 2) / pocketCount;

  context.clearRect(0, 0, size, size);
  context.save();
  context.translate(center, center);

  context.beginPath();
  context.arc(0, 0, radius + 16, 0, Math.PI * 2);
  context.fillStyle = "#4b2b0f";
  context.fill();

  for (let index = 0; index < pocketCount; index += 1) {
    const number = state.bootstrap?.roulette?.wheelOrder?.[index] ?? defaultWheelOrder()[index];
    const color = number === 0 ? "#11b87e" : RED_NUMBERS.has(number) ? "#d8304c" : "#121215";
    const startAngle = -Math.PI / 2 + rotation + index * angleSize - angleSize / 2;
    const endAngle = startAngle + angleSize;

    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius, startAngle, endAngle);
    context.closePath();
    context.fillStyle = color;
    context.fill();

    context.strokeStyle = "rgba(255, 214, 144, 0.32)";
    context.lineWidth = 2;
    context.stroke();

    context.save();
    context.rotate(startAngle + angleSize / 2);
    context.translate(0, -radius + 42);
    context.rotate(Math.PI / 2);
    context.fillStyle = "#fff4df";
    context.font = "700 20px Trebuchet MS";
    context.textAlign = "center";
    context.fillText(String(number), 0, 8);
    context.restore();
  }

  context.beginPath();
  context.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
  context.fillStyle = "#2a1218";
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = "rgba(255, 214, 144, 0.55)";
  context.stroke();

  context.restore();
}

function defaultWheelOrder() {
  return [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
  ];
}

function modAngle(angle) {
  return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function animateWheel(targetIndex) {
  return new Promise((resolve) => {
    const pocketCount = 37;
    const angleSize = (Math.PI * 2) / pocketCount;
    const currentAngle = modAngle(state.wheelRotation);
    const desiredAngle = modAngle(-targetIndex * angleSize);
    const delta = modAngle(desiredAngle - currentAngle);
    const startRotation = state.wheelRotation;
    const finalRotation = state.wheelRotation + Math.PI * 2 * 6 + delta;
    const duration = 5200;
    const start = performance.now();

    function step(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      state.wheelRotation = startRotation + (finalRotation - startRotation) * eased;
      drawWheel(state.wheelRotation);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        state.wheelRotation = modAngle(finalRotation);
        drawWheel(state.wheelRotation);
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function openResultModal(round, playerSpin) {
  elements.resultTitle.textContent =
    playerSpin.jackpotWin > 0
      ? "Jackpot sur le 0 !"
      : playerSpin.netResult >= 0
        ? "Victoire"
        : "Defaite";
  elements.resultSubtitle.textContent = `La manche #${round.roundKey} tombe sur le ${round.resultNumber} ${formatRoundColor(round.resultColor)}.`;
  elements.resultMeta.innerHTML = `
    <div class="result-row">
      <span>Total mise</span>
      <strong>${formatKamas(playerSpin.totalBet)}</strong>
    </div>
    <div class="result-row">
      <span>Total retour</span>
      <strong>${formatKamas(playerSpin.totalPayout + playerSpin.jackpotWin)}</strong>
    </div>
    <div class="result-row">
      <span>Net de la manche</span>
      <strong class="${playerSpin.netResult >= 0 ? "result-positive" : "result-negative"}">
        ${playerSpin.netResult >= 0 ? "+" : ""}${formatKamas(playerSpin.netResult)}
      </strong>
    </div>
  `;
  elements.resultModal.classList.remove("hidden");
}
