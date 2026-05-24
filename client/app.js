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

const CHIP_VALUES = [200000, 500000, 1000000, 1500000, 2000000];
const DEFAULT_PROBABILITIES = [
  { type: "number", label: "Numero exact", probability: 2.7, totalReturnMultiplier: 36.26 },
  { type: "color", label: "Rouge / Noir", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "parity", label: "Pair / Impair", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "range", label: "Manque / Passe", probability: 48.65, totalReturnMultiplier: 2.01 },
  { type: "dozen", label: "Douzaine", probability: 32.43, totalReturnMultiplier: 3.02 },
];
const SKRIBBL_COLORS = [
  "#f6eed9",
  "#201912",
  "#d69438",
  "#b8573f",
  "#5e8d46",
  "#4f76c7",
  "#9a72dd",
  "#f08d8d",
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
  connect4: null,
  lastConnect4StartActionId: null,
  isSubmittingConnect4: false,
  skribbl: null,
  isSubmittingSkribbl: false,
  skribblPainter: {
    color: SKRIBBL_COLORS[0],
    width: 6,
    isDrawing: false,
    pointerId: null,
    points: [],
    pendingStrokes: [],
    uploadQueue: [],
    isUploading: false,
    lastRenderSignature: "",
    roundNumber: 0,
  },
  selectedPokerTableSlug: null,
  poker: null,
  isLoadingPokerView: false,
  isSubmittingPokerAction: false,
  slots: null,
  selectedSlotBet: 100000,
  isLoadingSlotsView: false,
  isSubmittingSlotSpin: false,
  isSubmittingSlotSeed: false,
  slotDisplayGrid: null,
  slotLastSpinResult: null,
};

const elements = {};

function formatCompactKamas(amount) {
  if (!Number.isFinite(amount)) {
    return "0";
  }

  const sign = amount < 0 ? "-" : "";
  const absolute = Math.abs(amount);

  if (absolute >= 1000000) {
    const millions =
      absolute >= 10000000 || absolute % 1000000 === 0
        ? Math.round(absolute / 1000000).toString()
        : (absolute / 1000000).toFixed(1).replace(/\.0$/, "").replace(".", ",");
    return `${sign}${millions}M`;
  }

  if (absolute >= 1000) {
    return `${sign}${Math.round(absolute / 1000)}k`;
  }

  return `${sign}${absolute}`;
}

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
    connect4ActionLog: document.getElementById("connect4ActionLog"),
    connect4Board: document.getElementById("connect4Board"),
    connect4EntryFeeValue: document.getElementById("connect4EntryFeeValue"),
    connect4HeroStatus: document.getElementById("connect4HeroStatus"),
    connect4JoinButton: document.getElementById("connect4JoinButton"),
    connect4LeaveButton: document.getElementById("connect4LeaveButton"),
    connect4MatchStatus: document.getElementById("connect4MatchStatus"),
    connect4PotValue: document.getElementById("connect4PotValue"),
    connect4PrizeValue: document.getElementById("connect4PrizeValue"),
    connect4SeatList: document.getElementById("connect4SeatList"),
    connect4StatusBadge: document.getElementById("connect4StatusBadge"),
    connect4TimerValue: document.getElementById("connect4TimerValue"),
    connect4TurnHint: document.getElementById("connect4TurnHint"),
    connect4TurnSecondsValue: document.getElementById("connect4TurnSecondsValue"),
    connect4TurnValue: document.getElementById("connect4TurnValue"),
    connect4View: document.getElementById("connect4View"),
    greenMaxValue: document.getElementById("greenMaxValue"),
    historyList: document.getElementById("historyList"),
    lastNumbers: document.getElementById("lastNumbers"),
    leaderboardList: document.getElementById("leaderboardList"),
    loginForm: document.getElementById("loginForm"),
    logoutButton: document.getElementById("logoutButton"),
    metricMaxLabel: document.getElementById("metricMaxLabel"),
    metricMinLabel: document.getElementById("metricMinLabel"),
    metricSideLabel: document.getElementById("metricSideLabel"),
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
    skribblCanvas: document.getElementById("skribblCanvas"),
    skribblClearButton: document.getElementById("skribblClearButton"),
    skribblDrawerValue: document.getElementById("skribblDrawerValue"),
    skribblDrawSecondsValue: document.getElementById("skribblDrawSecondsValue"),
    skribblEntryFeeValue: document.getElementById("skribblEntryFeeValue"),
    skribblGuessButton: document.getElementById("skribblGuessButton"),
    skribblGuessFeed: document.getElementById("skribblGuessFeed"),
    skribblGuessForm: document.getElementById("skribblGuessForm"),
    skribblGuessInput: document.getElementById("skribblGuessInput"),
    skribblHeroStatus: document.getElementById("skribblHeroStatus"),
    skribblHouseValue: document.getElementById("skribblHouseValue"),
    skribblJoinButton: document.getElementById("skribblJoinButton"),
    skribblLeaveButton: document.getElementById("skribblLeaveButton"),
    skribblLibraryValue: document.getElementById("skribblLibraryValue"),
    skribblPalette: document.getElementById("skribblPalette"),
    skribblPlayerList: document.getElementById("skribblPlayerList"),
    skribblPodium: document.getElementById("skribblPodium"),
    skribblPotValue: document.getElementById("skribblPotValue"),
    skribblPrizeValue: document.getElementById("skribblPrizeValue"),
    skribblPromptLabel: document.getElementById("skribblPromptLabel"),
    skribblPromptValue: document.getElementById("skribblPromptValue"),
    skribblStatusBadge: document.getElementById("skribblStatusBadge"),
    skribblStatusText: document.getElementById("skribblStatusText"),
    skribblTimerValue: document.getElementById("skribblTimerValue"),
    skribblToolbar: document.getElementById("skribblToolbar"),
    skribblView: document.getElementById("skribblView"),
    skribblWidthInput: document.getElementById("skribblWidthInput"),
    slotBetInput: document.getElementById("slotBetInput"),
    slotBetPresets: document.getElementById("slotBetPresets"),
    slotCascadeTrail: document.getElementById("slotCascadeTrail"),
    slotFreeSpinsValue: document.getElementById("slotFreeSpinsValue"),
    slotHistoryList: document.getElementById("slotHistoryList"),
    slotLastWinValue: document.getElementById("slotLastWinValue"),
    slotModeBadge: document.getElementById("slotModeBadge"),
    slotMultiplierValue: document.getElementById("slotMultiplierValue"),
    slotPaylineValue: document.getElementById("slotPaylineValue"),
    slotReels: document.getElementById("slotReels"),
    slotSimpleNote: document.getElementById("slotSimpleNote"),
    slotSpinButton: document.getElementById("slotSpinButton"),
    slotStatusText: document.getElementById("slotStatusText"),
    slotsView: document.getElementById("slotsView"),
    spinButton: document.getElementById("spinButton"),
    statsGrid: document.getElementById("statsGrid"),
    stopAutoSpinButton: document.getElementById("stopAutoSpinButton"),
    ticketMaxValue: document.getElementById("ticketMaxValue"),
    ticketTotal: document.getElementById("ticketTotal"),
    pendingCashoutCard: document.getElementById("pendingCashoutCard"),
    viewConnect4Button: document.getElementById("viewConnect4Button"),
    viewPokerButton: document.getElementById("viewPokerButton"),
    viewRouletteButton: document.getElementById("viewRouletteButton"),
    viewSkribblButton: document.getElementById("viewSkribblButton"),
    viewSlotsButton: document.getElementById("viewSlotsButton"),
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
  elements.viewConnect4Button.addEventListener("click", () => setActiveView("connect4"));
  elements.viewSkribblButton.addEventListener("click", () => setActiveView("skribbl"));
  elements.viewSlotsButton.addEventListener("click", () => setActiveView("slots"));
  elements.connect4JoinButton.addEventListener("click", joinConnect4Table);
  elements.connect4LeaveButton.addEventListener("click", leaveConnect4Table);
  elements.connect4Board.addEventListener("click", onConnect4ColumnSelect);
  elements.skribblJoinButton.addEventListener("click", joinSkribblRoom);
  elements.skribblLeaveButton.addEventListener("click", leaveSkribblRoom);
  elements.skribblClearButton.addEventListener("click", clearSkribblBoard);
  elements.skribblGuessForm.addEventListener("submit", onSkribblGuessSubmit);
  elements.skribblPalette.addEventListener("click", onSkribblPaletteSelect);
  elements.skribblWidthInput.addEventListener("input", onSkribblWidthChange);
  elements.skribblCanvas.addEventListener("pointerdown", onSkribblPointerDown);
  window.addEventListener("pointermove", onSkribblPointerMove);
  window.addEventListener("pointerup", onSkribblPointerUp);
  window.addEventListener("pointercancel", onSkribblPointerUp);
  elements.joinPokerButton.addEventListener("click", joinPokerTable);
  elements.leavePokerButton.addEventListener("click", leavePokerTable);
  elements.pokerFoldButton.addEventListener("click", () => submitPokerAction("fold"));
  elements.pokerCheckCallButton.addEventListener("click", onPokerPrimaryAction);
  elements.pokerRaiseButton.addEventListener("click", onPokerRaise);
  elements.slotSpinButton.addEventListener("click", submitSlotSpin);
  elements.slotBetPresets.addEventListener("click", onSlotBetPresetClick);
  elements.slotBetInput.addEventListener("change", onSlotBetInputChange);
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
  state.connect4 = payload.connect4 || null;
  syncConnect4StartSoundState(state.connect4, { play: false });
  state.skribbl = payload.skribbl || null;
  state.poker = payload.poker || null;
  state.slots = payload.slots || null;
  state.selectedPokerTableSlug =
    payload.poker?.selectedTableSlug || state.selectedPokerTableSlug || null;
  if (!state.selectedSlotBet && payload.slots?.config?.minBet) {
    state.selectedSlotBet = Number(payload.slots.config.minBet);
  }
  if (payload.slots?.config?.minBet && !Number.isFinite(state.selectedSlotBet)) {
    state.selectedSlotBet = Number(payload.slots.config.minBet);
  }
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
  renderConnect4();
  renderSkribbl();
  renderPoker();
  renderSlots();
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
  const form = event.currentTarget;
  const formData = new FormData(form);

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
    form.reset();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function onRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);

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
    form.reset();
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
  state.connect4 = null;
  state.lastConnect4StartActionId = null;
  state.isSubmittingConnect4 = false;
  state.skribbl = null;
  state.isSubmittingSkribbl = false;
  state.skribblPainter = {
    color: SKRIBBL_COLORS[0],
    width: 6,
    isDrawing: false,
    pointerId: null,
    points: [],
    pendingStrokes: [],
    uploadQueue: [],
    isUploading: false,
    lastRenderSignature: "",
    roundNumber: 0,
  };
  state.selectedPokerTableSlug = null;
  state.poker = null;
  state.isLoadingPokerView = false;
  state.slots = null;
  state.selectedSlotBet = 100000;
  state.isLoadingSlotsView = false;
  state.isSubmittingSlotSpin = false;
  state.isSubmittingSlotSeed = false;
  state.slotDisplayGrid = null;
  state.slotLastSpinResult = null;
  state.activeView = "roulette";
  state.isSubmittingPokerAction = false;
  elements.cashoutRequestForm.reset();
  renderBetSlip();
  renderCashoutSection();
  renderConnect4();
  renderSkribbl();
  renderPoker();
  renderSlots();
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
  return Number(getRouletteRules().maxBet || 5000000);
}

function getColorMaxBet() {
  return Number(getRouletteRules().colorMaxBet || 2000000);
}

function getNumberMaxBet() {
  return Number(getRouletteRules().numberMaxBet || 500000);
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

  if (type === "color" && amount > getColorMaxBet()) {
    showToast(
      `Chaque couleur est limitee a ${formatKamas(getColorMaxBet())}.`,
      "error",
    );
    return;
  }

  if (type === "number" && amount > getNumberMaxBet()) {
    showToast(
      `Chaque numero, y compris le 0, est limite a ${formatKamas(getNumberMaxBet())}.`,
      "error",
    );
    return;
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

  if (state.activeView === "connect4" && state.connect4) {
    elements.metricMinLabel.textContent = "Entree";
    elements.metricMaxLabel.textContent = "Gain";
    elements.metricSideLabel.textContent = "Tempo";
    elements.minBetValue.textContent = formatKamas(state.connect4.entryFee || 0);
    elements.ticketMaxValue.textContent = formatKamas(state.connect4.winnerPayout || 0);
    elements.greenMaxValue.textContent = `${state.connect4.turnSeconds || 7} sec`;
    return;
  }

  if (state.activeView === "skribbl" && state.skribbl) {
    elements.metricMinLabel.textContent = "Entree";
    elements.metricMaxLabel.textContent = "Pot redistribue";
    elements.metricSideLabel.textContent = "Timer";
    elements.minBetValue.textContent = formatKamas(state.skribbl.entryFee || 0);
    elements.ticketMaxValue.textContent = formatKamas(state.skribbl.payoutPool || 0);
    elements.greenMaxValue.textContent = `${state.skribbl.drawSeconds || 60} sec`;
    return;
  }

  if (state.activeView === "slots" && state.slots?.config) {
    elements.metricMinLabel.textContent = "Mise mini";
    elements.metricMaxLabel.textContent = "Mise max";
    elements.metricSideLabel.textContent = "Max win";
    elements.minBetValue.textContent = formatKamas(state.slots.config.minBet);
    elements.ticketMaxValue.textContent = formatKamas(state.slots.config.maxBet);
    elements.greenMaxValue.textContent = `x${state.slots.config.maxWinMultiplier}`;
    return;
  }

  if (state.activeView === "poker" && state.poker) {
    elements.metricMinLabel.textContent = "Cave";
    elements.metricMaxLabel.textContent = "Petite blind";
    elements.metricSideLabel.textContent = "Grosse blind";
    elements.minBetValue.textContent = formatKamas(state.poker.buyIn || 0);
    elements.ticketMaxValue.textContent = formatKamas(state.poker.smallBlind || 0);
    elements.greenMaxValue.textContent = formatKamas(state.poker.bigBlind || 0);
    return;
  }

  elements.metricMinLabel.textContent = "Mise mini";
  elements.metricMaxLabel.textContent = "Ticket max";
  elements.metricSideLabel.textContent = "Numero max";
  elements.minBetValue.textContent = formatKamas(getMinBet());
  elements.ticketMaxValue.textContent = formatKamas(getTicketMax());
  elements.greenMaxValue.textContent = formatKamas(getNumberMaxBet());
}

function renderBetRulesSummary() {
  elements.betRulesSummary.innerHTML = `
    <span>Mise mini ${formatKamas(getMinBet())}</span>
    <span>Ticket max ${formatKamas(getTicketMax())}</span>
    <span>Couleurs max ${formatKamas(getColorMaxBet())}</span>
    <span>Numeros max ${formatKamas(getNumberMaxBet())}</span>
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

function getConnect4State() {
  return state.connect4 || state.bootstrap?.connect4 || null;
}

function getLatestConnect4StartActionId(connect4) {
  const actions = connect4?.recentActions || [];

  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action?.actionType === "start") {
      return action.id || `start-${action.createdAt || index}`;
    }
  }

  return null;
}

function syncConnect4StartSoundState(connect4, options = {}) {
  const latestStartActionId = getLatestConnect4StartActionId(connect4);
  const shouldPlay =
    options.play !== false
    && latestStartActionId
    && latestStartActionId !== state.lastConnect4StartActionId;

  state.lastConnect4StartActionId = latestStartActionId;

  if (shouldPlay && state.soundEnabled) {
    state.audio.matchStart().catch(() => {});
  }
}

function formatConnect4SeatLabel(color) {
  return color === "red" ? "Rouge" : "Jaune";
}

function formatConnect4Status(connect4) {
  if (!connect4) {
    return "Chargement";
  }

  if (connect4.status === "playing") {
    return connect4.secondsToAct > 0 ? `En jeu ${connect4.secondsToAct}s` : "En jeu";
  }

  if (connect4.status === "showdown") {
    return connect4.secondsToNextGame > 0
      ? `Fin ${connect4.secondsToNextGame}s`
      : "Fin";
  }

  return `Attente ${connect4.seatCount || 0}/2`;
}

function renderConnect4Board(connect4) {
  if (!connect4) {
    elements.connect4Board.innerHTML = `<div class="empty-state">La table se charge.</div>`;
    return;
  }

  const canPlay = connect4.status === "playing" && connect4.myTurn && !state.isSubmittingConnect4;
  const playableColumns = new Set(
    Array.from({ length: 7 }, (_unused, columnIndex) => columnIndex).filter(
      (columnIndex) => canPlay && !connect4.board?.[0]?.[columnIndex],
    ),
  );

  elements.connect4Board.innerHTML = (connect4.board || [])
    .map(
      (row, rowIndex) => `
        <div class="connect4-board-row">
          ${row
            .map((cell, columnIndex) => {
              const isPlayable = playableColumns.has(columnIndex);
              return `
                <div
                  class="connect4-board-cell ${isPlayable ? "is-playable" : ""}"
                  data-connect4-column="${columnIndex}"
                  data-connect4-row="${rowIndex}"
                >
                  <span class="connect4-disc ${cell ? `is-${cell}` : "is-empty"}"></span>
                </div>
              `;
            })
            .join("")}
        </div>
      `,
    )
    .join("");
}

function renderConnect4Log(connect4) {
  const actions = connect4?.recentActions || [];

  if (!actions.length) {
    elements.connect4ActionLog.innerHTML = `
      <div class="empty-state">Aucun duel enregistre pour l'instant.</div>
    `;
    return;
  }

  elements.connect4ActionLog.innerHTML = actions
    .map(
      (action) => `
        <div class="history-item">
          <div>
            <strong>${escapeHtml(action.username || "Systeme")}</strong>
            <div class="history-meta">${formatDate(action.createdAt)}</div>
          </div>
          <div class="bet-meta">${escapeHtml(action.details || action.actionType)}</div>
        </div>
      `,
    )
    .join("");
}

function renderConnect4() {
  const connect4 = getConnect4State();

  if (!connect4) {
    elements.connect4StatusBadge.textContent = "Chargement";
    elements.connect4HeroStatus.textContent = "Pas assis";
    elements.connect4PotValue.textContent = formatKamas(0);
    elements.connect4TurnValue.textContent = "En attente";
    elements.connect4TimerValue.textContent = "00:07";
    elements.connect4EntryFeeValue.textContent = formatKamas(500000);
    elements.connect4PrizeValue.textContent = formatKamas(900000);
    elements.connect4TurnSecondsValue.textContent = "7 sec";
    elements.connect4SeatList.innerHTML = "";
    elements.connect4TurnHint.textContent = "Une partie commence des que 2 joueurs sont assis.";
    elements.connect4MatchStatus.textContent = "Assieds-toi et attends un rival.";
    renderConnect4Board(null);
    renderConnect4Log(null);
    return;
  }

  elements.connect4StatusBadge.textContent = formatConnect4Status(connect4);
  elements.connect4HeroStatus.textContent = connect4.myColor
    ? `Assis en ${formatConnect4SeatLabel(connect4.myColor)}`
    : "Pas assis";
  elements.connect4PotValue.textContent = formatKamas(connect4.pot || 0);
  elements.connect4TurnValue.textContent =
    connect4.status === "playing"
      ? connect4.activeUsername || formatConnect4SeatLabel(connect4.activeColor)
      : connect4.status === "showdown"
        ? connect4.winnerUsername || "Resolution"
        : "En attente";
  elements.connect4TimerValue.textContent = formatCountdown(
    connect4.status === "playing"
      ? connect4.secondsToAct
      : connect4.status === "showdown"
        ? connect4.secondsToNextGame
        : connect4.turnSeconds || 7,
  );
  elements.connect4EntryFeeValue.textContent = formatKamas(connect4.entryFee || 0);
  elements.connect4PrizeValue.textContent = formatKamas(connect4.winnerPayout || 0);
  elements.connect4TurnSecondsValue.textContent = `${connect4.turnSeconds || 7} sec`;
  elements.connect4MatchStatus.textContent = connect4.statusText;

  elements.connect4SeatList.innerHTML = (connect4.seats || [])
    .map(
      (seat) => `
        <article class="connect4-seat-card ${seat.color} ${seat.isMe ? "is-me" : ""} ${seat.occupied ? "" : "empty"}">
          <strong>${escapeHtml(seat.label)}</strong>
          <div>${seat.occupied ? escapeHtml(seat.username) : "Libre"}</div>
          <div class="bet-meta">${seat.isMe ? "Toi" : seat.occupied ? "Pret" : "En attente"}</div>
        </article>
      `,
    )
    .join("");

  if (connect4.joinBlockedByBalance) {
    elements.connect4TurnHint.textContent = `Il faut ${formatKamas(connect4.entryFee)} pour entrer.`;
  } else if (connect4.myTurn) {
    elements.connect4TurnHint.textContent = `A toi de jouer, tu as ${connect4.secondsToAct}s. Clique sur une colonne en surbrillance.`;
  } else if (connect4.myColor && connect4.status === "playing") {
    elements.connect4TurnHint.textContent = `Patiente, ${connect4.activeUsername || "ton rival"} joue.`;
  } else if (connect4.status === "showdown") {
    elements.connect4TurnHint.textContent =
      connect4.winnerReason === "draw"
        ? "Match nul, la table se vide apres le compte a rebours."
        : `Reprise dans ${connect4.secondsToNextGame}s.`;
  } else {
    elements.connect4TurnHint.textContent = "Une partie commence des que 2 joueurs sont assis.";
  }

  elements.connect4JoinButton.disabled =
    state.isSubmittingConnect4 || !connect4.canJoin;
  elements.connect4LeaveButton.disabled =
    state.isSubmittingConnect4 || !connect4.canLeave;
  elements.connect4LeaveButton.textContent =
    connect4.status === "playing" && connect4.myColor ? "Abandonner" : "Quitter";

  renderConnect4Board(connect4);
  renderConnect4Log(connect4);
}

function getSkribblState() {
  return state.skribbl || state.bootstrap?.skribbl || null;
}

function formatSkribblStatus(skribbl) {
  if (!skribbl) {
    return "Chargement";
  }

  if (skribbl.status === "playing") {
    return skribbl.secondsToEnd > 0 ? `Dessin ${skribbl.secondsToEnd}s` : "Dessin";
  }

  if (skribbl.status === "showdown") {
    return skribbl.secondsToNextRound > 0
      ? `Podium ${skribbl.secondsToNextRound}s`
      : "Podium";
  }

  return `Attente ${skribbl.seatCount || 0}/${skribbl.minPlayers || 2}`;
}

function resetSkribblPainterForRound(roundNumber) {
  state.skribblPainter.roundNumber = roundNumber;
  state.skribblPainter.isDrawing = false;
  state.skribblPainter.pointerId = null;
  state.skribblPainter.points = [];
  state.skribblPainter.pendingStrokes = [];
  state.skribblPainter.uploadQueue = [];
  state.skribblPainter.isUploading = false;
  state.skribblPainter.lastRenderSignature = "";
}

function syncSkribblRoundTracking(skribbl) {
  const activeRoundNumber = Number(skribbl?.roundNumber || 0);

  if (activeRoundNumber !== state.skribblPainter.roundNumber) {
    resetSkribblPainterForRound(activeRoundNumber);
  }

  if (!skribbl || skribbl.status !== "playing") {
    state.skribblPainter.isDrawing = false;
    state.skribblPainter.pointerId = null;
    state.skribblPainter.points = [];
    if (state.skribblPainter.pendingStrokes.length || state.skribblPainter.uploadQueue.length) {
      state.skribblPainter.pendingStrokes = [];
      state.skribblPainter.uploadQueue = [];
      state.skribblPainter.isUploading = false;
      state.skribblPainter.lastRenderSignature = "";
    }
  }
}

function drawSkribblStroke(context, canvas, stroke) {
  if (!stroke?.points?.length) {
    return;
  }

  context.save();
  context.strokeStyle = stroke.color || SKRIBBL_COLORS[0];
  context.fillStyle = stroke.color || SKRIBBL_COLORS[0];
  context.lineWidth = Number(stroke.width || 6);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();

  stroke.points.forEach((point, index) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;

    if (index === 0) {
      context.moveTo(x, y);
      return;
    }

    context.lineTo(x, y);
  });

  context.stroke();

  if (stroke.points.length === 1) {
    context.beginPath();
    context.arc(
      stroke.points[0].x * canvas.width,
      stroke.points[0].y * canvas.height,
      Number(stroke.width || 6) / 2,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  context.restore();
}

function paintSkribblBackdrop(context, canvas) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#efe5cf";
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(55, 42, 28, 0.06)";
  context.lineWidth = 1;

  for (let x = 28; x < canvas.width; x += 28) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }

  for (let y = 28; y < canvas.height; y += 28) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }
}

function renderSkribblCanvas(skribbl) {
  const canvas = elements.skribblCanvas;
  const context = canvas?.getContext("2d");
  if (!canvas || !context) {
    return;
  }

  const signature = [
    skribbl?.roundNumber || 0,
    skribbl?.status || "waiting",
    skribbl?.strokeCount || 0,
    skribbl?.lastStrokeId || 0,
    state.skribblPainter.pendingStrokes.length,
    state.skribblPainter.points.length,
    state.skribblPainter.color,
    state.skribblPainter.width,
  ].join(":");

  if (
    signature === state.skribblPainter.lastRenderSignature
    && !state.skribblPainter.isDrawing
  ) {
    return;
  }

  paintSkribblBackdrop(context, canvas);

  (skribbl?.strokes || []).forEach((stroke) => drawSkribblStroke(context, canvas, stroke));
  state.skribblPainter.pendingStrokes.forEach((stroke) =>
    drawSkribblStroke(context, canvas, stroke),
  );

  if (state.skribblPainter.points.length) {
    drawSkribblStroke(context, canvas, {
      color: state.skribblPainter.color,
      width: state.skribblPainter.width,
      points: state.skribblPainter.points,
    });
  }

  state.skribblPainter.lastRenderSignature = signature;
}

function renderSkribblPalette(skribbl) {
  elements.skribblPalette.innerHTML = SKRIBBL_COLORS.map(
    (color) => `
      <button
        class="skribbl-color-swatch ${state.skribblPainter.color === color ? "active" : ""}"
        data-skribbl-color="${color}"
        style="background:${color};"
        type="button"
        ${!skribbl?.canDraw ? "disabled" : ""}
      ></button>
    `,
  ).join("");

  elements.skribblWidthInput.value = String(state.skribblPainter.width);
  elements.skribblWidthInput.disabled = !skribbl?.canDraw;
  elements.skribblClearButton.disabled = state.isSubmittingSkribbl || !skribbl?.canClear;
}

function renderSkribblPlayerList(skribbl) {
  const players = skribbl?.players || [];

  if (!players.length) {
    elements.skribblPlayerList.innerHTML = `<div class="empty-state">La salle attend ses artistes.</div>`;
    return;
  }

  elements.skribblPlayerList.innerHTML = players
    .map(
      (player) => `
        <article class="skribbl-player-card ${player.isMe ? "is-me" : ""} ${player.isDrawer ? "is-drawer" : ""}">
          <div>
            <strong>${escapeHtml(player.username)}</strong>
            <div class="history-meta">${escapeHtml(player.badge)}</div>
          </div>
          ${
            player.prize
              ? `<strong class="result-positive">${formatCompactKamas(player.prize)}</strong>`
              : ""
          }
        </article>
      `,
    )
    .join("");
}

function renderSkribblPodium(skribbl) {
  const podium = skribbl?.podium || [];
  const preview = skribbl?.prizePreview || [];

  if (!podium.length) {
    elements.skribblPodium.innerHTML = preview
      .map(
        (slot) => `
          <div class="skribbl-podium-slot muted">
            <span>#${slot.rank}</span>
            <strong>${formatCompactKamas(slot.amount)}</strong>
          </div>
        `,
      )
      .join("");
    return;
  }

  elements.skribblPodium.innerHTML = podium
    .map(
      (slot) => `
        <div class="skribbl-podium-slot">
          <span>#${slot.rank}</span>
          <strong>${escapeHtml(slot.username)}</strong>
          <div class="history-meta">${formatKamas(slot.prize)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSkribblFeed(skribbl) {
  const feed = skribbl?.guessFeed || [];

  if (!feed.length) {
    elements.skribblGuessFeed.innerHTML = `<div class="empty-state">Les propositions et trouvailles apparaitront ici.</div>`;
    return;
  }

  elements.skribblGuessFeed.innerHTML = feed
    .map(
      (entry) => `
        <div class="history-item ${entry.isCorrect ? "skribbl-correct" : ""}">
          <div>
            <strong>${escapeHtml(entry.username || "Systeme")}</strong>
            <div class="history-meta">${formatDate(entry.createdAt)}</div>
          </div>
          <div class="bet-meta">${escapeHtml(entry.text)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSkribbl() {
  const skribbl = getSkribblState();
  syncSkribblRoundTracking(skribbl);

  if (!skribbl) {
    elements.skribblStatusBadge.textContent = "Chargement";
    elements.skribblHeroStatus.textContent = "Pas assis";
    elements.skribblPotValue.textContent = formatKamas(0);
    elements.skribblPrizeValue.textContent = formatKamas(0);
    elements.skribblDrawerValue.textContent = "En attente";
    elements.skribblTimerValue.textContent = "01:00";
    elements.skribblPromptLabel.textContent = "Mot";
    elements.skribblPromptValue.textContent = "En attente";
    elements.skribblStatusText.textContent = "La salle de dessin se charge.";
    elements.skribblEntryFeeValue.textContent = formatKamas(100000);
    elements.skribblDrawSecondsValue.textContent = "60 sec";
    elements.skribblHouseValue.textContent = "10%";
    elements.skribblLibraryValue.textContent = "--";
    elements.skribblGuessInput.disabled = true;
    elements.skribblGuessButton.disabled = true;
    elements.skribblJoinButton.disabled = true;
    elements.skribblLeaveButton.disabled = true;
    renderSkribblPalette(null);
    renderSkribblPlayerList(null);
    renderSkribblPodium(null);
    renderSkribblFeed(null);
    renderSkribblCanvas(null);
    return;
  }

  elements.skribblStatusBadge.textContent = formatSkribblStatus(skribbl);
  elements.skribblHeroStatus.textContent = skribbl.isDrawer
    ? "Dessinateur"
    : skribbl.hasGuessedCorrect
      ? `Classe #${skribbl.myGuessRank}`
      : skribbl.canGuess
        ? "Devineur"
        : skribbl.canJoin
          ? "Place libre"
          : "Observateur";
  elements.skribblPotValue.textContent = formatKamas(skribbl.pot || 0);
  elements.skribblPrizeValue.textContent = formatKamas(skribbl.payoutPool || 0);
  elements.skribblDrawerValue.textContent = skribbl.drawerUsername || "En attente";
  elements.skribblTimerValue.textContent = formatCountdown(
    skribbl.status === "playing"
      ? skribbl.secondsToEnd
      : skribbl.status === "showdown"
        ? skribbl.secondsToNextRound
        : skribbl.drawSeconds || 60,
  );
  elements.skribblPromptLabel.textContent = skribbl.wordLabel || "Mot";
  elements.skribblPromptValue.textContent = skribbl.wordDisplay || "En attente";
  elements.skribblStatusText.textContent = skribbl.statusText;
  elements.skribblEntryFeeValue.textContent = formatKamas(skribbl.entryFee || 0);
  elements.skribblDrawSecondsValue.textContent = `${skribbl.drawSeconds || 60} sec`;
  elements.skribblHouseValue.textContent = `${skribbl.housePercent || 10}%`;
  elements.skribblLibraryValue.textContent = `${skribbl.librarySize || 0} mots`;
  elements.skribblGuessInput.disabled = state.isSubmittingSkribbl || !skribbl.canGuess;
  elements.skribblGuessButton.disabled = state.isSubmittingSkribbl || !skribbl.canGuess;
  elements.skribblGuessButton.textContent = skribbl.hasGuessedCorrect
    ? "Trouve"
    : "Proposer";
  elements.skribblGuessInput.placeholder = skribbl.canGuess
    ? "Tape ton mot ici"
    : skribbl.isDrawer
      ? "Tu dessines cette manche"
      : skribbl.joinBlockedByBalance
        ? "Solde insuffisant pour entrer"
        : "Attends ton tour";
  elements.skribblJoinButton.disabled = state.isSubmittingSkribbl || !skribbl.canJoin;
  elements.skribblLeaveButton.disabled = state.isSubmittingSkribbl || !skribbl.canLeave;
  elements.skribblLeaveButton.textContent =
    skribbl.status === "waiting" ? "Quitter" : "Sortir";

  renderSkribblPalette(skribbl);
  renderSkribblPlayerList(skribbl);
  renderSkribblPodium(skribbl);
  renderSkribblFeed(skribbl);
  renderSkribblCanvas(skribbl);
}

function getSkribblCanvasPoint(event) {
  const rect = elements.skribblCanvas.getBoundingClientRect();
  const x = rect.width ? (event.clientX - rect.left) / rect.width : 0;
  const y = rect.height ? (event.clientY - rect.top) / rect.height : 0;

  return {
    x: Math.max(0, Math.min(1, Number(x.toFixed(4)))),
    y: Math.max(0, Math.min(1, Number(y.toFixed(4)))),
  };
}

function onSkribblPaletteSelect(event) {
  const target = event.target.closest("[data-skribbl-color]");
  if (!target || target.disabled) {
    return;
  }

  state.skribblPainter.color = target.dataset.skribblColor;
  state.skribblPainter.lastRenderSignature = "";
  renderSkribblPalette(getSkribblState());
}

function onSkribblWidthChange() {
  state.skribblPainter.width = Number(elements.skribblWidthInput.value || 6);
  state.skribblPainter.lastRenderSignature = "";
  renderSkribblCanvas(getSkribblState());
}

function onSkribblPointerDown(event) {
  const skribbl = getSkribblState();
  if (!skribbl?.canDraw || state.isSubmittingSkribbl || state.skribblPainter.isUploading) {
    return;
  }

  event.preventDefault();
  state.skribblPainter.isDrawing = true;
  state.skribblPainter.pointerId = event.pointerId;
  state.skribblPainter.points = [getSkribblCanvasPoint(event)];
  state.skribblPainter.lastRenderSignature = "";
  renderSkribblCanvas(skribbl);
}

function onSkribblPointerMove(event) {
  const skribbl = getSkribblState();
  if (
    !skribbl?.canDraw
    || !state.skribblPainter.isDrawing
    || state.skribblPainter.pointerId !== event.pointerId
  ) {
    return;
  }

  event.preventDefault();
  const point = getSkribblCanvasPoint(event);
  const lastPoint =
    state.skribblPainter.points[state.skribblPainter.points.length - 1] || point;
  const delta = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);

  if (delta < 0.0025) {
    return;
  }

  state.skribblPainter.points.push(point);
  state.skribblPainter.lastRenderSignature = "";
  renderSkribblCanvas(skribbl);
}

function queueSkribblStrokeUpload(stroke) {
  state.skribblPainter.pendingStrokes.push(stroke);
  state.skribblPainter.uploadQueue.push(stroke);
  state.skribblPainter.lastRenderSignature = "";
  renderSkribblCanvas(getSkribblState());
  flushSkribblStrokeQueue();
}

async function flushSkribblStrokeQueue() {
  if (state.skribblPainter.isUploading || !state.skribblPainter.uploadQueue.length) {
    return;
  }

  const stroke = state.skribblPainter.uploadQueue[0];
  state.skribblPainter.isUploading = true;

  try {
    const payload = await api("/api/skribbl/stroke", {
      method: "POST",
      body: JSON.stringify({ stroke }),
    });

    state.me = payload.user;
    state.skribbl = payload.skribbl;
    state.bootstrap = {
      ...state.bootstrap,
      skribbl: payload.skribbl,
    };
    state.skribblPainter.uploadQueue.shift();
    state.skribblPainter.pendingStrokes.shift();
    state.skribblPainter.lastRenderSignature = "";
    renderMetrics();
    renderSkribbl();
  } catch (error) {
    state.skribblPainter.uploadQueue.shift();
    state.skribblPainter.pendingStrokes.shift();
    state.skribblPainter.lastRenderSignature = "";
    renderSkribblCanvas(getSkribblState());
    showToast(error.message, "error");
  } finally {
    state.skribblPainter.isUploading = false;
    if (state.skribblPainter.uploadQueue.length) {
      flushSkribblStrokeQueue();
    }
  }
}

function onSkribblPointerUp(event) {
  const skribbl = getSkribblState();
  if (!state.skribblPainter.isDrawing || state.skribblPainter.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const point = getSkribblCanvasPoint(event);
  const points = [...state.skribblPainter.points];
  const lastPoint = points[points.length - 1];

  if (!lastPoint || lastPoint.x !== point.x || lastPoint.y !== point.y) {
    points.push(point);
  }

  state.skribblPainter.isDrawing = false;
  state.skribblPainter.pointerId = null;
  state.skribblPainter.points = [];

  if (!skribbl?.canDraw || !points.length) {
    renderSkribblCanvas(skribbl);
    return;
  }

  queueSkribblStrokeUpload({
    color: state.skribblPainter.color,
    width: state.skribblPainter.width,
    points,
  });
}

async function joinSkribblRoom() {
  if (!state.me || state.isSubmittingSkribbl) {
    return;
  }

  state.isSubmittingSkribbl = true;
  renderSkribbl();

  try {
    const payload = await api("/api/skribbl/join", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.me = payload.user;
    state.skribbl = payload.skribbl;
    state.bootstrap = {
      ...state.bootstrap,
      skribbl: payload.skribbl,
    };
    renderMetrics();
    renderSkribbl();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSkribbl = false;
    renderSkribbl();
  }
}

async function leaveSkribblRoom() {
  if (!state.me || state.isSubmittingSkribbl) {
    return;
  }

  state.isSubmittingSkribbl = true;
  renderSkribbl();

  try {
    const payload = await api("/api/skribbl/leave", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.me = payload.user;
    state.skribbl = payload.skribbl;
    state.bootstrap = {
      ...state.bootstrap,
      skribbl: payload.skribbl,
    };
    renderMetrics();
    renderSkribbl();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSkribbl = false;
    renderSkribbl();
  }
}

async function clearSkribblBoard() {
  const skribbl = getSkribblState();
  if (!state.me || state.isSubmittingSkribbl || !skribbl?.canClear) {
    return;
  }

  state.isSubmittingSkribbl = true;
  renderSkribbl();

  try {
    const payload = await api("/api/skribbl/clear", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.me = payload.user;
    state.skribbl = payload.skribbl;
    state.bootstrap = {
      ...state.bootstrap,
      skribbl: payload.skribbl,
    };
    state.skribblPainter.pendingStrokes = [];
    state.skribblPainter.uploadQueue = [];
    state.skribblPainter.lastRenderSignature = "";
    renderSkribbl();
    showToast(payload.message, "info");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSkribbl = false;
    renderSkribbl();
  }
}

async function onSkribblGuessSubmit(event) {
  event.preventDefault();
  const skribbl = getSkribblState();
  const guess = elements.skribblGuessInput.value.trim();

  if (!state.me || state.isSubmittingSkribbl || !skribbl?.canGuess || !guess) {
    return;
  }

  state.isSubmittingSkribbl = true;
  renderSkribbl();

  try {
    const payload = await api("/api/skribbl/guess", {
      method: "POST",
      body: JSON.stringify({ guess }),
    });

    state.me = payload.user;
    state.skribbl = payload.skribbl;
    state.bootstrap = {
      ...state.bootstrap,
      skribbl: payload.skribbl,
    };
    elements.skribblGuessInput.value = "";
    renderMetrics();
    renderSkribbl();

    if (payload.isCorrect) {
      showToast(payload.message, "success");
    }
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSkribbl = false;
    renderSkribbl();
  }
}

function getSlotsState() {
  return state.slots || state.bootstrap?.slots || null;
}

function getSlotConfig() {
  return getSlotsState()?.config || null;
}

function getSlotActiveBonus() {
  return (
    getSlotsState()?.activeBonus || {
      freeSpinsRemaining: 0,
      currentMultiplier: 1,
      lockedBet: 0,
    }
  );
}

function getSlotDisplayGrid() {
  if (state.slotDisplayGrid) {
    return state.slotDisplayGrid;
  }

  const latestSpin = state.slotLastSpinResult?.summary || getSlotsState()?.recentSpins?.[0]?.summary;
  return latestSpin?.finalGrid || latestSpin?.openingGrid || null;
}

function normalizeSlotBetValue(rawValue) {
  const slotConfig = getSlotConfig();
  if (!slotConfig) {
    return 100000;
  }

  const numeric = Number(rawValue || slotConfig.minBet);
  if (!Number.isFinite(numeric)) {
    return Number(slotConfig.minBet);
  }

  const bounded = Math.max(slotConfig.minBet, Math.min(slotConfig.maxBet, numeric));
  const steps = Math.round((bounded - slotConfig.minBet) / slotConfig.betStep);
  return slotConfig.minBet + steps * slotConfig.betStep;
}

function syncSlotBetInput() {
  const slotConfig = getSlotConfig();
  if (!slotConfig) {
    return;
  }

  const bonus = getSlotActiveBonus();
  const betValue = bonus.freeSpinsRemaining > 0 && bonus.lockedBet
    ? Number(bonus.lockedBet)
    : Number(state.selectedSlotBet || slotConfig.minBet);

  elements.slotBetInput.min = String(slotConfig.minBet);
  elements.slotBetInput.max = String(slotConfig.maxBet);
  elements.slotBetInput.step = String(slotConfig.betStep);
  elements.slotBetInput.value = String(betValue);
  elements.slotBetInput.disabled =
    state.isSubmittingSlotSpin || bonus.freeSpinsRemaining > 0;
}

function buildSlotBetPresets() {
  const slotConfig = getSlotConfig();
  if (!slotConfig) {
    elements.slotBetPresets.innerHTML = "";
    return;
  }

  const uniqueValues = Array.from(
    new Set([
      slotConfig.minBet,
      normalizeSlotBetValue(slotConfig.minBet * 2),
      normalizeSlotBetValue(slotConfig.minBet * 5),
      normalizeSlotBetValue(slotConfig.maxBet),
    ]),
  ).sort((left, right) => left - right);

  elements.slotBetPresets.innerHTML = uniqueValues
    .map(
      (value) => `
        <button
          class="chip-button ${Number(state.selectedSlotBet) === Number(value) ? "active" : ""}"
          type="button"
          data-slot-bet="${value}"
        >
          ${formatCompactKamas(value)}
        </button>
      `,
    )
    .join("");
}

function renderSlotGrid(grid = getSlotDisplayGrid()) {
  if (!grid) {
    elements.slotReels.innerHTML = `
      <div class="empty-state">Le croupier aligne encore les rouleaux.</div>
    `;
    return;
  }

  elements.slotReels.innerHTML = grid
    .map(
      (row) => `
        <div class="slot-row">
          ${row
            .map(
              (cell) => `
                <div class="slot-cell slot-${escapeHtml(cell.accent || "gold")} ${cell.isWild ? "is-wild" : ""} ${cell.isScatter ? "is-scatter" : ""}">
                  <span class="slot-cell-mark">${escapeHtml(cell.shortLabel)}</span>
                  <span class="slot-cell-name">${escapeHtml(cell.label)}</span>
                </div>
              `,
            )
            .join("")}
        </div>
      `,
    )
    .join("");
}

function renderSlotCascadeTrail(summary) {
  const cascades = summary?.cascades || [];

  if (!cascades.length) {
    elements.slotCascadeTrail.innerHTML = `
      <div class="empty-state">Aucune cascade sur ce spin. Les rouleaux sont restes calmes.</div>
    `;
    return;
  }

  elements.slotCascadeTrail.innerHTML = cascades
    .map(
      (cascade) => `
        <div class="probability-card compact">
          <span>Cascade ${cascade.index}</span>
          <strong>${formatKamas(cascade.totalWin)}</strong>
          <span>x${cascade.appliedMultiplier}</span>
        </div>
      `,
    )
    .join("");
}

function renderSlotPaytable(slotState) {
  const paytable = slotState?.config?.paytable || [];

  elements.slotPaytable.innerHTML = paytable
    .map((symbol) => {
      const note = symbol.isScatter
        ? "3+ scatters = free spins"
        : symbol.isWild
          ? "Substitue tout sauf scatter"
          : `${symbol.tier}`;
      return `
        <article class="slot-pay-card slot-${escapeHtml(symbol.accent || "gold")}">
          <div class="slot-pay-card-head">
            <div class="slot-pay-symbol">${escapeHtml(symbol.shortLabel)}</div>
            <div>
              <strong>${escapeHtml(symbol.symbolLabel)}</strong>
              <div class="bet-meta">${escapeHtml(note)}</div>
            </div>
          </div>
          <div class="slot-pay-values">
            <span>3x <strong>${symbol.payouts[3] || "-"}</strong></span>
            <span>4x <strong>${symbol.payouts[4] || "-"}</strong></span>
            <span>5x <strong>${symbol.payouts[5] || "-"}</strong></span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSlotProbabilityTable(slotState) {
  const tables = slotState?.config?.probabilityTable || [];

  if (!tables.length) {
    elements.slotProbabilityTable.innerHTML = `<div class="empty-state">Probabilites indisponibles.</div>`;
    return;
  }

  elements.slotProbabilityTable.innerHTML = tables
    .map((modeEntry) => {
      const firstReel = modeEntry.reels[0];
      const symbols = (firstReel?.symbols || []).map((symbol) => symbol.symbolId);

      return `
        <div class="slot-probability-block">
          <table>
            <thead>
              <tr>
                <th colspan="7">${escapeHtml(modeEntry.mode === "bonus" ? "Bonus game" : "Base game")}</th>
              </tr>
              <tr>
                <th>Symbole</th>
                <th>R1</th>
                <th>R2</th>
                <th>R3</th>
                <th>R4</th>
                <th>R5</th>
                <th>Visibles / spin</th>
              </tr>
            </thead>
            <tbody>
              ${symbols
                .map((symbolId) => {
                  const perReel = modeEntry.reels.map((reel) =>
                    reel.symbols.find((entry) => entry.symbolId === symbolId),
                  );
                  return `
                    <tr>
                      <td>${escapeHtml(perReel[0]?.symbolLabel || symbolId)}</td>
                      ${perReel
                        .map(
                          (entry) =>
                            `<td>${Number(entry?.probabilityPerCell || 0).toFixed(2)}%</td>`,
                        )
                        .join("")}
                      <td>${perReel
                        .map((entry) => Number(entry?.expectedVisiblePerSpin || 0))
                        .reduce((sum, value) => sum + value, 0)
                        .toFixed(2)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;
    })
    .join("");
}

function renderSlotMath(slotState) {
  const mathSnapshot = slotState?.mathSnapshot || {};
  const explanation = slotState?.mathExplanation || {};
  const metrics = [
    ["RTP simule", `${Number(mathSnapshot.rtp || 0).toFixed(2)}%`],
    ["RTP live compte", `${Number(slotState?.stats?.liveRtp || 0).toFixed(2)}%`],
    ["Hit frequency", `${Number(mathSnapshot.hitFrequency || 0).toFixed(2)}%`],
    [
      "Bonus frequency",
      mathSnapshot.bonusFrequency ? `1 / ${Number(mathSnapshot.bonusFrequency).toFixed(1)}` : "--",
    ],
    ["Variance", Number(mathSnapshot.variance || 0).toLocaleString("fr-FR")],
    ["Sigma", Number(mathSnapshot.standardDeviation || 0).toLocaleString("fr-FR")],
    ["Profit / 1M mise", formatKamas(Number(mathSnapshot.operatorProfitPerMillionWagered || 0))],
    ["Sample", Number(mathSnapshot.sampleSize || 0).toLocaleString("fr-FR")],
    ["Max observe", `x${Number(mathSnapshot.maxObservedWinMultiplier || 0).toFixed(2)}`],
  ];

  elements.slotMathGrid.innerHTML = metrics
    .map(
      ([label, value]) => `
        <div class="stats-card">
          <span>${escapeHtml(String(label))}</span>
          <strong>${escapeHtml(String(value))}</strong>
        </div>
      `,
    )
    .join("");

  elements.slotDistributionList.innerHTML = (mathSnapshot.distribution || [])
    .map(
      (entry) => `
        <div class="leaderboard-item">
          <div>
            <strong>${escapeHtml(entry.label)}</strong>
            <div class="bet-meta">${Number(entry.count || 0).toLocaleString("fr-FR")} spins</div>
          </div>
          <span>${Number(entry.frequency || 0).toFixed(2)}%</span>
        </div>
      `,
    )
    .join("");

  elements.slotBalancingList.innerHTML = [
    ...(explanation.balancingStrategy || []),
    ...(explanation.formulas || []),
  ]
    .map(
      (line) => `
        <div class="notification-item">
          <div class="bet-meta">${escapeHtml(line)}</div>
        </div>
      `,
    )
    .join("");
}

function renderSlotHistory(slotState) {
  const history = slotState?.recentSpins || [];

  if (!history.length) {
    elements.slotHistoryList.innerHTML = `<div class="empty-state">Aucun spin machine a sous enregistre.</div>`;
    return;
  }

  elements.slotHistoryList.innerHTML = history
    .map(
      (spin) => `
        <div class="history-item">
          <div>
            <strong>${spin.spinMode === "bonus" ? "Free spin" : "Spin payant"} #${spin.nonce}</strong>
            <div class="history-meta">
              ${formatDate(spin.createdAt)} - ${spin.summary.nearMiss ? "near miss 2 scatters" : `${spin.scatterCount} scatter(s)`}
            </div>
            <div class="bet-meta">
              ${spin.cascadeCount} cascade(s) - ${spin.freeSpinsAwarded > 0 ? `+${spin.freeSpinsAwarded} free spins` : "pas de bonus"}
            </div>
          </div>
          <div>
            <div>${formatKamas(spin.betAmount)}</div>
            <div class="${spin.netResult >= 0 ? "result-positive" : "result-negative"}">
              ${spin.netResult >= 0 ? "+" : ""}${formatKamas(spin.netResult)}
            </div>
          </div>
        </div>
      `,
    )
    .join("");
}

function renderSlotSeedState(slotState) {
  const provablyFair = slotState?.provablyFair;

  if (!provablyFair) {
    elements.slotHashBadge.textContent = "Seed --";
    elements.slotSeedMeta.textContent = "Chargement des seeds...";
    return;
  }

  elements.slotHashBadge.textContent = `Hash ${provablyFair.serverSeedHash.slice(0, 12)}...`;
  elements.slotClientSeedInput.value = provablyFair.clientSeed;
  elements.slotSeedMeta.innerHTML = `
    Hash serveur: <strong>${escapeHtml(provablyFair.serverSeedHash)}</strong><br />
    Client seed: <strong>${escapeHtml(provablyFair.clientSeed)}</strong><br />
    Nonce suivant: <strong>${provablyFair.nextNonce}</strong>
    ${provablyFair.previousReveal
      ? `<br />Reveal precedent: <strong>${escapeHtml(provablyFair.previousReveal.serverSeed)}</strong>`
      : ""}
  `;
}

function renderSlots() {
  const slotState = getSlotsState();

  if (!slotState) {
    elements.slotModeBadge.textContent = "Chargement";
    elements.slotStatusText.textContent = "La machine a sous se charge...";
    elements.slotSimpleNote.textContent = "Lecture des configurations serveur.";
    elements.slotHistoryList.innerHTML = `<div class="empty-state">Chargement...</div>`;
    renderSlotGrid(null);
    elements.slotSpinButton.disabled = true;
    return;
  }

  const bonus = getSlotActiveBonus();
  const latestSpin = state.slotLastSpinResult || slotState.recentSpins?.[0] || null;
  const latestSummary = latestSpin?.summary || null;
  const isBonus = bonus.freeSpinsRemaining > 0;

  if (!state.selectedSlotBet) {
    state.selectedSlotBet = Number(slotState.config.minBet);
  }

  elements.slotModeBadge.textContent = isBonus ? "Free spins actifs" : "Base game";
  elements.slotPaylineValue.textContent = `${slotState.config.paylines} lignes`;
  elements.slotLastWinValue.textContent = formatKamas(latestSpin?.totalWin || 0);
  elements.slotFreeSpinsValue.textContent = String(bonus.freeSpinsRemaining || 0);
  elements.slotMultiplierValue.textContent = `x${isBonus ? bonus.currentMultiplier : 1}`;
  elements.slotStatusText.textContent = latestSummary
    ? latestSummary.bigHit
      ? `Gros hit ${formatKamas(latestSummary.totalWin)}.`
      : latestSummary.freeSpinsAwarded > 0
        ? `${latestSummary.freeSpinsAwarded} free spins remportes.`
        : latestSummary.nearMiss
          ? "Deux scatters, le bonus etait tout proche."
          : latestSummary.hit
            ? `${formatKamas(latestSummary.totalWin)} tombent sur ce spin.`
            : "Rien sur ce spin, les rouleaux repartent."
    : "La machine attend ton premier spin.";
  elements.slotSimpleNote.textContent =
    bonus.freeSpinsRemaining > 0
      ? `Free spins en cours a ${formatKamas(bonus.lockedBet)} avec multiplicateur progressif.`
      : "Choisis ta mise puis lance. 3 scatters declenchent les free spins.";

  syncSlotBetInput();
  buildSlotBetPresets();
  renderSlotGrid();
  renderSlotCascadeTrail(latestSummary);
  renderSlotHistory(slotState);

  elements.slotSpinButton.disabled = state.isSubmittingSlotSpin || state.isSubmittingSlotSeed;
  elements.slotSpinButton.textContent = isBonus ? "Lancer le free spin" : "Lancer";
}

async function loadSlotsState(showToastOnError = false) {
  if (!state.me || state.isLoadingSlotsView) {
    return;
  }

  state.isLoadingSlotsView = true;
  renderSlots();

  try {
    const payload = await api("/api/slots/state");
    state.slots = payload.slots;
    if (!state.selectedSlotBet) {
      state.selectedSlotBet = Number(payload.slots?.config?.minBet || 100000);
    }
    renderMetrics();
    renderSlots();
  } catch (error) {
    if (showToastOnError) {
      showToast(error.message, "error");
    }
  } finally {
    state.isLoadingSlotsView = false;
    renderSlots();
  }
}

function buildRandomSlotDisplayGrid() {
  const paytable = getSlotConfig()?.paytable || [];
  if (!paytable.length) {
    return null;
  }

  return Array.from({ length: 4 }, () =>
    Array.from({ length: 5 }, () => {
      const symbol = paytable[Math.floor(Math.random() * paytable.length)];
      return {
        id: symbol.symbolId,
        label: symbol.symbolLabel,
        shortLabel: symbol.shortLabel,
        accent: symbol.accent,
        tier: symbol.tier,
        isWild: Boolean(symbol.isWild),
        isScatter: Boolean(symbol.isScatter),
      };
    }),
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function animateSlotResult(summary) {
  for (let index = 0; index < 4; index += 1) {
    state.slotDisplayGrid = buildRandomSlotDisplayGrid();
    renderSlots();
    await wait(110);
  }

  if (summary?.openingGrid) {
    state.slotDisplayGrid = summary.openingGrid;
    renderSlots();
    await wait(170);
  }

  const cascades = summary?.cascades || [];
  for (const cascade of cascades) {
    state.slotDisplayGrid = cascade.grid;
    renderSlots();
    await wait(140);
  }

  state.slotDisplayGrid = summary?.finalGrid || summary?.openingGrid || null;
  renderSlots();
}

async function submitSlotSpin() {
  if (!state.me || state.isSubmittingSlotSpin || state.isSubmittingSlotSeed) {
    return;
  }

  const slotConfig = getSlotConfig();
  if (!slotConfig) {
    return;
  }

  const betAmount =
    getSlotActiveBonus().freeSpinsRemaining > 0
      ? Number(getSlotActiveBonus().lockedBet || state.selectedSlotBet)
      : normalizeSlotBetValue(elements.slotBetInput.value);

  state.selectedSlotBet = betAmount;
  state.isSubmittingSlotSpin = true;
  renderSlots();

  try {
    const payload = await api("/api/slots/spin", {
      method: "POST",
      body: JSON.stringify({
        betAmount,
      }),
    });

    state.me = payload.user;
    state.slots = payload.slots;
    state.slotLastSpinResult = payload.spinResult;
    await animateSlotResult(payload.spinResult.summary);
    renderMetrics();
    renderSlots();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSlotSpin = false;
    renderSlots();
  }
}

function onSlotBetPresetClick(event) {
  const preset = event.target.closest("[data-slot-bet]");
  if (!preset) {
    return;
  }

  state.selectedSlotBet = normalizeSlotBetValue(preset.dataset.slotBet);
  syncSlotBetInput();
  buildSlotBetPresets();
}

function onSlotBetInputChange() {
  state.selectedSlotBet = normalizeSlotBetValue(elements.slotBetInput.value);
  syncSlotBetInput();
  buildSlotBetPresets();
}

async function onSlotClientSeedSubmit(event) {
  event.preventDefault();

  if (state.isSubmittingSlotSeed) {
    return;
  }

  state.isSubmittingSlotSeed = true;
  renderSlots();

  try {
    const payload = await api("/api/slots/seed", {
      method: "POST",
      body: JSON.stringify({
        clientSeed: elements.slotClientSeedInput.value,
      }),
    });

    state.slots = payload.slots;
    renderSlots();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSlotSeed = false;
    renderSlots();
  }
}

async function rotateSlotSeedPair() {
  if (state.isSubmittingSlotSeed) {
    return;
  }

  state.isSubmittingSlotSeed = true;
  renderSlots();

  try {
    const payload = await api("/api/slots/seed/rotate", {
      method: "POST",
      body: JSON.stringify({
        clientSeed: elements.slotClientSeedInput.value,
      }),
    });

    state.slots = payload.slots;
    renderSlots();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingSlotSeed = false;
    renderSlots();
  }
}

function setActiveView(view) {
  state.activeView =
    view === "poker"
      ? "poker"
      : view === "connect4"
        ? "connect4"
        : view === "skribbl"
          ? "skribbl"
        : view === "slots"
          ? "slots"
          : "roulette";
  elements.viewRouletteButton.classList.toggle("active", state.activeView === "roulette");
  elements.viewPokerButton.classList.toggle("active", state.activeView === "poker");
  elements.viewConnect4Button.classList.toggle("active", state.activeView === "connect4");
  elements.viewSkribblButton.classList.toggle("active", state.activeView === "skribbl");
  elements.viewSlotsButton.classList.toggle("active", state.activeView === "slots");
  elements.rouletteView.classList.toggle("hidden", state.activeView !== "roulette");
  elements.pokerView.classList.toggle("hidden", state.activeView !== "poker");
  elements.connect4View.classList.toggle("hidden", state.activeView !== "connect4");
  elements.skribblView.classList.toggle("hidden", state.activeView !== "skribbl");
  elements.slotsView.classList.toggle("hidden", state.activeView !== "slots");

  if (state.activeView === "slots" && state.me && !state.isLoadingSlotsView) {
    if (!state.slots) {
      loadSlotsState(false);
    } else {
      renderSlots();
    }
  }

  if (state.activeView === "connect4") {
    renderConnect4();
  }

  if (state.activeView === "skribbl") {
    renderSkribbl();
  }

  renderMetrics();
}

function onConnect4ColumnSelect(event) {
  const cell = event.target.closest(".connect4-board-cell[data-connect4-column]");
  if (!cell) {
    return;
  }

  submitConnect4Move(cell.dataset.connect4Column);
}

async function joinConnect4Table() {
  if (!state.me || state.isSubmittingConnect4) {
    return;
  }

  state.isSubmittingConnect4 = true;
  renderConnect4();

  try {
    const payload = await api("/api/connect4/join", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.me = payload.user;
    state.connect4 = payload.connect4;
    syncConnect4StartSoundState(state.connect4);
    state.bootstrap = {
      ...state.bootstrap,
      connect4: payload.connect4,
    };
    renderMetrics();
    renderConnect4();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingConnect4 = false;
    renderConnect4();
  }
}

async function leaveConnect4Table() {
  if (!state.me || state.isSubmittingConnect4) {
    return;
  }

  state.isSubmittingConnect4 = true;
  renderConnect4();

  try {
    const payload = await api("/api/connect4/leave", {
      method: "POST",
      body: JSON.stringify({}),
    });

    state.me = payload.user;
    state.connect4 = payload.connect4;
    syncConnect4StartSoundState(state.connect4);
    state.bootstrap = {
      ...state.bootstrap,
      connect4: payload.connect4,
    };
    renderMetrics();
    renderConnect4();
    showToast(payload.message, "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingConnect4 = false;
    renderConnect4();
  }
}

async function submitConnect4Move(column) {
  const connect4 = getConnect4State();

  if (
    !state.me
    || state.isSubmittingConnect4
    || !connect4
    || connect4.status !== "playing"
    || !connect4.myTurn
  ) {
    return;
  }

  state.isSubmittingConnect4 = true;
  renderConnect4();

  try {
    const payload = await api("/api/connect4/move", {
      method: "POST",
      body: JSON.stringify({
        column: Number(column),
      }),
    });

    state.me = payload.user;
    state.connect4 = payload.connect4;
    syncConnect4StartSoundState(state.connect4);
    state.bootstrap = {
      ...state.bootstrap,
      connect4: payload.connect4,
    };
    renderMetrics();
    renderConnect4();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isSubmittingConnect4 = false;
    renderConnect4();
  }
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
  const flop = Array.from({ length: 3 }, (_unused, index) =>
    renderPokerCard(cards[index], { empty: !cards[index] }),
  ).join("");
  const turn = renderPokerCard(cards[3], { empty: !cards[3] });
  const river = renderPokerCard(cards[4], { empty: !cards[4] });

  elements.pokerBoard.innerHTML = `
    <div class="poker-board-group flop-group">${flop}</div>
    <div class="poker-board-group street-group">${turn}</div>
    <div class="poker-board-group street-group">${river}</div>
  `;
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
            <strong class="poker-seat-label">Siege ${seat.seatNo}</strong>
            <span class="bet-meta">Libre</span>
          </article>
        `;
      }

      const cardsMarkup = seat.holeCards?.length
        ? seat.holeCards.map((card) => renderPokerCard(card)).join("")
        : Array.from({ length: seat.cardsCount || 0 }, () =>
            renderPokerCard(null, { hidden: true }),
          ).join("");
      const seatFlags = [
        `S${seat.seatNo}`,
        seat.isDealer ? "Dealer" : "",
        seat.isSmallBlind ? "SB" : "",
        seat.isBigBlind ? "BB" : "",
      ]
        .filter(Boolean)
        .join(" | ");
      const contributionLabel =
        seat.handContribution > 0
          ? `Engage ${formatCompactKamas(seat.handContribution)}`
          : "En attente";

      return `
        <article class="poker-seat seat-${seat.seatNo} ${seat.isTurn ? "turn" : ""} ${seat.isMe ? "me" : ""}">
          <div class="poker-seat-head">
            <strong>${escapeHtml(seat.username)}</strong>
            <span class="status-pill seat-status">${escapeHtml(formatPokerSeatState(seat.seatState))}</span>
          </div>
          <div class="poker-seat-meta">
            <span>${escapeHtml(seatFlags)}</span>
            <span>Stack ${formatCompactKamas(seat.stack)}</span>
          </div>
          <div class="bet-meta">${escapeHtml(contributionLabel)}</div>
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
      poker.status === "showdown"
        ? poker.secondsToNextHand > 0
          ? `Pause entre deux mains: ${poker.secondsToNextHand}s pour quitter ou rester assis.`
          : "Pause entre deux mains, tu peux quitter la table maintenant."
        : actions.leaveReason || actions.joinReason || "Ta place est enregistree.";
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
    elements.pokerActionHint.textContent =
      poker.secondsToNextHand > 0
        ? `Pause de ${poker.secondsToNextHand}s avant la prochaine main.`
        : poker.winnerSummary || "Resolution de la main.";
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
  const form = event.currentTarget;

  if (state.isSubmittingCashout) {
    return;
  }

  const formData = new FormData(form);
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
    form.reset();
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
  }, 1000);

  state.countdownTimer = window.setInterval(() => {
    tickRoundCountdown();
  }, 1000);
}

function tickRoundCountdown() {
  const currentRound = state.bootstrap?.currentRound;
  if (!currentRound) {
    renderRoundPanel();
    renderConnect4();
    renderSkribbl();
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
  if (state.connect4?.status === "playing" && state.connect4.secondsToAct > 0) {
    state.connect4.secondsToAct -= 1;
  }
  if (state.connect4?.status === "showdown" && state.connect4.secondsToNextGame > 0) {
    state.connect4.secondsToNextGame -= 1;
  }
  renderConnect4();
  if (state.skribbl?.status === "playing" && state.skribbl.secondsToEnd > 0) {
    state.skribbl.secondsToEnd -= 1;
  }
  if (state.skribbl?.status === "showdown" && state.skribbl.secondsToNextRound > 0) {
    state.skribbl.secondsToNextRound -= 1;
  }
  renderSkribbl();
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
  state.connect4 = payload.connect4 || state.connect4;
  syncConnect4StartSoundState(state.connect4);
  state.skribbl = payload.skribbl || state.skribbl;
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
    connect4: state.connect4,
    skribbl: state.skribbl,
    poker: state.poker,
  };

  renderMetrics();
  renderRoundPanel();
  renderLastNumbers(payload.lastNumbers);
  renderCashoutSection();
  renderConnect4();
  renderSkribbl();
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
