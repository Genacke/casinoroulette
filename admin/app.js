const { api, escapeHtml, formatDate, formatKamas, showToast } = window.CasinoCommon;

const state = {
  me: null,
  dashboard: null,
  users: [],
  selectedUser: null,
  latestResetCode: null,
  isResettingPassword: false,
  currentLogType: "spins",
  refreshTimer: null,
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  hydrateAdminSession();
});

function cacheElements() {
  Object.assign(elements, {
    adminApp: document.getElementById("adminApp"),
    adminAuthGate: document.getElementById("adminAuthGate"),
    adminBalancePool: document.getElementById("adminBalancePool"),
    adminLoginForm: document.getElementById("adminLoginForm"),
    adminLogoutButton: document.getElementById("adminLogoutButton"),
    adminPendingCashouts: document.getElementById("adminPendingCashouts"),
    adminPlayerCount: document.getElementById("adminPlayerCount"),
    adminTotalSpins: document.getElementById("adminTotalSpins"),
    adminTotalWagered: document.getElementById("adminTotalWagered"),
    balanceAdjustForm: document.getElementById("balanceAdjustForm"),
    logsTable: document.getElementById("logsTable"),
    pendingCashoutRequests: document.getElementById("pendingCashoutRequests"),
    playerResults: document.getElementById("playerResults"),
    playerSearchForm: document.getElementById("playerSearchForm"),
    playerSearchInput: document.getElementById("playerSearchInput"),
    recentBalances: document.getElementById("recentBalances"),
    recentLogins: document.getElementById("recentLogins"),
    recentSpins: document.getElementById("recentSpins"),
    selectedPlayerCard: document.getElementById("selectedPlayerCard"),
    winningPlayersList: document.getElementById("winningPlayersList"),
  });
}

function bindEvents() {
  elements.adminLoginForm.addEventListener("submit", onAdminLogin);
  elements.adminLogoutButton.addEventListener("click", logout);
  elements.playerSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchPlayers(elements.playerSearchInput.value.trim());
  });
  elements.balanceAdjustForm.addEventListener("submit", onBalanceAdjust);
  elements.pendingCashoutRequests.addEventListener("click", onPendingCashoutAction);

  document.querySelectorAll(".log-filter").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentLogType = button.dataset.logType;
      document.querySelectorAll(".log-filter").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      loadLogs();
    });
  });

  elements.playerResults.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-select-user]");
    if (!selectButton) {
      return;
    }

    const selectedId = Number(selectButton.dataset.selectUser);
    state.selectedUser = state.users.find((user) => user.id === selectedId) || null;
    renderSelectedPlayer();
  });
  elements.selectedPlayerCard.addEventListener("click", onSelectedPlayerCardAction);
}

async function hydrateAdminSession() {
  try {
    const payload = await api("/api/auth/me");
    if (!payload.user || payload.user.role !== "admin") {
      showAuth();
      return;
    }

    state.me = payload.user;
    await loadDashboard();
    showApp();
  } catch (error) {
    showToast(error.message, "error");
    showAuth();
  }
}

function showAuth() {
  elements.adminAuthGate.classList.remove("hidden");
  elements.adminApp.classList.add("hidden");
  elements.adminLogoutButton.classList.add("hidden");
}

function showApp() {
  elements.adminAuthGate.classList.add("hidden");
  elements.adminApp.classList.remove("hidden");
  elements.adminLogoutButton.classList.remove("hidden");
}

async function onAdminLogin(event) {
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

    if (payload.user.role !== "admin") {
      await api("/api/auth/logout", { method: "POST" });
      throw new Error("Ce compte n'a pas les droits admin.");
    }

    state.me = payload.user;
    await loadDashboard();
    showApp();
    event.currentTarget.reset();
    showToast("Connexion admin reussie.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch (_error) {
    // Rien de bloquant ici.
  }

  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }

  state.me = null;
  state.dashboard = null;
  state.users = [];
  state.selectedUser = null;
  state.latestResetCode = null;
  state.isResettingPassword = false;
  showAuth();
}

async function loadDashboard() {
  const payload = await api("/api/admin/dashboard");
  state.dashboard = payload;
  renderDashboard();
  await Promise.all([searchPlayers(""), loadLogs()]);
  resetRefresh();
}

async function searchPlayers(search) {
  try {
    const payload = await api(`/api/admin/users?search=${encodeURIComponent(search)}`);
    state.users = payload.users;
    if (state.selectedUser) {
      state.selectedUser =
        state.users.find((user) => user.id === state.selectedUser.id) || state.selectedUser;
    }
    renderPlayerResults();
    renderSelectedPlayer();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderDashboard() {
  const summary = state.dashboard?.summary;
  if (!summary) {
    return;
  }

  elements.adminPlayerCount.textContent = String(summary.playerCount);
  elements.adminBalancePool.textContent = formatKamas(summary.playerBalance);
  elements.adminTotalWagered.textContent = formatKamas(summary.totalWagered);
  elements.adminTotalSpins.textContent = String(summary.totalSpins || 0);
  elements.adminPendingCashouts.textContent = String(summary.pendingCashoutCount || 0);

  renderPendingCashoutRequests(state.dashboard.pendingCashoutRequests);
  renderWinningPlayers(state.dashboard.winningPlayers);
  renderMiniLogs(elements.recentLogins, state.dashboard.recentLogins, renderLoginLine);
  renderMiniLogs(elements.recentBalances, state.dashboard.recentBalances, renderBalanceLine);
  renderMiniLogs(elements.recentSpins, state.dashboard.recentSpins, renderSpinLine);
}

function renderWinningPlayers(players) {
  if (!players?.length) {
    elements.winningPlayersList.innerHTML = `<div class="empty-state">Aucun gagnant a afficher.</div>`;
    return;
  }

  elements.winningPlayersList.innerHTML = players
    .map(
      (player, index) => `
        <div class="leaderboard-item">
          <div>
            <strong>#${index + 1} ${escapeHtml(player.username)}</strong>
            <div class="bet-meta">Profit ${formatKamas(player.totalProfit)}</div>
          </div>
          <span>${formatKamas(player.balance)}</span>
        </div>
      `,
    )
      .join("");
}

function renderPendingCashoutRequests(requests) {
  if (!requests?.length) {
    elements.pendingCashoutRequests.innerHTML = `
      <div class="empty-state">Aucune demande de cash out en attente.</div>
    `;
    return;
  }

  elements.pendingCashoutRequests.innerHTML = requests
    .map(
      (request) => `
        <article class="cashout-admin-card">
          <div class="cashout-admin-head">
            <div>
              <strong>${escapeHtml(request.username)}</strong>
              <div class="bet-meta">Demande le ${formatDate(request.createdAt)}</div>
            </div>
            <span class="status-pill">${formatKamas(request.amount)}</span>
          </div>
          <div class="bet-meta">Solde actuel: ${formatKamas(request.currentBalance)}</div>
          <div class="bet-meta">
            Commission ${request.feePercent}%: ${formatKamas(request.feeAmount)} - a remettre ${formatKamas(request.netAmount)}
          </div>
          ${
            request.note
              ? `<div class="bet-meta">Note joueur: ${escapeHtml(request.note)}</div>`
              : ""
          }
          <label class="cashout-admin-note">
            <span>Note admin</span>
            <input
              type="text"
              maxlength="180"
              placeholder="Ex: donne en jeu ce soir"
              data-admin-note="${request.id}"
            />
          </label>
          <div class="cashout-admin-actions">
            <button
              class="secondary-button"
              data-cashout-action="complete"
              data-request-id="${request.id}"
              type="button"
            >
              Valider et debiter
            </button>
            <button
              class="ghost-button"
              data-cashout-action="reject"
              data-request-id="${request.id}"
              type="button"
            >
              Refuser
            </button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderPlayerResults() {
  if (!state.users.length) {
    elements.playerResults.innerHTML = `<div class="empty-state">Aucun joueur trouve.</div>`;
    return;
  }

  elements.playerResults.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Pseudo</th>
          <th>Role</th>
          <th>Solde</th>
          <th>Profit</th>
          <th>Derniere connexion</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${state.users
          .map(
            (user) => `
              <tr>
                <td>${escapeHtml(user.username)}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${formatKamas(user.balance)}</td>
                <td>${formatKamas(user.totalProfit)}</td>
                <td>${formatDate(user.lastLoginAt)}</td>
                <td>
                  ${
                    user.role === "player"
                      ? `<button class="action-button" data-select-user="${user.id}" type="button">Selectionner</button>`
                      : "-"
                  }
                </td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderSelectedPlayer() {
  if (!state.selectedUser) {
    elements.selectedPlayerCard.textContent = "Aucun joueur selectionne.";
    return;
  }

  const latestResetCode =
    state.latestResetCode?.userId === state.selectedUser.id ? state.latestResetCode : null;

  elements.selectedPlayerCard.innerHTML = `
    <strong>${escapeHtml(state.selectedUser.username)}</strong>
    <div class="bet-meta">Solde: ${formatKamas(state.selectedUser.balance)}</div>
    <div class="bet-meta">Wagered: ${formatKamas(state.selectedUser.totalWagered)}</div>
    <div class="bet-meta">Profit: ${formatKamas(state.selectedUser.totalProfit)}</div>
    <div class="bet-meta">Plus gros gain: ${formatKamas(state.selectedUser.highestWin)}</div>
    <div class="bet-meta">Inscrit le: ${formatDate(state.selectedUser.createdAt)}</div>
    <button
      class="secondary-button admin-reset-trigger"
      type="button"
      data-reset-password
      ${state.isResettingPassword ? "disabled" : ""}
    >
      ${state.isResettingPassword ? "Generation..." : "Reinitialiser le mot de passe"}
    </button>
    ${
      latestResetCode
        ? `
          <div class="admin-reset-card">
            <div class="section-title">Code temporaire a transmettre</div>
            <div class="admin-reset-code-row">
              <code class="admin-reset-code">${escapeHtml(latestResetCode.code)}</code>
              <button class="ghost-button" type="button" data-copy-reset-code>Copier</button>
            </div>
            <div class="bet-meta">
              Ce code remplace le mot de passe actuel et deconnecte les anciennes sessions.
            </div>
            <div class="bet-meta">Genere le ${formatDate(latestResetCode.createdAt)}</div>
          </div>
        `
        : ""
    }
  `;
}

async function onSelectedPlayerCardAction(event) {
  const resetButton = event.target.closest("[data-reset-password]");
  if (resetButton) {
    await requestPasswordReset();
    return;
  }

  const copyButton = event.target.closest("[data-copy-reset-code]");
  if (!copyButton || !state.latestResetCode?.code) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.latestResetCode.code);
    showToast("Code temporaire copie.", "success");
  } catch (_error) {
    showToast("Impossible de copier automatiquement le code.", "error");
  }
}

async function onBalanceAdjust(event) {
  event.preventDefault();

  if (!state.selectedUser) {
    showToast("Selectionne un joueur avant tout ajustement.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);

  try {
    const payload = await api(`/api/admin/users/${state.selectedUser.id}/balance`, {
      method: "POST",
      body: JSON.stringify({
        action: formData.get("action"),
        amount: formData.get("amount"),
        note: formData.get("note"),
      }),
    });

    showToast(payload.message, "success");
    state.dashboard = payload.dashboard;
    renderDashboard();
    await searchPlayers(elements.playerSearchInput.value.trim());
    state.selectedUser =
      state.users.find((user) => user.id === state.selectedUser.id) || payload.user;
    renderSelectedPlayer();
    await loadLogs();
    event.currentTarget.reset();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function requestPasswordReset() {
  if (!state.selectedUser) {
    showToast("Selectionne un joueur avant de generer un code.", "error");
    return;
  }

  if (state.isResettingPassword) {
    return;
  }

  state.isResettingPassword = true;
  renderSelectedPlayer();

  try {
    const payload = await api(`/api/admin/users/${state.selectedUser.id}/reset-password`, {
      method: "POST",
    });

    state.latestResetCode = {
      userId: state.selectedUser.id,
      code: payload.temporaryCode,
      codeHint: payload.codeHint,
      createdAt: new Date().toISOString(),
    };

    showToast(payload.message, "success");
    await searchPlayers(elements.playerSearchInput.value.trim());
    state.selectedUser =
      state.users.find((user) => user.id === state.selectedUser.id) || payload.user;
    renderSelectedPlayer();
    await loadLogs();
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    state.isResettingPassword = false;
    renderSelectedPlayer();
  }
}

async function onPendingCashoutAction(event) {
  const actionButton = event.target.closest("[data-cashout-action]");
  if (!actionButton) {
    return;
  }

  const requestId = Number(actionButton.dataset.requestId);
  const action = actionButton.dataset.cashoutAction;
  const noteInput = elements.pendingCashoutRequests.querySelector(
    `[data-admin-note="${requestId}"]`,
  );
  const adminNote = noteInput?.value.trim() || "";

  try {
    const payload = await api(`/api/admin/cashout-requests/${requestId}`, {
      method: "POST",
      body: JSON.stringify({
        action,
        adminNote,
      }),
    });

    showToast(payload.message, "success");
    state.dashboard = payload.dashboard;
    renderDashboard();
    await searchPlayers(elements.playerSearchInput.value.trim());
    if (state.selectedUser) {
      state.selectedUser =
        state.users.find((user) => user.id === state.selectedUser.id) || state.selectedUser;
      renderSelectedPlayer();
    }
    await loadLogs();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function loadLogs() {
  try {
    const payload = await api(`/api/admin/logs?type=${state.currentLogType}&limit=20`);
    renderLogs(payload.type, payload.rows);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderLogs(type, rows) {
  if (!rows?.length) {
    elements.logsTable.innerHTML = `<div class="empty-state">Aucune entree pour ce filtre.</div>`;
    return;
  }

  if (type === "logins") {
    elements.logsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Pseudo</th>
            <th>Role</th>
            <th>IP</th>
            <th>Succes</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.usernameAttempt)}</td>
                  <td>${escapeHtml(row.roleAttempt)}</td>
                  <td>${escapeHtml(row.ipAddress || "-")}</td>
                  <td>${row.success ? "Oui" : "Non"}</td>
                  <td>${formatDate(row.createdAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
    return;
  }

  if (type === "balances") {
    elements.logsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Joueur</th>
            <th>Action</th>
            <th>Montant</th>
            <th>Avant</th>
            <th>Apres</th>
            <th>Admin</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.username)}</td>
                  <td>${escapeHtml(row.type)}</td>
                  <td>${formatKamas(row.amount)}</td>
                  <td>${formatKamas(row.balanceBefore)}</td>
                  <td>${formatKamas(row.balanceAfter)}</td>
                  <td>${escapeHtml(row.adminUsername || "-")}</td>
                  <td>${escapeHtml(row.note || "-")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
    return;
  }

  if (type === "resets") {
    elements.logsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Joueur</th>
            <th>Indice code</th>
            <th>Admin</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.username)}</td>
                  <td>${escapeHtml(row.codeHint)}</td>
                  <td>${escapeHtml(row.adminUsername)}</td>
                  <td>${formatDate(row.createdAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
    return;
  }

  if (type === "bets") {
    elements.logsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Joueur</th>
            <th>Type</th>
            <th>Valeur</th>
            <th>Mise</th>
            <th>Retour</th>
            <th>Resultat</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.username)}</td>
                  <td>${escapeHtml(row.betType)}</td>
                  <td>${escapeHtml(String(row.betValue))}</td>
                  <td>${formatKamas(row.amount)}</td>
                  <td>${formatKamas(row.totalReturn)}</td>
                  <td>${row.resultNumber}</td>
                  <td>${formatDate(row.createdAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
    return;
  }

  if (type === "cashouts") {
    elements.logsTable.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Joueur</th>
            <th>Brut</th>
            <th>Commission</th>
            <th>Net</th>
            <th>Statut</th>
            <th>Note joueur</th>
            <th>Note admin</th>
            <th>Admin</th>
            <th>Demande</th>
            <th>Traitement</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${escapeHtml(row.username)}</td>
                  <td>${formatKamas(row.amount)}</td>
                  <td>${formatKamas(row.feeAmount)}</td>
                  <td>${formatKamas(row.netAmount)}</td>
                  <td>${escapeHtml(row.status)}</td>
                  <td>${escapeHtml(row.note || "-")}</td>
                  <td>${escapeHtml(row.adminNote || "-")}</td>
                  <td>${escapeHtml(row.adminUsername || "-")}</td>
                  <td>${formatDate(row.createdAt)}</td>
                  <td>${formatDate(row.processedAt || row.cancelledAt)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    `;
    return;
  }

  elements.logsTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Joueur</th>
          <th>Numero</th>
          <th>Mise</th>
          <th>Payout</th>
          <th>Net</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <td>${escapeHtml(row.username)}</td>
                <td>${row.resultNumber} (${escapeHtml(row.resultColor)})</td>
                <td>${formatKamas(row.totalBet)}</td>
                <td>${formatKamas(row.totalPayout)}</td>
                <td>${formatKamas(row.netResult)}</td>
                <td>${formatDate(row.createdAt)}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderMiniLogs(container, rows, formatter) {
  if (!rows?.length) {
    container.innerHTML = `<div class="empty-state">Aucune donnee.</div>`;
    return;
  }

  container.innerHTML = rows.map(formatter).join("");
}

function renderLoginLine(row) {
  return `
    <div class="mini-log-item">
      <strong>${escapeHtml(row.usernameAttempt)}</strong>
      <div class="mini-log-meta">${row.success ? "Succes" : "Echec"} • ${escapeHtml(row.ipAddress || "-")}</div>
      <div class="mini-log-meta">${formatDate(row.createdAt)}</div>
    </div>
  `;
}

function renderBalanceLine(row) {
  return `
    <div class="mini-log-item">
      <strong>${escapeHtml(row.username)} • ${escapeHtml(row.type)}</strong>
      <div class="mini-log-meta">${formatKamas(row.amount)} • ${escapeHtml(row.note || "-")}</div>
      <div class="mini-log-meta">${formatDate(row.createdAt)}</div>
    </div>
  `;
}

function renderSpinLine(row) {
  return `
    <div class="mini-log-item">
      <strong>${escapeHtml(row.username)} • ${row.resultNumber}</strong>
      <div class="mini-log-meta">Mise ${formatKamas(row.totalBet)} • Net ${formatKamas(row.netResult)}</div>
      <div class="mini-log-meta">${formatDate(row.createdAt)}</div>
    </div>
  `;
}

function resetRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }

  state.refreshTimer = window.setInterval(async () => {
    try {
      await loadDashboard();
    } catch (_error) {
      // Le prochain cycle reessaiera.
    }
  }, 20000);
}
