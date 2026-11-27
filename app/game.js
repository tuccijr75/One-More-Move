"use strict";

/* =========================
   ONE MORE MOVE — CANONICAL ENGINE
   Canonical runtime; shared modules own geometry, AI, configuration and generation.
========================= */

const OMMCore = (() => {
  const DEBUG = false;
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const { GRID_SIZE, posKey, samePosition, inBounds, manhattan, getNeighbors, reachableTilesFrom, shortestPathDist, shortestPathDistToAny, buildBlockedSet, countEscapeOptionsAt } = grid;
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const { SETTINGS_VERSION, WALL_MAX, WALL_ADD_EVERY_STAGES, GLOBAL_COOLDOWN_MS, DEFAULT_TUNING, BASE_DIFFICULTY_CONFIG, isDifficulty, sanitizeTuning, getEffectiveConfig } = config;
  const generation = typeof module !== "undefined" && module.exports ? require("./generation.js") : OMMGeneration;
  const { createRng, randomSeed, buildWalls, enemyCountForStage, spawnEnemy, computeNextPortalTurn, spawnPortalIfNeeded, chooseRevivalTile } = generation;
  const CELL_SIZE = 60;
  const MEMORY_STORE_KEY = "one-more-move-memory-v2";
  const INTENT_FLASH_MS = 100;
  const DEATH_FREEZE_MS = 280;

  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  let ui = null;
  let state = null;
  let tuning = { ...DEFAULT_TUNING };
  let difficulty = "standard";
  let muted = false;
  let audioContext = null;
  let animationRunning = false;
  let runSequence = 0;
  let headlessRuntime = null;
  let memoryStore = {
    settings: {},
    difficulty: "standard",
    bestScores: {},
    muted: false,
  };

  /* =========================
     STORAGE
  ========================= */

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

  function saveTuning(next) {
    tuning = sanitizeTuning(next);
    memoryStore.settings[tuningKey()] = { ...tuning };
    saveMemoryStore();
  }

  /* =========================
     MOVEMENT / ESCAPE
  ========================= */

  // Escape adjudication includes held movement rewards; AI/spawn/revival geometry remains unchanged.
  function phaseDestination(gameState, dx, dy, enemyKeys) {
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
    const first = { x: gameState.player.x + dx, y: gameState.player.y + dy };
    const second = { x: first.x + dx, y: first.y + dy };
    if (!inBounds(first.x, first.y) || !inBounds(second.x, second.y)) return null;
    if (gameState.walls.has(posKey(first)) || gameState.walls.has(posKey(second))) return null;
    return enemyKeys.has(posKey(second)) ? null : { first, second };
  }

  function hasPhaseDestination(gameState, enemyKeys) {
    return getNeighbors(gameState.player).some(next =>
      phaseDestination(gameState, next.x - gameState.player.x, next.y - gameState.player.y, enemyKeys));
  }

  function hasPlayerEscape(gameState, enemyKeys = new Set(gameState.enemies.map(posKey))) {
    // An armed Phase Step requires a two-cell cardinal move.
    if (gameState.phaseArmed) return hasPhaseDestination(gameState, enemyKeys);
    if (countEscapeOptionsAt(gameState, gameState.player, enemyKeys, true) > 0) return true;
    // Cooldown is wall-clock time: a held reward may become usable without an enemy turn.
    if (gameState.wallIgnoreArmed || gameState.tokens.wall > 0) {
      if (getNeighbors(gameState.player).some(next =>
        inBounds(next.x, next.y) && !enemyKeys.has(posKey(next)) && gameState.walls.has(posKey(next)))) return true;
    }
    if (gameState.wallIgnoreArmed && gameState.tokens.diag > 0) {
      const { x, y } = gameState.player;
      for (const dx of [-1, 1]) {
        for (const dy of [-1, 1]) {
          const destination = { x: x + dx, y: y + dy };
          if (inBounds(destination.x, destination.y) && !enemyKeys.has(posKey(destination)) &&
              !gameState.walls.has(posKey({ x: x + dx, y })) &&
              !gameState.walls.has(posKey({ x, y: y + dy }))) return true;
        }
      }
    }
    return !gameState.phaseUsed && hasPhaseDestination(gameState, enemyKeys);
  }

  /* =========================
     AI POLICY
  ========================= */

  const ai = typeof module !== "undefined" && module.exports ? require("./ai.js") : OMMAi;
  const { resolveEnemyDestinations } = ai;

  function planEnemyMovesForState(gameState, cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning || DEFAULT_TUNING)) {
    // Preserve the legacy runtime tuning input until the behavior-preserving migration is complete.
    return ai.planEnemyMovesForState(gameState, cfg, tuning);
  }

  /* =========================
     BROWSER RUNTIME
  ========================= */

  function getBestKey(seedMode, seed, selectedDifficulty) {
    const normalizedMode = String(seedMode || "RUN").toUpperCase();
    const identity = ["DAILY", "MANUAL", "REPLAY"].includes(normalizedMode)
      ? `${normalizedMode}-${seed >>> 0}`
      : normalizedMode;
    return `${selectedDifficulty}:${identity}`;
  }

  function activeState(expected) {
    return Boolean(state && state === expected && state.runId === expected.runId);
  }

  function initializeState(seed, seedMode) {
    const gameState = {
      runId: ++runSequence,
      seed: seed >>> 0,
      seedMode,
      difficulty,
      tuning: { ...tuning },
      rng: createRng(seed),
      player: { x: 5, y: 5 },
      playerTrail: [],
      walls: new Set(),
      wallCount: tuning.walls,
      enemies: [],
      nextEnemyId: 0,
      turns: 0,
      stage: 1,
      portal: null,
      nextPortalAtTurn: 15,
      nextSpawnTurn: tuning.initialSpawn,
      best: Number(memoryStore.bestScores[getBestKey(seedMode, seed, difficulty)] || 0),
      gameOver: false,
      inputLocked: false,
      holdSpace: false,
      holdMovesLeft: 2,
      holdStepsUsed: 0,
      rewardCooldownUntil: 0,
      hasExtraLife: false,
      phaseUsed: false,
      phaseArmed: false,
      wallIgnoreArmed: false,
      freezeNext: false,
      tokens: { diag: 0, wall: 0, freeze: 0, timeFreeze: 0 },
      effects: {
        intentTiles: null,
        freezeUntil: 0,
        killer: null,
        statusText: seedMode === "DAILY" ? "DAILY SEED" : "",
        statusUntil: 0,
        stageBannerUntil: 0,
      },
    };

    gameState.walls = buildWalls(gameState, gameState.wallCount);
    for (let index = 0; index < tuning.initialEnemies; index++) spawnEnemy(gameState);
    return gameState;
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
    gameState.stage++;
    gameState.portal = null;
    gameState.nextPortalAtTurn = computeNextPortalTurn(gameState.stage, gameState.turns);
    gameState.enemies = [];
    if (gameState.stage % WALL_ADD_EVERY_STAGES === 0) {
      gameState.wallCount = Math.min(WALL_MAX, gameState.wallCount + 1);
    }
    gameState.walls = buildWalls(gameState, gameState.wallCount);
    const target = enemyCountForStage(gameState.stage);
    for (let index = 0; index < target; index++) spawnEnemy(gameState);
    gameState.nextSpawnTurn = gameState.turns + tuning.initialSpawn;
    if (gameState.stage % 15 === 0 && !gameState.hasExtraLife) gameState.hasExtraLife = true;
    gameState.effects.stageBannerUntil = performanceNow() + 600;
    showStageBanner(gameState.stage);
    debugLog("Effective config", getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning));
    updateHud();
  }

  function grantScheduledRewards(gameState) {
    if (gameState.turns > 0 && gameState.turns % 12 === 0) {
      const phase = Math.floor(gameState.turns / 12) % 3;
      if (phase === 0 && gameState.tokens.diag === 0) gameState.tokens.diag = 1;
      if (phase === 1 && gameState.tokens.wall === 0) gameState.tokens.wall = 1;
      if (phase === 2 && gameState.tokens.freeze === 0) gameState.tokens.freeze = 1;
    }
    if (gameState.turns > 0 && gameState.turns % 50 === 0 && gameState.tokens.timeFreeze === 0) {
      gameState.tokens.timeFreeze = 1;
    }
  }

  function finalizeTurn(gameState) {
    gameState.turns++;
    spawnPortalIfNeeded(gameState, debugAssertPortal);
    grantScheduledRewards(gameState);

    if (gameState.turns > gameState.best) {
      gameState.best = gameState.turns;
      if (!headlessRuntime) {
        memoryStore.bestScores[getBestKey(gameState.seedMode, gameState.seed, gameState.difficulty)] = gameState.best;
        saveMemoryStore();
      }
    }

    if (gameState.turns >= gameState.nextSpawnTurn) {
      if (gameState.enemies.length < enemyCountForStage(gameState.stage)) spawnEnemy(gameState);
      const cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning);
      const interval = Math.max(cfg.spawnFloor, Math.floor(tuning.rampSpeed - gameState.turns / tuning.rampSpeed));
      gameState.nextSpawnTurn += Math.max(1, interval);
    }
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

  function movePlayer(gameState, destination) {
    gameState.player = destination;
    gameState.playerTrail.unshift(posKey(destination));
    gameState.playerTrail = gameState.playerTrail.slice(0, 2);
  }

  function attemptMove(dx, dy) {
    const gameState = state;
    if (!gameState || gameState.gameOver || gameState.inputLocked) return false;
    if (gameState.holdSpace && gameState.holdMovesLeft <= 0) return false;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;

    if (gameState.phaseArmed) {
      const destination = phaseDestination(gameState, dx, dy, new Set(gameState.enemies.map(posKey)));
      if (!destination) return false;
      const { first, second } = destination;

      const phasedEnemy = gameState.enemies.find((enemy) => samePosition(enemy, first));
      if (phasedEnemy) phasedEnemy.stunned = Math.max(phasedEnemy.stunned, 1);
      gameState.phaseArmed = false;
      gameState.phaseUsed = true;
      movePlayer(gameState, second);
      playMoveSound();
      return completePlayerMove(gameState);
    }

    const isDiagonal = dx !== 0 && dy !== 0;
    if (isDiagonal && (gameState.tokens.diag <= 0 || !abilityReady(gameState))) return false;
    const destination = { x: gameState.player.x + dx, y: gameState.player.y + dy };
    if (!inBounds(destination.x, destination.y)) return false;

    if (isDiagonal) {
      const horizontal = posKey({ x: destination.x, y: gameState.player.y });
      const vertical = posKey({ x: gameState.player.x, y: destination.y });
      if (gameState.walls.has(horizontal) || gameState.walls.has(vertical)) return false;
    }

    const destinationKey = posKey(destination);
    const usesWallIgnore = gameState.walls.has(destinationKey) && gameState.wallIgnoreArmed;
    if (gameState.walls.has(destinationKey) && !usesWallIgnore) return false;

    if (isDiagonal) {
      gameState.tokens.diag = 0;
      startGlobalCooldown(gameState);
    }
    if (usesWallIgnore) gameState.wallIgnoreArmed = false;

    movePlayer(gameState, destination);
    const steppedEnemy = gameState.enemies.find((enemy) => samePosition(enemy, destination));
    if (steppedEnemy) {
      handleDeath(gameState, "Intercepted.", steppedEnemy);
      return true;
    }

    playMoveSound();
    return completePlayerMove(gameState);
  }

  function completePlayerMove(gameState) {
    if (gameState.portal && samePosition(gameState.player, gameState.portal)) {
      advanceStage(gameState);
      return true;
    }

    if (gameState.holdSpace) {
      gameState.holdMovesLeft--;
      gameState.holdStepsUsed++;
      if (gameState.holdMovesLeft === 0) endTimeFreeze();
      else updateHud();
      return true;
    }

    queueTurn(gameState);
    return true;
  }

  function queueTurn(gameState) {
    const turn = resolveTurnAsync(gameState.runId);
    if (headlessRuntime) headlessRuntime.pending = turn;
  }

  function startGlobalCooldown(gameState) {
    gameState.rewardCooldownUntil = performanceNow() + GLOBAL_COOLDOWN_MS;
  }

  function abilityReady(gameState) {
    if (performanceNow() >= gameState.rewardCooldownUntil) return true;
    const seconds = Math.ceil((gameState.rewardCooldownUntil - performanceNow()) / 1000);
    setStatus(gameState, `ABILITY COOLDOWN ${seconds}s`, 900);
    return false;
  }

  function activateWallIgnore() {
    const gameState = state;
    if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.tokens.wall <= 0 || gameState.wallIgnoreArmed) return false;
    if (!abilityReady(gameState)) return false;
    gameState.tokens.wall = 0;
    gameState.wallIgnoreArmed = true;
    startGlobalCooldown(gameState);
    updateHud();
    return true;
  }

  function activateFreezeTurn() {
    const gameState = state;
    if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.tokens.freeze <= 0 || gameState.freezeNext) return false;
    if (!abilityReady(gameState)) return false;
    gameState.tokens.freeze = 0;
    gameState.freezeNext = true;
    startGlobalCooldown(gameState);
    updateHud();
    return true;
  }

  function activatePhaseStep() {
    const gameState = state;
    if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.phaseUsed || gameState.phaseArmed) return false;
    if (!abilityReady(gameState)) return false;
    if (!hasPhaseDestination(gameState, new Set(gameState.enemies.map(posKey)))) {
      setStatus(gameState, "NO PHASE ROUTE", 900);
      return false;
    }
    gameState.phaseArmed = true;
    startGlobalCooldown(gameState);
    updateHud();
    return true;
  }

  function beginTimeFreeze() {
    const gameState = state;
    if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.holdSpace || gameState.tokens.timeFreeze <= 0) return false;
    if (!abilityReady(gameState)) return false;
    gameState.tokens.timeFreeze = 0;
    gameState.holdSpace = true;
    gameState.holdMovesLeft = 2;
    gameState.holdStepsUsed = 0;
    startGlobalCooldown(gameState);
    updateHud();
    return true;
  }

  function endTimeFreeze() {
    const gameState = state;
    if (!gameState || !gameState.holdSpace) return false;
    gameState.holdSpace = false;
    const used = gameState.holdStepsUsed;
    gameState.holdMovesLeft = 2;
    gameState.holdStepsUsed = 0;
    updateHud();
    if (used > 0 && !gameState.gameOver) queueTurn(gameState);
    return true;
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

  /* =========================
     UI / INPUT / RENDER
  ========================= */

  function cacheUI() {
    ui = {
      canvas: document.getElementById("game"),
      ctx: document.getElementById("game")?.getContext("2d") || null,
      turns: document.getElementById("turns"),
      best: document.getElementById("best"),
      stage: document.getElementById("stage"),
      difficulty: document.getElementById("difficulty"),
      seed: document.getElementById("seed"),
      mode: document.getElementById("mode"),
      focus: document.getElementById("focus"),
      hud: document.getElementById("hud"),
      overlay: document.getElementById("overlay"),
      finalTurns: document.getElementById("final-turns"),
      deathCause: document.getElementById("death-cause"),
      finalSeed: document.getElementById("final-seed"),
      finalMode: document.getElementById("final-mode"),
      stageBanner: document.getElementById("stage-banner"),
      status: document.getElementById("status"),
      settings: document.getElementById("settings"),
      settingsBack: document.getElementById("settings-back"),
      settingsSave: document.getElementById("settings-save"),
      settingsReset: document.getElementById("settings-reset"),
      settingsProfile: document.getElementById("settings-profile"),
      controls: {
        walls: document.getElementById("set-wallCount"),
        wallsNum: document.getElementById("set-wallCountNum"),
        enemies: document.getElementById("set-initialEnemies"),
        enemiesNum: document.getElementById("set-initialEnemiesNum"),
        spawn: document.getElementById("set-initialSpawn"),
        spawnNum: document.getElementById("set-initialSpawnNum"),
        ramp: document.getElementById("set-rampSpeed"),
        rampNum: document.getElementById("set-rampSpeedNum"),
        escape: document.getElementById("set-escapePenalty"),
        escapeNum: document.getElementById("set-escapePenaltyNum"),
        gap: document.getElementById("set-gapFill"),
        gapNum: document.getElementById("set-gapFillNum"),
      },
    };
  }

  function bindRangePair(range, number) {
    if (!range || !number) return;
    range.addEventListener("input", () => { number.value = range.value; });
    number.addEventListener("input", () => { range.value = number.value; });
  }

  function bindUI() {
    const controls = ui.controls;
    bindRangePair(controls.walls, controls.wallsNum);
    bindRangePair(controls.enemies, controls.enemiesNum);
    bindRangePair(controls.spawn, controls.spawnNum);
    bindRangePair(controls.ramp, controls.rampNum);
    bindRangePair(controls.escape, controls.escapeNum);
    bindRangePair(controls.gap, controls.gapNum);
    ui.settingsBack?.addEventListener("click", closeSettings);
    ui.settingsSave?.addEventListener("click", persistSettingsFromUI);
    ui.settingsReset?.addEventListener("click", resetSettings);
    ui.canvas?.addEventListener("click", () => ui.canvas.focus());
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  }

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();
    const blocked = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " ", "escape"];
    if (blocked.includes(key)) event.preventDefault();

    if (key === "escape" && ui.settings && !ui.settings.classList.contains("hidden")) return closeSettings();
    if (key === "r") return runCommand("restart");
    if (key === "n") return runCommand("new");
    if (key === "y") return runCommand("daily");
    if (key === "m") return runCommand("manual");
    if (key === "x") return runCommand("settings");
    if (key === "1") return runCommand("difficulty", "standard");
    if (key === "2") return runCommand("difficulty", "hard");
    if (key === "3") return runCommand("difficulty", "hardcore");
    if (key === "v") return runCommand("wall");
    if (key === "b") return runCommand("freeze");
    if (key === "f") return runCommand("phase");
    if (event.key === " " && !event.repeat) return runCommand("time-start");

    if (key === "w" || key === "arrowup") return attemptMove(0, -1);
    if (key === "s" || key === "arrowdown") return attemptMove(0, 1);
    if (key === "a" || key === "arrowleft") return attemptMove(-1, 0);
    if (key === "d" || key === "arrowright") return attemptMove(1, 0);
    if (key === "q") return attemptMove(-1, -1);
    if (key === "e") return attemptMove(1, -1);
    if (key === "z") return attemptMove(-1, 1);
    if (key === "c") return attemptMove(1, 1);
    return false;
  }

  function handleKeyUp(event) {
    if (event.key === " ") runCommand("time-end");
  }

  function openSettings() {
    if (!ui?.settings) return;
    if (state && !state.gameOver) {
      setStatus(state, "SETTINGS AVAILABLE AFTER RUN", 1200);
      return;
    }
    const controls = ui.controls;
    controls.walls.value = controls.wallsNum.value = tuning.walls;
    controls.enemies.value = controls.enemiesNum.value = tuning.initialEnemies;
    controls.spawn.value = controls.spawnNum.value = tuning.initialSpawn;
    controls.ramp.value = controls.rampNum.value = tuning.rampSpeed;
    controls.escape.value = controls.escapeNum.value = tuning.escapePenalty;
    controls.gap.value = controls.gapNum.value = tuning.gapFillBonus;
    if (ui.settingsProfile) ui.settingsProfile.textContent = difficulty.toUpperCase();
    ui.settings.classList.remove("hidden");
    ui.settings.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    if (!ui?.settings) return;
    ui.settings.classList.add("hidden");
    ui.settings.setAttribute("aria-hidden", "true");
  }

  function persistSettingsFromUI() {
    const controls = ui.controls;
    saveTuning({
      version: SETTINGS_VERSION,
      walls: controls.wallsNum.value,
      initialEnemies: controls.enemiesNum.value,
      initialSpawn: controls.spawnNum.value,
      rampSpeed: controls.rampNum.value,
      escapePenalty: controls.escapeNum.value,
      gapFillBonus: controls.gapNum.value,
    });
    closeSettings();
  }

  function resetSettings() {
    saveTuning({ ...DEFAULT_TUNING });
    openSettings();
  }

  function updateHud() {
    if (!ui || !state) return;
    ui.turns.textContent = String(state.turns);
    ui.best.textContent = String(state.best);
    ui.stage.textContent = String(state.stage);
    ui.difficulty.textContent = difficulty.toUpperCase();
    ui.seed.textContent = `Seed ${state.seed}`;
    ui.mode.textContent = String(state.seedMode).toUpperCase();
    if (ui.focus) {
      ui.focus.innerHTML = [
        `<span>D ${state.tokens.diag}</span>`,
        `<span>W ${state.tokens.wall}</span>`,
        `<span>F ${state.phaseUsed ? 0 : 1}</span>`,
        `<span>B ${state.tokens.freeze}</span>`,
        `<span>TF ${state.holdSpace ? state.holdMovesLeft : state.tokens.timeFreeze ? 2 : 0}</span>`,
        `<span>L ${state.hasExtraLife ? 1 : 0}</span>`,
      ].join("");
    }
  }

  function setStatus(gameState, text, duration) {
    gameState.effects.statusText = text;
    gameState.effects.statusUntil = performanceNow() + duration;
    if (ui?.status) {
      ui.status.textContent = text;
      ui.status.classList.remove("hidden");
    }
  }

  function showStageBanner(stage) {
    if (!ui?.stageBanner) return;
    ui.stageBanner.textContent = `STAGE ${stage}`;
    ui.stageBanner.classList.remove("hidden");
  }

  function showOverlay(cause) {
    if (!ui || !state) return;
    ui.finalTurns.textContent = `Turns Survived: ${state.turns}`;
    ui.deathCause.textContent = cause;
    ui.finalSeed.textContent = `Seed: ${state.seed}`;
    ui.finalMode.textContent = `Mode: ${state.seedMode}`;
    ui.overlay.classList.remove("hidden");
  }

  function hideOverlay() {
    ui?.overlay?.classList.add("hidden");
  }

  function drawTile(x, y, color) {
    const padding = 4;
    ui.ctx.fillStyle = color;
    ui.ctx.fillRect(x * CELL_SIZE + padding, y * CELL_SIZE + padding, CELL_SIZE - padding * 2, CELL_SIZE - padding * 2);
    ui.ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ui.ctx.strokeRect(x * CELL_SIZE + padding + 0.5, y * CELL_SIZE + padding + 0.5, CELL_SIZE - padding * 2 - 1, CELL_SIZE - padding * 2 - 1);
  }

  function render() {
    if (!ui?.ctx || !state) return;
    const ctx = ui.ctx;
    ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

    for (const key of state.walls) {
      const [x, y] = key.split(",").map(Number);
      drawTile(x, y, "#5a5a5a");
    }

    if (state.portal) {
      ctx.save();
      ctx.shadowColor = "rgba(255,255,255,0.9)";
      ctx.shadowBlur = 16;
      drawTile(state.portal.x, state.portal.y, "#050505");
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.strokeRect(state.portal.x * CELL_SIZE + 6, state.portal.y * CELL_SIZE + 6, CELL_SIZE - 12, CELL_SIZE - 12);
      ctx.restore();
    }

    if (state.effects.intentTiles) {
      ctx.fillStyle = "rgba(255,90,90,0.25)";
      for (const key of state.effects.intentTiles) {
        const [x, y] = key.split(",").map(Number);
        ctx.fillRect(x * CELL_SIZE + 4, y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
      }
    }

    state.enemies.forEach((enemy) => {
      ctx.save();
      const pulse = (Math.sin(performanceNow() * 0.008 + enemy.phase) + 1) / 2;
      ctx.globalAlpha = enemy.stunned > 0 ? 0.55 : 1;
      ctx.shadowColor = "rgba(255,80,80,0.75)";
      ctx.shadowBlur = 4 + pulse * 12;
      drawTile(enemy.x, enemy.y, enemy.stunned > 0 ? "#6aaeff" : "#c43636");
      ctx.restore();
    });

    ctx.save();
    ctx.shadowColor = "rgba(74,168,255,0.85)";
    ctx.shadowBlur = 12;
    drawTile(state.player.x, state.player.y, "#3a7bd5");
    ctx.restore();

    if (state.effects.freezeUntil > performanceNow() && state.effects.killer) {
      ctx.fillStyle = "rgba(255,107,107,0.75)";
      ctx.fillRect(state.effects.killer.x * CELL_SIZE + 2, state.effects.killer.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
    }

    if (state.effects.stageBannerUntil && performanceNow() > state.effects.stageBannerUntil) {
      ui.stageBanner?.classList.add("hidden");
      state.effects.stageBannerUntil = 0;
    }
    if (state.effects.statusUntil && performanceNow() > state.effects.statusUntil) {
      ui.status?.classList.add("hidden");
      state.effects.statusUntil = 0;
    }

    const danger = state.enemies.some((enemy) => manhattan(enemy, state.player) <= 2);
    const cfg = getEffectiveConfig(state.difficulty, state.stage, state.tuning);
    ui.hud?.classList.toggle("danger", cfg.dangerFeedback && danger);
  }

  function startAnimationLoop() {
    if (animationRunning || !hasDOM) return;
    animationRunning = true;
    const frame = () => {
      render();
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  }

  function ensureAudio() {
    if (!hasDOM || audioContext || muted) return;
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioContext = null;
    }
  }

  function playTone(frequency, duration, type, gain) {
    ensureAudio();
    if (!audioContext || muted) return;
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    volume.gain.value = gain;
    oscillator.connect(volume);
    volume.connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + duration);
  }

  function playMoveSound() { playTone(480, 0.05, "triangle", 0.06); }
  function playEnemySound() { playTone(140, 0.08, "sine", 0.08); }
  function playDeathSound() { playTone(80, 0.18, "sawtooth", 0.1); }

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
  function createHeadlessRun({ seed, difficulty: selectedDifficulty = "standard", settings = DEFAULT_TUNING, inputMs = 1000 } = {}) {
    if (hasDOM) throw new Error("Headless runtime is not available in browser play");
    if (headlessRuntime?.busy) throw new Error("A headless command is still resolving");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !isDifficulty(selectedDifficulty)) {
      throw new Error("Invalid seed or difficulty");
    }
    if (!Number.isInteger(inputMs) || inputMs < 0 || inputMs > 60000) throw new Error("Invalid input pace");
    difficulty = selectedDifficulty;
    tuning = sanitizeTuning({ ...DEFAULT_TUNING, ...settings });
    const runtime = { now: 0, pending: null, busy: false };
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
    ui.canvas?.focus();

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
