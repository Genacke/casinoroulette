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

const CHIP_VALUES = [200000, 500000, 1000000, 2000000, 5000000];
const DEFAULT_PROBABILITIES = [
  { type: "number", label: "Numero exact", probability: 2.7, totalReturnMultiplier: 36.26 },
  { type: "color", label: "Rouge / Noir", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "parity", label: "Pair / Impair", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "range", label: "Manque / Passe", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "dozen", label: "Douzaine", probability: 32.43, totalReturnMultiplier: 3.02 },
];

const state = {
  me: null,
  bootstrap: null,
  selectedChip: 200000,
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
  cashoutRequests: [],
  pendingCashoutRequest: null,
  isSubmittingCashout: false,
  activeView: "roulette",
  selectedPokerTableSlug: null,
  poker: null,
  isLoadingPokerView: false,
  isSubmittingPokerAction: false,
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
    betRulesSummary: document.getElementById("betRulesSummary"),
    betSlip: document.getElementById("betSlip"),
    cancelTicketButton: document.getElementById("cancelTicketButton"),
    cashoutAmount: document.getElementById("cashoutAmount"),
    cashoutNote: document.getElementById("cashoutNote"),
    cashoutRequestForm: document.getElementById("cashoutRequestForm"),
    cashoutRequestsList: document.getElementById("cashoutRequestsList"),
    cashoutSubmitButton: document.getElementById("cashoutSubmitButton"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    chatMessages: document.getElementById("chatMessages"),
    chipRow: document.getElementById("chipRow"),
    clearBetsButton: document.getElementById("clearBetsButton"),
    closeResultModal: document.getElementById("closeResultModal"),
    confirmedTicketValue: document.getElementById("confirmedTicketValue"),
    greenMaxValue: document.getElementById("greenMaxValue"),
    historyList: document.getElementById("historyList"),
    lastNumbers: document.getElementById("lastNumbers"),
    leaderboardList: document.getElementById("leaderboardList"),
    loginForm: document.getElementById("loginForm"),
    logoutButton: document.getElementById("logoutButton"),
    minBetValue: document.getElementById("minBetValue"),
    notificationList: document.getElementById("notificationList"),
    numberGrid: document.getElementById("numberGrid"),
    playerApp: document.getElementById("playerApp"),
    probabilityCards: document.getElementById("probabilityCards"),
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
    ticketMaxValue: document.getElementById("ticketMaxValue"),
    ticketTotal: document.getElementById("ticketTotal"),
    pendingCashoutCard: document.getElementById("pendingCashoutCard"),
    viewPokerButton: document.getElementById("viewPokerButton"),
    viewRouletteButton: document.getElementById("viewRouletteButton"),
    rouletteView: document.getElementById("rouletteView"),
    pokerView: document.getElementById("pokerView"),
    joinPokerButton: document.getElementById("joinPokerButton"),
    leavePokerButton: document.getElementById("leavePokerButton"),
    pokerActionHint: document.getElementById("pokerActionHint"),
    pokerActionLog: document.getElementById("pokerActionLog"),
    pokerBigBlindValue: document.getElementById("pokerBlindValue"),
    pokerBlindValue: document.getElementById("pokerBlindValue"),
    pokerBoard: document.getElementById("pokerBoard"),
    pokerBuyInValue: document.getElementById("pokerBuyInValue"),
    pokerCheckCallButton: document.getElementById("pokerCheckCallButton"),
    pokerFoldButton: document.getElementById("pokerFoldButton"),
    pokerHeroCards: document.getElementById("pokerHeroCards"),
    pokerJoinState: document.getElementById("pokerJoinState"),
    pokerMeStatus: document.getElementById("pokerMeStatus"),
    pokerPhaseValue: document.getElementById("pokerPhaseValue"),
    pokerPlayersNeeded: document.getElementById("pokerPlayersNeeded"),
    pokerPotValue: document.getElementById("pokerPotValue"),
    pokerRaiseAmount: document.getElementById("pokerRaiseAmount"),
    pokerRaiseButton: document.getElementById("pokerRaiseButton"),
    pokerSeatGrid: document.getElementById("pokerSeatGrid"),
    pokerStatusValue: document.getElementById("pokerStatusValue"),
    pokerTableDescription: document.getElementById("pokerTableDescription"),
    pokerTableList: document.getElementById("pokerTableList"),
    pokerTableTitle: document.getElementById("pokerTableTitle"),
    pokerTableVibe: document.getElementById("pokerTableVibe"),
    pokerTurnValue: document.getElementById("pokerTurnValue"),
    pokerWinnerSummary: document.getElementById("pokerWinnerSummary"),
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
  elements.cashoutRequestForm.addEventListener("submit", onCashoutRequest);
  elements.spinButton.addEventListener("click", submitCurrentTicket);
  elements.autoSpinButton.addEventListener("click", startAutoQueue);
  elements.stopAutoSpinButton.addEventListener("click", stopAutoQueue);
  elements.closeResultModal.addEventListener("click", () => {
    elements.resultModal.classList.add("hidden");
  });
  elements.chatForm.addEventListener("submit", onChatSubmit);
  elements.readNotificationsButton.addEventListener("click", readAllNotifications);
  elements.viewRouletteButton.addEventListener("click", () => setActiveView("roulette"));
  elements.viewPokerButton.addEventListener("click", () => setActiveView("poker"));
  elements.joinPokerButton.addEventListener("click", joinPokerTable);
  elements.leavePokerButton.addEventListener("click", leavePokerTable);
  elements.pokerFoldButton.addEventListener("click", () => submitPokerAction("fold"));
  elements.pokerCheckCallButton.addEventListener("click", onPokerPrimaryAction);
  elements.pokerRaiseButton.addEventListener("click", onPokerRaise);
  elements.pokerTableList.addEventListener("click", (event) => {
    const selector = event.target.closest("[data-select-poker-table]");
    if (!selector) {
      return;
    }

    selectPokerTable(selector.dataset.selectPokerTable);
  });
  elements.pendingCashoutCard.addEventListener("click", (event) => {
    if (event.target.closest("[data-cancel-cashout]")) {
      cancelPendingCashoutRequest();
    }
  });

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
  const payload = await api(`/api/game/bootstrap${pokerTableQuery()}`);
  applyBootstrap(payload, options);
}

function applyBootstrap(payload, options = {}) {
  state.bootstrap = payload;
  state.me = payload.user;
  state.pendingTicket = payload.pendingTicket || emptyPendingTicket(payload.currentRound?.id);
  state.cashoutRequests = payload.cashoutRequests || [];
  state.poker = payload.poker || null;
  state.selectedPokerTableSlug =
    payload.poker?.selectedTableSlug || state.selectedPokerTableSlug || null;
  state.pendingCashoutRequest =
    payload.pendingCashoutRequest ||
    state.cashoutRequests.find((request) => request.status === "pending") ||
    null;

  if (state.lastAnimatedRoundId === null) {
    state.lastAnimatedRoundId = payload.latestResolvedRound?.id || 0;
  }

  if (options.seedSlip && !state.betSlip.size && state.pendingTicket.bets?.length) {
    replaceBetSlip(state.pendingTicket.bets);
  }

  renderMetrics();
  renderBetRulesSummary();
  renderRoundPanel();
  renderLastNumbers(payload.lastNumbers);
  renderHistory(payload.history);
  renderLeaderboard(payload.leaderboard);
  renderNotifications(payload.notifications);
  renderStats(payload.stats);
  renderChat(payload.chat);
  renderCashoutSection();
  renderPoker();
  renderProbabilityCards(payload.roulette?.probabilities || DEFAULT_PROBABILITIES);
  syncAdminShortcut();
  renderBetSlip();
  updateSpinButtons();
  setActiveView(options.activeView || state.activeView);
  resetRoundTimers();
  resetSideRefresh();
}

function showApp() {
  elements.authGate.classList.add("hidden");
  elements.playerApp.classList.remove("hidden");
  elements.logoutButton.classList.remove("hidden");
  setActiveView(state.activeView);
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
  state.cashoutRequests = [];
  state.pendingCashoutRequest = null;
  state.isSubmittingCashout = false;
  state.selectedPokerTableSlug = null;
  state.poker = null;
  state.isLoadingPokerView = false;
  state.activeView = "roulette";
  state.isSubmittingPokerAction = false;
  elements.cashoutRequestForm.reset();
  renderBetSlip();
  renderCashoutSection();
  renderPoker();
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

function getPendingCashoutRequest() {
  return (
    state.pendingCashoutRequest ||
    state.cashoutRequests.find((request) => request.status === "pending") ||
    null
  );
}

function getRouletteRules() {
  return state.bootstrap?.roulette || {};
}

function getMinBet() {
  return Number(getRouletteRules().minBet || 200000);
}

function getTicketMax() {
  return Number(getRouletteRules().maxBet || 10000000);
}

function getGreenMaxBet() {
  return Number(getRouletteRules().greenMaxBet || 1000000);
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
  const nextTicketTotal = getSlipTotal() + state.selectedChip;

  if (nextTicketTotal > getTicketMax()) {
    showToast(
      `Le ticket ne peut pas depasser ${formatKamas(getTicketMax())}.`,
      "error",
    );
    return;
  }

  if (type === "number" && Number(value) === 0) {
    const currentGreenTotal = getSerializedSlip()
      .filter((bet) => bet.type === "number" && Number(bet.value) === 0)
      .reduce((sum, bet) => sum + bet.amount, 0);

    if (currentGreenTotal + state.selectedChip > getGreenMaxBet()) {
      showToast(
        `La mise totale sur le 0 est limitee a ${formatKamas(getGreenMaxBet())}.`,
        "error",
      );
      return;
    }
  }

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
        Choisis un jeton et monte ton ticket pour la prochaine manche.
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

function formatCashoutStatus(status) {
  if (status === "completed") {
    return "Validee";
  }

  if (status === "rejected") {
    return "Refusee";
  }

  if (status === "cancelled") {
    return "Annulee";
  }

  return "En attente";
}

function renderCashoutSection() {
  const pendingRequest = getPendingCashoutRequest();
  elements.cashoutAmount.max = String(Math.max(0, state.me?.balance || 0));

  if (pendingRequest) {
    elements.pendingCashoutCard.classList.remove("hidden");
    elements.pendingCashoutCard.innerHTML = `
      <div class="cashout-status-head">
        <strong>Demande en attente</strong>
        <span class="status-pill">${formatKamas(pendingRequest.amount)}</span>
      </div>
      <div class="bet-meta">Envoyee le ${formatDate(pendingRequest.createdAt)}</div>
      <div class="bet-meta">
        Commission ${pendingRequest.feePercent}%: ${formatKamas(pendingRequest.feeAmount)} - net ${formatKamas(pendingRequest.netAmount)}
      </div>
      ${
        pendingRequest.note
          ? `<div class="bet-meta">Note: ${escapeHtml(pendingRequest.note)}</div>`
          : ""
      }
      <button class="ghost-button full-width" data-cancel-cashout type="button">
        Annuler la demande
      </button>
    `;
  } else {
    elements.pendingCashoutCard.classList.add("hidden");
    elements.pendingCashoutCard.innerHTML = "";
  }

  if (!state.cashoutRequests.length) {
    elements.cashoutRequestsList.innerHTML = `
      <div class="empty-state">Aucune demande de retrait pour l'instant.</div>
    `;
  } else {
    elements.cashoutRequestsList.innerHTML = state.cashoutRequests
      .map(
        (request) => `
          <div class="cashout-request-item">
            <div class="cashout-status-head">
              <strong>${formatKamas(request.amount)}</strong>
              <span class="cashout-status status-${escapeHtml(request.status)}">
                ${escapeHtml(formatCashoutStatus(request.status))}
              </span>
            </div>
            <div class="bet-meta">Demande: ${formatDate(request.createdAt)}</div>
            <div class="bet-meta">
              Brut ${formatKamas(request.amount)} - commission ${formatKamas(request.feeAmount)} - net ${formatKamas(request.netAmount)}
            </div>
            ${
              request.processedAt
                ? `<div class="bet-meta">Traitee: ${formatDate(request.processedAt)}</div>`
                : ""
            }
            ${
              request.cancelledAt
                ? `<div class="bet-meta">Annulee: ${formatDate(request.cancelledAt)}</div>`
                : ""
            }
            ${
              request.note
                ? `<div class="bet-meta">Note joueur: ${escapeHtml(request.note)}</div>`
                : ""
            }
            ${
              request.adminNote
                ? `<div class="bet-meta">Retour staff: ${escapeHtml(request.adminNote)}</div>`
                : ""
            }
          </div>
        `,
      )
      .join("");
  }

  updateCashoutControls();
}

function updateCashoutControls() {
  const pendingRequest = getPendingCashoutRequest();
  const shouldDisableForm =
    !state.me ||
    Boolean(pendingRequest) ||
    state.isSubmittingCashout ||
    state.isSubmittingTicket ||
    state.isAnimatingRound;

  elements.cashoutAmount.disabled = shouldDisableForm;
  elements.cashoutNote.disabled = shouldDisableForm;
  elements.cashoutSubmitButton.disabled =
    shouldDisableForm || Number(state.me?.balance || 0) <= 0;
  elements.cashoutSubmitButton.textContent = pendingRequest
    ? "Retrait en attente"
    : "Demande de retrait";
}

function renderMetrics() {
  elements.balanceValue.textContent = formatKamas(state.me?.balance);
  elements.minBetValue.textContent = formatKamas(getMinBet());
  elements.ticketMaxValue.textContent = formatKamas(getTicketMax());
  elements.greenMaxValue.textContent = formatKamas(getGreenMaxBet());
}

function renderBetRulesSummary() {
  elements.betRulesSummary.innerHTML = `
    <span>Mise mini ${formatKamas(getMinBet())}</span>
    <span>Ticket max ${formatKamas(getTicketMax())}</span>
    <span>0 limite a ${formatKamas(getGreenMaxBet())}</span>
  `;
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
    .slice(0, 8)
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
    ["Profit total", formatKamas(state.me?.totalProfit || 0)],
    ["Bet favori", stats?.favoriteBetType || "Aucune"],
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
        <span class="probability-pill">${escapeHtml(describeProbability(item.type))} ${item.probability}%</span>
      `,
    )
    .join("");
}

function describeProbability(type) {
  if (type === "number") {
    return "N exact";
  }

  if (type === "color") {
    return "Rouge/Noir";
  }

  if (type === "parity") {
    return "Pair/Impair";
  }

  if (type === "range") {
    return "1-18/19-36";
  }

  if (type === "dozen") {
    return "Douzaine";
  }

  return type;
}

function setActiveView(view) {
  state.activeView = view === "poker" ? "poker" : "roulette";
  elements.viewRouletteButton.classList.toggle("active", state.activeView === "roulette");
  elements.viewPokerButton.classList.toggle("active", state.activeView === "poker");
  elements.rouletteView.classList.toggle("hidden", state.activeView !== "roulette");
  elements.pokerView.classList.toggle("hidden", state.activeView !== "poker");
}

function getPokerState() {
  return state.poker || state.bootstrap?.poker || null;
}

function getSelectedPokerTableSlug() {
  return (
    state.selectedPokerTableSlug ||
    state.poker?.selectedTableSlug ||
    state.bootstrap?.poker?.selectedTableSlug ||
    ""
  );
}

function pokerTableQuery(tableSlug = getSelectedPokerTableSlug()) {
  return tableSlug ? `?table=${encodeURIComponent(tableSlug)}` : "";
}

function formatPokerStatus(status) {
  if (status === "playing") {
    return "Main en cours";
  }

  if (status === "showdown") {
    return "Showdown";
  }

  return "En attente";
}

function formatPokerSeatState(seatState) {
  if (seatState === "active") {
    return "En jeu";
  }

  if (seatState === "folded") {
    return "Couche";
  }

  if (seatState === "all_in") {
    return "All-in";
  }

  if (seatState === "busted") {
    return "Broke";
  }

  return "Assis";
}

function renderPokerCard(card, options = {}) {
  const hidden = Boolean(options.hidden);
  const empty = Boolean(options.empty);

  if (hidden) {
    return `<div class="poker-card hidden-card">?</div>`;
  }

  if (empty) {
    return `<div class="poker-card empty-card">--</div>`;
  }

  return `
    <div class="poker-card ${card.color === "red" ? "red" : "black"}">
      <span>${escapeHtml(card.label)}</span>
    </div>
  `;
}

function renderPokerBoard(poker) {
  const cards = poker?.boardCards || [];
  const slots = [];

  for (let index = 0; index < 5; index += 1) {
    const card = cards[index];
    slots.push(renderPokerCard(card, { empty: !card }));
  }

  elements.pokerBoard.innerHTML = slots.join("");
}

function renderPokerLobby(poker) {
  const tables = poker?.lobby || [];

  if (!tables.length) {
    elements.pokerTableList.innerHTML = `
      <div class="empty-state">Les croupiers preparent les tables du salon.</div>
    `;
    return;
  }

  elements.pokerTableList.innerHTML = tables
    .map(
      (table) => `
        <button
          class="poker-table-card ${table.isSelected ? "active" : ""} accent-${escapeHtml(table.accent || "gold")}"
          type="button"
          data-select-poker-table="${escapeHtml(table.slug)}"
        >
          <div class="poker-table-card-head">
            <div>
              <strong>${escapeHtml(table.name)}</strong>
              <div class="bet-meta">${escapeHtml(table.vibe)}</div>
            </div>
            <span class="status-pill">${escapeHtml(table.occupancyLabel)}</span>
          </div>
          <div class="poker-table-card-meta">
            <span>${escapeHtml(table.statusLabel)}</span>
            <span>${formatKamas(table.smallBlind)} / ${formatKamas(table.bigBlind)}</span>
          </div>
          <div class="bet-meta">${escapeHtml(table.description)}</div>
          <div class="poker-table-card-footer">
            <span>Cave ${formatKamas(table.buyIn)}</span>
            <span>${table.isSeated ? "Assis" : table.joinLabel}</span>
          </div>
        </button>
      `,
    )
    .join("");
}

function renderPokerSeats(poker) {
  const seats = poker?.seats || [];

  elements.pokerSeatGrid.innerHTML = seats
    .map((seat) => {
      if (seat.isEmpty) {
        return `
          <article class="poker-seat empty seat-${seat.seatNo}">
            <div class="section-title">Siege ${seat.seatNo}</div>
            <div class="bet-meta">Libre</div>
          </article>
        `;
      }

      const cardsMarkup = seat.holeCards?.length
        ? seat.holeCards.map((card) => renderPokerCard(card)).join("")
        : Array.from({ length: seat.cardsCount || 0 }, () =>
            renderPokerCard(null, { hidden: true }),
          ).join("");

      return `
        <article class="poker-seat seat-${seat.seatNo} ${seat.isTurn ? "turn" : ""} ${seat.isMe ? "me" : ""}">
          <div class="poker-seat-head">
            <strong>${escapeHtml(seat.username)}</strong>
            <span class="status-pill seat-status">${escapeHtml(formatPokerSeatState(seat.seatState))}</span>
          </div>
          <div class="bet-meta">
            Siege ${seat.seatNo}
            ${seat.isDealer ? " | Dealer" : ""}
            ${seat.isSmallBlind ? " | SB" : ""}
            ${seat.isBigBlind ? " | BB" : ""}
          </div>
          <div class="bet-meta">Stack ${formatKamas(seat.stack)}</div>
          <div class="bet-meta">Engage ${formatKamas(seat.handContribution)}</div>
          <div class="poker-seat-cards">${cardsMarkup || '<div class="bet-meta">Cartes cachees</div>'}</div>
        </article>
      `;
    })
    .join("");
}

function seatLabelByNumber(poker, seatNo) {
  return poker?.seats?.find((seat) => !seat.isEmpty && seat.seatNo === seatNo)?.username || `Siege ${seatNo}`;
}

function renderPokerActions(poker) {
  const actions = poker?.actions || {};
  const meSeat = poker?.meSeat;
  const busy = state.isSubmittingPokerAction || state.isLoadingPokerView;

  if (!poker) {
    elements.joinPokerButton.disabled = true;
    elements.joinPokerButton.textContent = "Rejoindre";
    elements.leavePokerButton.disabled = true;
    elements.pokerFoldButton.disabled = true;
    elements.pokerCheckCallButton.disabled = true;
    elements.pokerRaiseButton.disabled = true;
    elements.pokerRaiseAmount.disabled = true;
    elements.pokerMeStatus.textContent = "Table indisponible";
    elements.pokerJoinState.textContent = "Le croupier prepare la table.";
    elements.pokerHeroCards.innerHTML = `<div class="empty-state">Chargement de la table...</div>`;
    elements.pokerActionHint.textContent = "Le croupier prepare la table.";
    return;
  }

  elements.joinPokerButton.disabled = !actions.canJoin || busy;
  elements.leavePokerButton.disabled = !actions.canLeave || busy;
  elements.joinPokerButton.textContent = actions.joinLabel || "Rejoindre";
  elements.pokerFoldButton.disabled = !actions.canFold || busy;
  elements.pokerCheckCallButton.disabled =
    !(actions.canCheck || actions.canCall) || busy;
  elements.pokerRaiseButton.disabled = !actions.canRaise || busy;
  elements.pokerRaiseAmount.disabled = !actions.canRaise || busy;
  elements.pokerRaiseAmount.min = String(actions.minRaiseTo || 0);
  elements.pokerRaiseAmount.max = String(actions.maxRaiseTo || 0);
  if (actions.canRaise && !elements.pokerRaiseAmount.value) {
    elements.pokerRaiseAmount.value = String(actions.minRaiseTo || 0);
  }

  if (!meSeat) {
    elements.pokerMeStatus.textContent = "Pas assis a la table";
    elements.pokerJoinState.textContent = actions.joinReason || "Rejoins la table pour jouer.";
    elements.pokerHeroCards.innerHTML = `
      <div class="empty-state">Rejoins la table avec ${formatKamas(poker.buyIn)} pour jouer des mains Hold'em.</div>
    `;
  } else {
    elements.pokerMeStatus.textContent = `Siege ${meSeat.seatNo} | ${formatPokerSeatState(meSeat.seatState)} | ${formatKamas(meSeat.stack)}`;
    elements.pokerJoinState.textContent =
      actions.leaveReason || actions.joinReason || "Ta place est enregistree.";
    elements.pokerHeroCards.innerHTML = meSeat.holeCards?.length
      ? meSeat.holeCards.map((card) => renderPokerCard(card)).join("")
      : `<div class="empty-state">Tes cartes apparaitront au debut de la prochaine main.</div>`;
  }

  if (actions.canCall) {
    elements.pokerCheckCallButton.textContent = `Call ${formatKamas(actions.callAmount)}`;
  } else {
    elements.pokerCheckCallButton.textContent = "Check";
  }

  if (poker.status === "waiting") {
    elements.pokerActionHint.textContent =
      poker.playersNeeded > 0
        ? `Il faut encore ${poker.playersNeeded} joueur(s) pour lancer une main.`
        : "La prochaine main arrive.";
    return;
  }

  if (poker.status === "showdown") {
    elements.pokerActionHint.textContent = poker.winnerSummary || "Resolution de la main.";
    return;
  }

  if (actions.canAct) {
    elements.pokerActionHint.textContent = `C'est ton tour. Tu as ${poker.secondsToAct}s pour agir.`;
  } else if (poker.activeSeat) {
    elements.pokerActionHint.textContent = `Tour de ${seatLabelByNumber(poker, poker.activeSeat)}.`;
  } else {
    elements.pokerActionHint.textContent = "Le croupier prepare la suite de la main.";
  }
}

function renderPokerLog(logEntries) {
  if (!logEntries?.length) {
    elements.pokerActionLog.innerHTML = `<div class="empty-state">Aucune action enregistree.</div>`;
    return;
  }

  elements.pokerActionLog.innerHTML = logEntries
    .map(
      (entry) => `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(entry.username)}</strong>
            <div class="history-meta">${escapeHtml(entry.actionType)}${entry.details ? ` | ${escapeHtml(entry.details)}` : ""}</div>
          </div>
          <div>
            <div>${entry.amount ? formatKamas(entry.amount) : "-"}</div>
            <div class="history-meta">${formatDate(entry.createdAt)}</div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderPoker() {
  const poker = getPokerState();

  if (!poker) {
    elements.pokerTableTitle.textContent = "Table d'Amakna";
    elements.pokerTableVibe.textContent = "Table centrale";
    elements.pokerTableDescription.textContent = "Chargement du salon poker...";
    elements.pokerBuyInValue.textContent = formatKamas(10000000);
    elements.pokerBlindValue.textContent = "200 000 / 400 000";
    elements.pokerStatusValue.textContent = "En attente";
    elements.pokerPhaseValue.textContent = "--";
    elements.pokerPotValue.textContent = formatKamas(0);
    elements.pokerTurnValue.textContent = "--";
    elements.pokerPlayersNeeded.textContent = "2 joueurs pour lancer";
    elements.pokerWinnerSummary.textContent = "La table attend des aventuriers.";
    elements.pokerJoinState.textContent = "Chargement de la table poker.";
    elements.pokerTableList.innerHTML = `<div class="empty-state">Chargement des tables...</div>`;
    elements.pokerSeatGrid.innerHTML = `<div class="empty-state">Chargement de la table...</div>`;
    elements.pokerActionLog.innerHTML = `<div class="empty-state">Aucune action enregistree.</div>`;
    renderPokerBoard({
      boardCards: [],
    });
    renderPokerActions(null);
    return;
  }

  renderPokerLobby(poker);
  elements.pokerTableTitle.textContent = poker.name;
  elements.pokerTableVibe.textContent = poker.tableVibe || "Table centrale";
  elements.pokerTableDescription.textContent =
    poker.tableDescription || "Le croupier appelle les prochains joueurs.";
  elements.pokerBuyInValue.textContent = formatKamas(poker.buyIn);
  elements.pokerBlindValue.textContent = `${formatKamas(poker.smallBlind)} / ${formatKamas(poker.bigBlind)}`;
  elements.pokerStatusValue.textContent = formatPokerStatus(poker.status);
  elements.pokerPhaseValue.textContent = poker.phaseLabel;
  elements.pokerPotValue.textContent = formatKamas(poker.pot);
  elements.pokerPlayersNeeded.textContent =
    poker.playersNeeded > 0
      ? `${poker.playersNeeded} joueur(s) manquant(s)`
      : `${poker.playersSeated}/${poker.maxPlayers} assis`;

  if (poker.status === "playing") {
    elements.pokerTurnValue.textContent = poker.activeSeat
      ? `${seatLabelByNumber(poker, poker.activeSeat)} | ${poker.secondsToAct}s`
      : "Resolution";
  } else if (poker.status === "showdown") {
    elements.pokerTurnValue.textContent = poker.secondsToNextHand
      ? `${poker.secondsToNextHand}s`
      : "Prochaine main";
  } else {
    elements.pokerTurnValue.textContent =
      poker.playersNeeded > 0 ? `${poker.playersNeeded} joueur(s)` : "Pret";
  }

  elements.pokerWinnerSummary.textContent =
    poker.winnerSummary ||
    (poker.status === "waiting"
      ? "La main se lance des que 2 joueurs sont assis."
      : "Le board se complete.");

  renderPokerBoard(poker);
  renderPokerSeats(poker);
  renderPokerActions(poker);
  renderPokerLog(poker.actionLog || []);
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
  elements.autoSpinButton.disabled =
    state.isSubmittingTicket ||
    state.isAnimatingRound ||
    (!state.betSlip.size && !state.pendingTicket?.bets?.length);
  elements.stopAutoSpinButton.disabled = !state.autoQueue.active;

  elements.autoSpinButton.textContent = state.autoQueue.active
    ? `Auto (${state.autoQueue.remaining})`
    : "Demarrer";
  updateCashoutControls();
}

async function loadPokerStateForTable(tableSlug, options = {}) {
  if (!state.me || !tableSlug) {
    return;
  }

  state.isLoadingPokerView = true;
  state.selectedPokerTableSlug = tableSlug;
  renderPoker();

  try {
    const payload = await api(`/api/poker/state${pokerTableQuery(tableSlug)}`);
    state.poker = payload.poker;
    state.selectedPokerTableSlug = payload.poker?.selectedTableSlug || tableSlug;
    renderPoker();
  } catch (error) {
    if (options.showToast !== false) {
      showToast(error.message, "error");
    }
  } finally {
    state.isLoadingPokerView = false;
    renderPoker();
  }
}

async function selectPokerTable(tableSlug) {
  if (!tableSlug || tableSlug === getSelectedPokerTableSlug() || state.isLoadingPokerView) {
    return;
  }

  await loadPokerStateForTable(tableSlug, { showToast: false });
}

async function joinPokerTable() {
  if (state.isSubmittingPokerAction || state.isLoadingPokerView) {
    return;
  }

  state.isSubmittingPokerAction = true;
  renderPoker();

  try {
    const payload = await api("/api/poker/join", {
      method: "POST",
      body: JSON.stringify({
        tableSlug: getSelectedPokerTableSlug(),
      }),
    });

    state.me = payload.user;
    state.poker = payload.poker;
    state.selectedPokerTableSlug = payload.poker?.selectedTableSlug || getSelectedPokerTableSlug();
    renderMetrics();
    renderPoker();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingPokerAction = false;
    renderPoker();
  }
}

async function leavePokerTable() {
  if (state.isSubmittingPokerAction || state.isLoadingPokerView) {
    return;
  }

  state.isSubmittingPokerAction = true;
  renderPoker();

  try {
    const payload = await api("/api/poker/leave", {
      method: "POST",
      body: JSON.stringify({
        tableSlug: getSelectedPokerTableSlug(),
      }),
    });

    state.me = payload.user;
    state.poker = payload.poker;
    state.selectedPokerTableSlug = payload.poker?.selectedTableSlug || getSelectedPokerTableSlug();
    renderMetrics();
    renderPoker();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingPokerAction = false;
    renderPoker();
  }
}

function onPokerPrimaryAction() {
  const poker = getPokerState();
  const action = poker?.actions?.canCall ? "call" : "check";
  submitPokerAction(action);
}

function onPokerRaise() {
  submitPokerAction("raise", Number.parseInt(elements.pokerRaiseAmount.value, 10));
}

async function submitPokerAction(action, amount) {
  if (state.isSubmittingPokerAction || state.isLoadingPokerView) {
    return;
  }

  state.isSubmittingPokerAction = true;
  renderPoker();

  try {
    const payload = await api("/api/poker/action", {
      method: "POST",
      body: JSON.stringify({
        tableSlug: getSelectedPokerTableSlug(),
        action,
        amount,
      }),
    });

    state.me = payload.user;
    state.poker = payload.poker;
    state.selectedPokerTableSlug = payload.poker?.selectedTableSlug || getSelectedPokerTableSlug();
    renderMetrics();
    renderPoker();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingPokerAction = false;
    renderPoker();
  }
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
  const template = getSerializedSlip().length
    ? getSerializedSlip()
    : (state.pendingTicket?.bets || []).map((bet) => ({
        type: bet.type,
        value: bet.value,
        amount: Number(bet.amount),
      }));

  if (!template.length) {
    showToast(
      "Prepare un ticket ou reutilise le ticket confirme pour lancer l'auto spin.",
      "error",
    );
    return;
  }

  if (rounds < 1 || rounds > (state.bootstrap?.roulette?.autoSpinMaxRounds || 25)) {
    showToast("Nombre de manches auto invalide.", "error");
    return;
  }

  replaceBetSlip(template);
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
    showToast("Auto spin termine.", "success");
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
    showToast("Solde insuffisant pour continuer l'auto spin.", "error");
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

async function onCashoutRequest(event) {
  event.preventDefault();

  if (state.isSubmittingCashout) {
    return;
  }

  const formData = new FormData(event.currentTarget);
  const amount = Number.parseInt(String(formData.get("amount") || ""), 10);
  const note = String(formData.get("note") || "").trim();

  if (!Number.isInteger(amount) || amount <= 0) {
    showToast("Entre un montant valide pour le cash out.", "error");
    return;
  }

  state.isSubmittingCashout = true;
  updateCashoutControls();

  try {
    const payload = await api("/api/game/cashout-requests", {
      method: "POST",
      body: JSON.stringify({ amount, note }),
    });

    state.me = payload.user;
    state.cashoutRequests = payload.cashoutRequests || [];
    state.pendingCashoutRequest =
      payload.pendingCashoutRequest ||
      state.cashoutRequests.find((request) => request.status === "pending") ||
      null;
    state.bootstrap = {
      ...state.bootstrap,
      notifications: payload.notifications || state.bootstrap?.notifications || [],
    };

    renderMetrics();
    renderNotifications(payload.notifications || []);
    renderCashoutSection();
    event.currentTarget.reset();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingCashout = false;
    updateCashoutControls();
  }
}

async function cancelPendingCashoutRequest() {
  const pendingRequest = getPendingCashoutRequest();

  if (!pendingRequest || state.isSubmittingCashout) {
    return;
  }

  state.isSubmittingCashout = true;
  updateCashoutControls();

  try {
    const payload = await api(`/api/game/cashout-requests/${pendingRequest.id}`, {
      method: "DELETE",
    });

    state.me = payload.user;
    state.cashoutRequests = payload.cashoutRequests || [];
    state.pendingCashoutRequest =
      payload.pendingCashoutRequest ||
      state.cashoutRequests.find((request) => request.status === "pending") ||
      null;
    state.bootstrap = {
      ...state.bootstrap,
      notifications: payload.notifications || state.bootstrap?.notifications || [],
    };

    renderMetrics();
    renderNotifications(payload.notifications || []);
    renderCashoutSection();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingCashout = false;
    updateCashoutControls();
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
    renderPoker();
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
  if (state.poker?.status === "playing" && state.poker.secondsToAct > 0) {
    state.poker.secondsToAct -= 1;
  }
  if (state.poker?.status === "showdown" && state.poker.secondsToNextHand > 0) {
    state.poker.secondsToNextHand -= 1;
  }
  renderPoker();
  updateSpinButtons();
}

async function pollRoundState() {
  if (!state.me || state.isRoundPollInFlight) {
    return;
  }

  state.isRoundPollInFlight = true;

  try {
    const payload = await api(`/api/game/round-state${pokerTableQuery()}`);
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
  state.cashoutRequests = payload.cashoutRequests || state.cashoutRequests;
  state.poker = payload.poker || state.poker;
  state.selectedPokerTableSlug =
    payload.poker?.selectedTableSlug || state.selectedPokerTableSlug || null;
  state.pendingCashoutRequest =
    payload.pendingCashoutRequest ||
    state.cashoutRequests.find((request) => request.status === "pending") ||
    null;
  state.bootstrap = {
    ...state.bootstrap,
    currentRound: payload.currentRound,
    pendingTicket: state.pendingTicket,
    latestResolvedRound: payload.latestResolvedRound,
    latestPlayerSpin: payload.latestPlayerSpin,
    lastNumbers: payload.lastNumbers,
    serverTime: payload.serverTime,
    cashoutRequests: state.cashoutRequests,
    poker: state.poker,
  };

  renderMetrics();
  renderRoundPanel();
  renderLastNumbers(payload.lastNumbers);
  renderCashoutSection();
  renderPoker();
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
        if (playerSpin.netResult >= 0) {
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
  context.fillStyle = "#3a281b";
  context.fill();

  for (let index = 0; index < pocketCount; index += 1) {
    const number = state.bootstrap?.roulette?.wheelOrder?.[index] ?? defaultWheelOrder()[index];
    const color = number === 0 ? "#5e8d46" : RED_NUMBERS.has(number) ? "#b8573f" : "#25252a";
    const startAngle = -Math.PI / 2 + rotation + index * angleSize - angleSize / 2;
    const endAngle = startAngle + angleSize;

    context.beginPath();
    context.moveTo(0, 0);
    context.arc(0, 0, radius, startAngle, endAngle);
    context.closePath();
    context.fillStyle = color;
    context.fill();

    context.strokeStyle = "rgba(216, 181, 102, 0.22)";
    context.lineWidth = 2;
    context.stroke();

    context.save();
    context.rotate(startAngle + angleSize / 2);
    context.translate(0, -radius + 42);
    context.rotate(Math.PI / 2);
    context.fillStyle = "#fff1d5";
    context.font = "700 18px Palatino Linotype";
    context.textAlign = "center";
    context.fillText(String(number), 0, 8);
    context.restore();
  }

  context.beginPath();
  context.arc(0, 0, radius * 0.58, 0, Math.PI * 2);
  context.fillStyle = "#23180f";
  context.fill();
  context.lineWidth = 7;
  context.strokeStyle = "rgba(216, 181, 102, 0.42)";
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
  elements.resultTitle.textContent = playerSpin.netResult >= 0 ? "Victoire" : "Defaite";
  elements.resultSubtitle.textContent = `La manche #${round.roundKey} tombe sur le ${round.resultNumber} ${formatRoundColor(round.resultColor)}.`;
  elements.resultMeta.innerHTML = `
    <div class="result-row">
      <span>Total mise</span>
      <strong>${formatKamas(playerSpin.totalBet)}</strong>
    </div>
    <div class="result-row">
      <span>Total retour</span>
      <strong>${formatKamas(playerSpin.totalPayout)}</strong>
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
