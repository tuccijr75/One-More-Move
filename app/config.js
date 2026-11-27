"use strict";

/* Canonical immutable difficulty profiles and validated tuning. */
const OMMConfig = (() => {
  const SETTINGS_VERSION = 2;
  const WALL_ADD_EVERY_STAGES = 5;
  const WALL_MAX = 30;
  const GLOBAL_COOLDOWN_MS = 30000;

  const DEFAULT_TUNING = Object.freeze({
    version: SETTINGS_VERSION,
    walls: 10,
    initialEnemies: 2,
    initialSpawn: 10,
    rampSpeed: 15,
    escapePenalty: 1.5,
    gapFillBonus: 3.0,
  });

  const BASE_DIFFICULTY_CONFIG = Object.freeze({
    standard: Object.freeze({
      turnDelay: 150,
      showIntentFlash: true,
      spawnFloor: 3,
      dangerFeedback: true,
      chaseWeight: 1,
      interceptWeight: 1,
      trapWeight: 1,
      commitLockTurns: 1,
      squeezeBonus: 2,
    }),
    hard: Object.freeze({
      turnDelay: 120,
      showIntentFlash: true,
      spawnFloor: 3,
      dangerFeedback: true,
      chaseWeight: 1,
      interceptWeight: 2,
      trapWeight: 2,
      commitLockTurns: 2,
      squeezeBonus: 5,
    }),
    hardcore: Object.freeze({
      turnDelay: 80,
      showIntentFlash: false,
      spawnFloor: 2,
      dangerFeedback: false,
      chaseWeight: 1,
      interceptWeight: 3,
      trapWeight: 3,
      commitLockTurns: 3,
      squeezeBonus: 9,
    }),
  });

  function isDifficulty(value) {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(BASE_DIFFICULTY_CONFIG, value);
  }

  function sanitizeTuning(value) {
    return {
      version: SETTINGS_VERSION,
      walls: clampInteger(value.walls, 0, WALL_MAX, DEFAULT_TUNING.walls),
      initialEnemies: clampInteger(value.initialEnemies, 1, 6, DEFAULT_TUNING.initialEnemies),
      initialSpawn: clampInteger(value.initialSpawn, 3, 30, DEFAULT_TUNING.initialSpawn),
      rampSpeed: clampInteger(value.rampSpeed, 5, 60, DEFAULT_TUNING.rampSpeed),
      escapePenalty: clampNumber(value.escapePenalty, 0.5, 4, DEFAULT_TUNING.escapePenalty),
      gapFillBonus: clampNumber(value.gapFillBonus, 0, 6, DEFAULT_TUNING.gapFillBonus),
    };
  }

  function clampInteger(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
  }

  function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function getEffectiveConfig(selectedDifficulty, stage, selectedTuning) {
    const base = isDifficulty(selectedDifficulty) ? BASE_DIFFICULTY_CONFIG[selectedDifficulty] : BASE_DIFFICULTY_CONFIG.standard;
    const level = Math.max(1, stage || 1);
    const pressure = Math.min(1.3, 1 + 0.02 * (level - 1));
    const speed = Math.max(0.8, 1 - 0.008 * (level - 1));
    const tuningTrap = selectedTuning.escapePenalty / DEFAULT_TUNING.escapePenalty;
    const tuningIntercept = selectedTuning.gapFillBonus / DEFAULT_TUNING.gapFillBonus;

    return Object.freeze({
      ...base,
      turnDelay: Math.round(base.turnDelay * speed),
      trapWeight: base.trapWeight * pressure * tuningTrap,
      interceptWeight: base.interceptWeight * pressure * tuningIntercept,
    });
  }

  return Object.freeze({ SETTINGS_VERSION, WALL_MAX, WALL_ADD_EVERY_STAGES, GLOBAL_COOLDOWN_MS, DEFAULT_TUNING, BASE_DIFFICULTY_CONFIG, isDifficulty, sanitizeTuning, getEffectiveConfig });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMConfig;
