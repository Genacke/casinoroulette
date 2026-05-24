(function bootstrapCommon() {
  const toastRoot = document.createElement("div");
  toastRoot.className = "toast-stack";
  document.addEventListener("DOMContentLoaded", () => {
    document.body.appendChild(toastRoot);
  });

  function formatKamas(value) {
    return `${Number(value || 0).toLocaleString("fr-FR")} kamas`;
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }

    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });

    const payload = await response.json().catch(() => ({
      success: false,
      message: "Reponse serveur invalide.",
    }));

    if (!response.ok || payload.success === false) {
      throw new Error(payload.message || "Erreur serveur.");
    }

    return payload;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastRoot.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("toast-out");
      window.setTimeout(() => toast.remove(), 320);
    }, 3200);
  }

  function createAudioEngine() {
    let context = null;

    const ensureContext = async () => {
      if (!context) {
        context = new (window.AudioContext || window.webkitAudioContext)();
      }

      if (context.state === "suspended") {
        await context.resume();
      }

      return context;
    };

    const playTone = async (frequency, duration, gain = 0.05, type = "sine") => {
      const audioContext = await ensureContext();
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();

      oscillator.type = type;
      oscillator.frequency.value = frequency;
      volume.gain.value = gain;

      oscillator.connect(volume);
      volume.connect(audioContext.destination);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);

      volume.gain.setValueAtTime(gain, audioContext.currentTime);
      volume.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + duration,
      );
    };

    return {
      matchStart: async () => {
        await playTone(420, 0.08, 0.035, "triangle");
        await playTone(560, 0.08, 0.04, "triangle");
        await playTone(740, 0.16, 0.045, "square");
      },
      spin: () => playTone(240, 0.35, 0.03, "triangle"),
      win: async () => {
        await playTone(660, 0.18, 0.045, "square");
        await playTone(880, 0.28, 0.05, "triangle");
      },
      lose: () => playTone(160, 0.3, 0.03, "sawtooth"),
    };
  }

  window.CasinoCommon = {
    api,
    createAudioEngine,
    escapeHtml,
    formatDate,
    formatKamas,
    showToast,
  };
})();
