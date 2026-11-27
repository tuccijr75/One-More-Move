"use strict";

/* =========================
   ONE MORE MOVE — CANONICAL ENGINE
   Canonical runtime orchestration over shared gameplay, state, storage and presentation modules.
========================= */

const OMMCore = (() => {
  const DEBUG = false;
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const { GRID_SIZE, posKey, samePosition, getNeighbors, reachableTilesFrom, shortestPathDist, shortestPathDistToAny, countEscapeOptionsAt } = grid;
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const { DEFAULT_TUNING, BASE_DIFFICULTY_CONFIG, isDifficulty, sanitizeTuning, getEffectiveConfig } = config;
  const generation = typeof module !== "undefined" && module.exports ? require("./generation.js") : OMMGeneration;
  const { createRng, randomSeed, buildWalls, chooseRevivalTile } = generation;
  const INTENT_FLASH_MS = 100;
  const DEATH_FREEZE_MS = 280;

  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  let state = null;
  let tuning = { ...DEFAULT_TUNING };
  let difficulty = "standard";
  let muted = false;
  let runSequence = 0;
  let headlessRuntime = null;
  const storageModule = typeof module !== "undefined" && module.exports ? require("./storage.js") : OMMStorage;
  const stateModule = typeof module !== "undefined" && module.exports ? require("./state.js") : OMMState;
  const presentationModule = typeof module !== "undefined" && module.exports ? require("./presentation.js") : OMMPresentation;
  const { getBestKey } = storageModule;
  const { memoryStore, loadMemoryStore, saveMemoryStore, loadTuning, persistTuning } = storageModule.createStorage({ hasDOM, debugLog });

  function saveTuning(next) {
    tuning = sanitizeTuning(next);
    persistTuning(tuning);
  }

  const { cacheUI, bindUI, openSettings, updateHud, setStatus, showStageBanner, showOverlay, hideOverlay, render, startAnimationLoop, playMoveSound, playEnemySound, playDeathSound, focusCanvas } = presentationModule.createPresentation({
    hasDOM, getState: () => state, getDifficulty: () => difficulty, getTuning: () => tuning,
    getMuted: () => muted, saveTuning, performanceNow, runCommand, attemptMove: (dx, dy) => attemptMove(dx, dy),
  });

  /* =========================
     MOVEMENT / ESCAPE
  ========================= */

  const movementModule = typeof module !== "undefined" && module.exports ? require("./movement.js") : OMMMovement;
  const progression = typeof module !== "undefined" && module.exports ? require("./progression.js") : OMMProgression;
  const { hasPlayerEscape } = movementModule;
  const { attemptMove, activateWallIgnore, activateFreezeTurn, activatePhaseStep, beginTimeFreeze, endTimeFreeze } = movementModule.createMovement({
    getState: () => state, performanceNow, setStatus, updateHud, playMoveSound, handleDeath, advanceStage, queueTurn,
  });

  /* =========================
     AI POLICY
  ========================= */

  const ai = typeof module !== "undefined" && module.exports ? require("./ai.js") : OMMAi;
  const { resolveEnemyDestinations } = ai;

  function planEnemyMovesForState(gameState, cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning || DEFAULT_TUNING)) {
    // Experimental selection is Node-only and explicit. Browser gameplay remains the locked baseline.
    if (["tactical-v2","tactical-v3","tactical-v4"].includes(headlessRuntime?.enemyPolicy)) {
      return ai.planTacticalMovesForState(gameState, cfg, tuning, headlessRuntime.enemyPolicy);
    }
    return ai.planEnemyMovesForState(gameState, cfg, tuning);
  }

  /* =========================
     BROWSER RUNTIME
  ========================= */

  function activeState(expected) {
    return Boolean(state && state === expected && state.runId === expected.runId);
  }

  function initializeState(seed, seedMode) {
    return stateModule.initializeState(seed, seedMode, {
      runId: ++runSequence, difficulty, tuning,
      best: Number(memoryStore.bestScores[getBestKey(seedMode, seed, difficulty)] || 0),
    });
  }

  function beginRun(seed, seedMode) {
    state = initializeState(seed, seedMode);
    hideOverlay();
    updateHud();
    startAnimationLoop();
    render();
    return state;
  }

  function advanceStage(gameState) {
    progression.advanceStage(gameState, tuning);
    gameState.effects.stageBannerUntil = performanceNow() + 600;
    showStageBanner(gameState.stage);
    debugLog("Effective config", getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning));
    updateHud();
  }

  function finalizeTurn(gameState) {
    progression.finalizeTurn(gameState, tuning, {
      debugAssertPortal,
      onBest(gameState) {
        if (!headlessRuntime) {
          memoryStore.bestScores[getBestKey(gameState.seedMode, gameState.seed, gameState.difficulty)] = gameState.best;
          saveMemoryStore();
        }
      },
    });
    updateHud();
  }

  function handleDeath(gameState, cause, killer) {
    if (gameState.hasExtraLife) {
      const revivalTile = chooseRevivalTile(gameState);
      if (revivalTile) {
        gameState.hasExtraLife = false;
        gameState.player = revivalTile;
        gameState.playerTrail.unshift(posKey(revivalTile));
        gameState.playerTrail = gameState.playerTrail.slice(0, 2);
        setStatus(gameState, "EXTRA LIFE USED", 1200);
        updateHud();
        return "REVIVED";
      }
    }

    gameState.gameOver = true;
    gameState.deathCause = cause;
    gameState.effects.freezeUntil = performanceNow() + DEATH_FREEZE_MS;
    gameState.effects.killer = killer ? { x: killer.x, y: killer.y } : null;
    playDeathSound();
    render();
    if (hasDOM) setTimeout(() => {
      if (!activeState(gameState)) return;
      showOverlay(cause);
    }, DEATH_FREEZE_MS);
    return "DEAD";
  }

  async function resolveTurnAsync(expectedRunId = state?.runId) {
    const gameState = state;
    if (!gameState || gameState.runId !== expectedRunId || gameState.gameOver || gameState.inputLocked) return false;
    gameState.inputLocked = true;

    try {
      const cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning);
      if (gameState.freezeNext) {
        gameState.freezeNext = false;
        finalizeTurn(gameState);
        return true;
      }

      await delay(cfg.turnDelay);
      if (!activeState(gameState)) return false;

      const plan = planEnemyMovesForState(gameState, cfg);
      if (cfg.showIntentFlash && plan.intentTiles.size) {
        gameState.effects.intentTiles = plan.intentTiles;
        await delay(INTENT_FLASH_MS);
        if (!activeState(gameState)) return false;
        gameState.effects.intentTiles = null;
      }

      gameState.enemies = plan.resolvedMoves;
      playEnemySound();
      const killer = gameState.enemies.find((enemy) => enemy.stunned === 0 && samePosition(enemy, gameState.player));
      if (killer) {
        const result = handleDeath(gameState, "Intercepted.", killer);
        if (result === "DEAD") return false;
      }

      const enemyKeys = new Set(gameState.enemies.map(posKey));
      if (!hasPlayerEscape(gameState, enemyKeys)) {
        const result = handleDeath(gameState, "No escape.", null);
        if (result === "DEAD") return false;
      }

      finalizeTurn(gameState);
      return true;
    } catch (error) {
      if (headlessRuntime) throw error;
      console.error("Turn resolution failed", error);
      if (activeState(gameState)) setStatus(gameState, "TURN ERROR", 1500);
      return false;
    } finally {
      if (activeState(gameState) && !gameState.gameOver) gameState.inputLocked = false;
    }
  }

  function queueTurn(gameState) {
    const turn = resolveTurnAsync(gameState.runId);
    if (headlessRuntime) headlessRuntime.pending = turn;
  }

  function setDifficulty(nextDifficulty) {
    if (!isDifficulty(nextDifficulty)) return false;
    if (state && !state.gameOver) {
      setStatus(state, "DIFFICULTY CHANGES AFTER RUN", 1200);
      return false;
    }
    difficulty = nextDifficulty;
    memoryStore.difficulty = difficulty;
    saveMemoryStore();
    updateHud();
    return true;
  }

  function runCommand(command, value) {
    switch (command) {
      case "restart":
        if (!state) return false;
        beginRun(state.seed, "REPLAY");
        return true;
      case "new":
        beginRun(randomSeed(), "NEW");
        return true;
      case "daily":
        beginRun(Math.floor(Date.now() / 86400000), "DAILY");
        return true;
      case "manual": {
        if (!hasDOM) return false;
        const input = window.prompt("Enter seed (whole number):");
        if (input === null || input.trim() === "") return false;
        const seed = Number(input);
        if (!Number.isInteger(seed)) {
          window.alert("Invalid seed.");
          return false;
        }
        beginRun(seed, "MANUAL");
        return true;
      }
      case "settings":
        openSettings();
        return true;
      case "difficulty":
        return setDifficulty(value);
      case "difficulty-next": {
        const order = ["standard", "hard", "hardcore"];
        const next = order[(order.indexOf(difficulty) + 1) % order.length];
        return setDifficulty(next);
      }
      case "wall": return activateWallIgnore();
      case "freeze": return activateFreezeTurn();
      case "phase": return activatePhaseStep();
      case "time-start": return beginTimeFreeze();
      case "time-end": return endTimeFreeze();
      default: return false;
    }
  }

  function delay(milliseconds) {
    if (headlessRuntime) {
      headlessRuntime.now += milliseconds;
      return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function performanceNow() {
    if (headlessRuntime) return headlessRuntime.now;
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function debugLog(...values) {
    if (DEBUG && typeof console !== "undefined") console.debug("[OMM]", ...values);
  }

  function debugAssertPortal(gameState) {
    if (!DEBUG || !gameState.portal) return;
    const reachable = reachableTilesFrom(gameState.player, gameState.walls);
    console.assert(reachable.has(posKey(gameState.portal)), "Portal must be reachable");
  }

  // Node-only runtime. Sequential isolated runs; canonical movement, AI, rewards and progression.
  function createHeadlessRun({ seed, difficulty: selectedDifficulty = "standard", settings = DEFAULT_TUNING, inputMs = 1000, enemyPolicy = "baseline" } = {}) {
    if (hasDOM) throw new Error("Headless runtime is not available in browser play");
    if (headlessRuntime?.busy) throw new Error("A headless command is still resolving");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !isDifficulty(selectedDifficulty)) {
      throw new Error("Invalid seed or difficulty");
    }
    if (!Number.isInteger(inputMs) || inputMs < 0 || inputMs > 60000) throw new Error("Invalid input pace");
    if (!["baseline", "tactical-v2", "tactical-v3", "tactical-v4"].includes(enemyPolicy)) throw new Error("Invalid enemy policy");
    difficulty = selectedDifficulty;
    tuning = sanitizeTuning({ ...DEFAULT_TUNING, ...settings });
    const runtime = { now: 0, pending: null, busy: false, enemyPolicy };
    headlessRuntime = runtime;
    const gameState = initializeState(seed, "LAB");
    gameState.best = 0;
    state = gameState;
    function assertActive() {
      if (headlessRuntime !== runtime || !activeState(gameState)) throw new Error("Headless run is no longer active");
    }
    function snapshot() {
      assertActive();
      if (runtime.busy) throw new Error("Cannot snapshot a pending turn");
      const { rng, runId, effects, ...fields } = gameState;
      return JSON.parse(JSON.stringify({
        ...fields,
        walls: [...gameState.walls].sort(),
        clockMs: runtime.now,
        cooldownMs: Math.max(0, gameState.rewardCooldownUntil - runtime.now),
      }));
    }
    async function dispatch(action) {
      assertActive();
      if (runtime.busy) throw new Error("Concurrent commands are not supported");
      if (!action || typeof action !== "object") throw new Error("Invalid action");
      if (gameState.gameOver) return { accepted: false, state: snapshot() };
      runtime.busy = true;
      try {
        runtime.pending = null;
        let accepted;
        if (action.type === "wait") {
          if (!Number.isInteger(action.ms) || action.ms < 1 || action.ms > 60000) throw new Error("Invalid wait");
          runtime.now += action.ms;
          accepted = true;
        } else {
          runtime.now += inputMs;
          if (action.type === "move") accepted = attemptMove(action.dx, action.dy);
          else if (action.type === "ability" && ["wall", "freeze", "phase", "time-start", "time-end"].includes(action.name)) {
            accepted = runCommand(action.name);
          } else throw new Error("Unsupported laboratory action");
        }
        if (runtime.pending) await runtime.pending;
        if (gameState.inputLocked && !gameState.gameOver) throw new Error("Turn failed to unlock");
        runtime.busy = false;
        return { accepted, state: snapshot() };
      } finally {
        runtime.busy = false;
      }
    }
    return Object.freeze({ snapshot, dispatch });
  }

  function boot() {
    if (!hasDOM) return;
    cacheUI();
    loadMemoryStore();
    difficulty = isDifficulty(memoryStore.difficulty) ? memoryStore.difficulty : "standard";
    muted = memoryStore.muted;
    tuning = loadTuning();
    bindUI();
    beginRun(randomSeed(), "RUN");
    focusCanvas();

    window.__ommGetState = () => state;
    window.__ommMove = (dx, dy) => attemptMove(dx, dy);
    window.__ommCommand = (command, value) => runCommand(command, value);
  }

  return {
    GRID_SIZE,
    DEFAULT_TUNING,
    BASE_DIFFICULTY_CONFIG,
    createRng,
    posKey,
    getNeighbors,
    reachableTilesFrom,
    shortestPathDist,
    shortestPathDistToAny,
    countEscapeOptionsAt,
    hasPlayerEscape,
    buildWalls,
    getEffectiveConfig,
    planEnemyMovesForState,
    resolveEnemyDestinations,
    chooseRevivalTile,
    initializeState,
    createHeadlessRun,
    boot,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMCore;
if (typeof window !== "undefined" && typeof document !== "undefined") OMMCore.boot();
