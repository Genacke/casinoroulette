function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function levelFromWagered(totalWagered) {
  return Math.max(1, 1 + Math.floor(Number(totalWagered || 0) / 100000));
}

function normalizeUsername(username) {
  return String(username || "").trim();
}

function normalizeMessage(message) {
  return escapeHtml(String(message || "").trim().replace(/\s+/g, " "));
}

function parsePositiveInteger(value) {
  if (!/^\d+$/.test(String(value))) {
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

module.exports = {
  clamp,
  escapeHtml,
  levelFromWagered,
  normalizeMessage,
  normalizeUsername,
  parsePositiveInteger,
};
