"use strict";

/* Browser persistence with a run-local memory store and no storage requirement in Node. */
const OMMStorage = (() => {
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const { SETTINGS_VERSION, DEFAULT_TUNING, isDifficulty, sanitizeTuning } = config;
  const MEMORY_STORE_KEY = "one-more-move-memory-v2";

  function getBestKey(seedMode, seed, selectedDifficulty) {
    const normalizedMode = String(seedMode || "RUN").toUpperCase();
    const identity = ["DAILY", "MANUAL", "REPLAY"].includes(normalizedMode)
      ? `${normalizedMode}-${seed >>> 0}`
      : normalizedMode;
    return `${selectedDifficulty}:${identity}`;
  }

  function createStorage({ hasDOM, debugLog }) {
    let memoryStore = {
      settings: {},
      difficulty: "standard",
      bestScores: {},
      muted: false,
    };

    function tuningKey() {
      return `one-more-move-tuning-v${SETTINGS_VERSION}`;
    }

    function isRecord(value) {
      return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    function normalizeMemoryStore(value) {
      if (!isRecord(value)) return;
      if (isRecord(value.settings)) memoryStore.settings = Object.assign(Object.create(null), value.settings);
      if (isDifficulty(value.difficulty)) memoryStore.difficulty = value.difficulty;
      if (isRecord(value.bestScores)) {
        const scores = Object.create(null);
        for (const [key, raw] of Object.entries(value.bestScores)) {
          const score = typeof raw === "number" || (typeof raw === "string" && /^\d+$/.test(raw)) ? Number(raw) : NaN;
          if (Number.isSafeInteger(score) && score >= 0) scores[key] = score;
        }
        memoryStore.bestScores = scores;
      }
      if (typeof value.muted === "boolean") memoryStore.muted = value.muted;
    }

    function loadMemoryStore() {
      if (!hasDOM) return;
      try {
        const raw = window.localStorage.getItem(MEMORY_STORE_KEY);
        if (raw) normalizeMemoryStore(JSON.parse(raw));
      } catch (error) {
        debugLog("Storage load failed", error);
      }
    }

    function saveMemoryStore() {
      if (!hasDOM) return;
      try {
        window.localStorage.setItem(MEMORY_STORE_KEY, JSON.stringify(memoryStore));
      } catch (error) {
        debugLog("Storage save failed", error);
      }
    }

    function loadTuning() {
      const raw = memoryStore.settings[tuningKey()];
      if (!raw || typeof raw !== "object" || raw.version !== SETTINGS_VERSION) {
        const defaults = { ...DEFAULT_TUNING };
        memoryStore.settings[tuningKey()] = defaults;
        saveMemoryStore();
        return defaults;
      }
      return sanitizeTuning({ ...DEFAULT_TUNING, ...raw });
    }

    function persistTuning(tuning) {
      memoryStore.settings[tuningKey()] = { ...tuning };
      saveMemoryStore();
    }

    return Object.freeze({ memoryStore, loadMemoryStore, saveMemoryStore, loadTuning, persistTuning });
  }

  return Object.freeze({ createStorage, getBestKey });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMStorage;
