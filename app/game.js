"use strict";

/* =========================
   ONE MORE MOVE — CANONICAL ENGINE
   Single readable source for gameplay, browser, and test use.
========================= */

const OMMCore = (() => {
  const DEBUG = false;
  const GRID_SIZE = 10;
  const CELL_SIZE = 60;
  const SETTINGS_VERSION = 2;
  const MEMORY_STORE_KEY = "one-more-move-memory-v2";
  const INTENT_FLASH_MS = 100;
  const DEATH_FREEZE_MS = 280;
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

  const hasDOM = typeof window !== "undefined" && typeof document !== "undefined";
  let ui = null;
  let state = null;
  let tuning = { ...DEFAULT_TUNING };
  let difficulty = "standard";
  let muted = false;
  let audioContext = null;
  let animationRunning = false;
  let runSequence = 0;
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

  function normalizeMemoryStore(value) {
    if (!value || typeof value !== "object") return;
    if (value.settings && typeof value.settings === "object") memoryStore.settings = value.settings;
    if (BASE_DIFFICULTY_CONFIG[value.difficulty]) memoryStore.difficulty = value.difficulty;
    if (value.bestScores && typeof value.bestScores === "object") memoryStore.bestScores = value.bestScores;
    memoryStore.muted = Boolean(value.muted);
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

  /* =========================
     RNG
  ========================= */

  function createRng(seed) {
    let value = seed >>> 0;
    return function next() {
      let t = (value += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomSeed() {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const values = new Uint32Array(1);
      crypto.getRandomValues(values);
      return values[0];
    }
    return Math.floor(Math.random() * 4294967296) >>> 0;
  }

  function randInt(gameState, max) {
    return Math.floor(gameState.rng() * max);
  }

  function visualPhase(seed, enemyId) {
    let value = (seed ^ Math.imul(enemyId + 1, 0x9e3779b1)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    return ((value >>> 0) / 4294967296) * Math.PI * 2;
  }

  /* =========================
     GRID UTILS
  ========================= */

  function posKey(position) {
    return `${position.x},${position.y}`;
  }

  function samePosition(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function inBounds(x, y) {
    return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
  }

  function manhattan(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function getNeighbors(position) {
    return [
      { x: position.x, y: position.y - 1 },
      { x: position.x - 1, y: position.y },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
    ];
  }

  function reachableTilesFrom(start, blockedSet) {
    const visited = new Set([posKey(start)]);
    const queue = [start];
    let cursor = 0;

    while (cursor < queue.length) {
      const current = queue[cursor++];
      for (const next of getNeighbors(current)) {
        if (!inBounds(next.x, next.y)) continue;
        const key = posKey(next);
        if (blockedSet.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push(next);
      }
    }
    return visited;
  }

  function shortestPathDist(from, to, blockedSet) {
    if (samePosition(from, to)) return 0;
    const targetKey = posKey(to);
    const visited = new Set([posKey(from)]);
    const queue = [{ position: from, distance: 0 }];
    let cursor = 0;

    while (cursor < queue.length) {
      const { position, distance } = queue[cursor++];
      for (const next of getNeighbors(position)) {
        if (!inBounds(next.x, next.y)) continue;
        const key = posKey(next);
        if (visited.has(key)) continue;
        if (key === targetKey) return distance + 1;
        if (blockedSet.has(key)) continue;
        visited.add(key);
        queue.push({ position: next, distance: distance + 1 });
      }
    }
    return Infinity;
  }

  function shortestPathDistToAny(from, targets, blockedSet) {
    if (!targets.length) return Infinity;
    const targetKeys = new Set(targets.map(posKey));
    const visited = new Set([posKey(from)]);
    const queue = [{ position: from, distance: 0 }];
    let cursor = 0;

    while (cursor < queue.length) {
      const { position, distance } = queue[cursor++];
      if (targetKeys.has(posKey(position))) return distance;
      for (const next of getNeighbors(position)) {
        if (!inBounds(next.x, next.y)) continue;
        const key = posKey(next);
        if (blockedSet.has(key) || visited.has(key)) continue;
        visited.add(key);
        queue.push({ position: next, distance: distance + 1 });
      }
    }
    return Infinity;
  }

  function buildBlockedSet(gameState, options = {}) {
    const blocked = new Set(gameState.walls);
    if (options.includeEnemies === false) return blocked;
    gameState.enemies.forEach((enemy, index) => {
      if (index === options.excludeEnemyIdx) {
        if (options.hypotheticalTile) blocked.add(posKey(options.hypotheticalTile));
        return;
      }
      blocked.add(posKey(enemy));
    });
    return blocked;
  }

  function countEscapeOptionsAt(gameState, position, enemyKeys, includeDiagonal = true) {
    let count = 0;
    for (const next of getNeighbors(position)) {
      if (!inBounds(next.x, next.y)) continue;
      const key = posKey(next);
      if (gameState.walls.has(key) || enemyKeys.has(key)) continue;
      count++;
    }

    if (!includeDiagonal || (gameState.tokens?.diag ?? 0) <= 0) return count;

    const diagonals = [
      { x: position.x - 1, y: position.y - 1 },
      { x: position.x + 1, y: position.y - 1 },
      { x: position.x - 1, y: position.y + 1 },
      { x: position.x + 1, y: position.y + 1 },
    ];

    for (const diagonal of diagonals) {
      if (!inBounds(diagonal.x, diagonal.y)) continue;
      const key = posKey(diagonal);
      if (gameState.walls.has(key) || enemyKeys.has(key)) continue;
      const horizontal = posKey({ x: diagonal.x, y: position.y });
      const vertical = posKey({ x: position.x, y: diagonal.y });
      if (gameState.walls.has(horizontal) || gameState.walls.has(vertical)) continue;
      count++;
    }
    return count;
  }

  function buildWalls(gameState, count) {
    const avoid = new Set([posKey(gameState.player)]);
    if (gameState.portal) avoid.add(posKey(gameState.portal));
    gameState.enemies.forEach((enemy) => avoid.add(posKey(enemy)));
    const passableCount = GRID_SIZE * GRID_SIZE - count;
    const minimumReachable = Math.max(18, Math.floor(passableCount * 0.5));

    for (let attempt = 0; attempt < 400; attempt++) {
      const walls = new Set();
      while (walls.size < count) {
        const candidate = `${randInt(gameState, GRID_SIZE)},${randInt(gameState, GRID_SIZE)}`;
        if (!avoid.has(candidate)) walls.add(candidate);
      }

      const candidateState = { ...gameState, walls };
      const reachable = reachableTilesFrom(gameState.player, walls);
      const escapes = countEscapeOptionsAt(candidateState, gameState.player, new Set(), false);
      if (reachable.size >= minimumReachable && escapes >= 2) return walls;
    }

    return new Set(gameState.walls || []);
  }

  /* =========================
     DIFFICULTY
  ========================= */

  function getEffectiveConfig(selectedDifficulty, stage, selectedTuning) {
    const base = BASE_DIFFICULTY_CONFIG[selectedDifficulty] || BASE_DIFFICULTY_CONFIG.standard;
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

  /* =========================
     AI POLICY
  ========================= */

  function compareRank(a, b) {
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index++) {
      const left = a[index] ?? 0;
      const right = b[index] ?? 0;
      if (left < right) return -1;
      if (left > right) return 1;
    }
    return 0;
  }

  function getInterceptTargets(gameState) {
    return getNeighbors(gameState.player)
      .filter((position) => inBounds(position.x, position.y))
      .filter((position) => !gameState.walls.has(posKey(position)));
  }

  function assignInterceptTargets(gameState, enemies) {
    const targets = getInterceptTargets(gameState);
    const available = new Set(targets.map(posKey));
    const assignments = new Map();

    enemies.forEach((enemy, index) => {
      const blocked = buildBlockedSet(gameState, { excludeEnemyIdx: index });
      const ranked = targets
        .filter((target) => available.has(posKey(target)))
        .map((target) => ({ target, distance: shortestPathDist(enemy, target, blocked) }))
        .sort((a, b) => a.distance - b.distance || a.target.y - b.target.y || a.target.x - b.target.x);
      if (!ranked.length || !Number.isFinite(ranked[0].distance)) return;
      assignments.set(index, ranked[0].target);
      available.delete(posKey(ranked[0].target));
    });

    return assignments;
  }

  function evaluateEnemyCandidate(gameState, current, index, enemy, tile, cfg, assignedTarget) {
    const blocked = buildBlockedSet(gameState, { excludeEnemyIdx: index, hypotheticalTile: tile });
    blocked.delete(posKey(gameState.player));
    const currentBlocked = buildBlockedSet(gameState, { excludeEnemyIdx: index });
    currentBlocked.delete(posKey(gameState.player));
    const currentDistance = shortestPathDist(enemy, gameState.player, currentBlocked);
    const distance = shortestPathDist(tile, gameState.player, blocked);
    const chaseTier = distance < currentDistance ? 0 : distance === currentDistance ? 1 : 2;

    const hypotheticalEnemyKeys = new Set(
      current.map((other, otherIndex) => posKey(otherIndex === index ? tile : other))
    );
    const escapes = countEscapeOptionsAt(gameState, gameState.player, hypotheticalEnemyKeys, true);
    const interceptDistance = assignedTarget
      ? shortestPathDist(tile, assignedTarget, blocked)
      : shortestPathDistToAny(tile, getInterceptTargets(gameState), blocked);
    const duplicatePressure = current.reduce((count, other, otherIndex) => {
      if (otherIndex === index) return count;
      return count + (manhattan(tile, other) <= 1 ? 1 : 0);
    }, 0);
    const direction = { dx: tile.x - enemy.x, dy: tile.y - enemy.y };
    const followsIntent = enemy.intentLock > 0 && enemy.intent &&
      enemy.intent.dx === direction.dx && enemy.intent.dy === direction.dy;
    const coordination =
      escapes * cfg.trapWeight +
      interceptDistance * cfg.interceptWeight +
      duplicatePressure * Math.max(0, tuning.gapFillBonus / 2) -
      (escapes <= 1 ? cfg.squeezeBonus : 0);

    return {
      target: tile,
      direction,
      rank: [chaseTier, distance, coordination, followsIntent ? 0 : 1, tile.y, tile.x],
    };
  }

  function selectEnemyProposal(gameState, current, index, cfg, assignments) {
    const enemy = current[index];
    if (enemy.stunned > 0) {
      return {
        target: { ...enemy },
        rank: [9, 9, 9, index],
        nextEnemy: { ...enemy, stunned: enemy.stunned - 1, intent: null, intentLock: 0 },
      };
    }

    const candidates = getNeighbors(enemy)
      .filter((tile) => inBounds(tile.x, tile.y))
      .filter((tile) => !gameState.walls.has(posKey(tile)));

    const kill = candidates.find((tile) => samePosition(tile, gameState.player));
    if (kill) {
      return {
        target: kill,
        rank: [-1, 0, 0, index],
        nextEnemy: {
          ...enemy,
          x: kill.x,
          y: kill.y,
          intent: { dx: kill.x - enemy.x, dy: kill.y - enemy.y },
          intentLock: cfg.commitLockTurns,
        },
      };
    }

    if (!candidates.length) {
      return {
        target: { ...enemy },
        rank: [8, 8, 8, index],
        nextEnemy: { ...enemy, intent: null, intentLock: 0 },
      };
    }

    const assignedTarget = assignments.get(index) || null;
    const evaluated = candidates
      .map((tile) => evaluateEnemyCandidate(gameState, current, index, enemy, tile, cfg, assignedTarget))
      .sort((a, b) => compareRank(a.rank, b.rank));
    const selected = evaluated[0];

    return {
      target: selected.target,
      rank: [...selected.rank, index],
      nextEnemy: {
        ...enemy,
        x: selected.target.x,
        y: selected.target.y,
        intent: selected.direction,
        intentLock: cfg.commitLockTurns,
      },
    };
  }

  function resolveEnemyDestinations(current, proposals) {
    const originOwner = new Map(current.map((enemy, index) => [posKey(enemy), index]));
    const destinationGroups = new Map();

    proposals.forEach((proposal, index) => {
      const key = posKey(proposal.target);
      if (!destinationGroups.has(key)) destinationGroups.set(key, []);
      destinationGroups.get(key).push(index);
    });

    const moving = new Set();
    for (const indices of destinationGroups.values()) {
      indices.sort((left, right) => compareRank(proposals[left].rank, proposals[right].rank) || left - right);
      const winner = indices[0];
      if (!samePosition(proposals[winner].target, current[winner])) moving.add(winner);
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const index of [...moving]) {
        const occupant = originOwner.get(posKey(proposals[index].target));
        if (occupant === undefined || occupant === index || moving.has(occupant)) continue;
        moving.delete(index);
        changed = true;
      }
    }

    const resolved = current.map((enemy, index) => {
      if (!moving.has(index)) return { ...enemy, intent: null, intentLock: 0 };
      return { ...proposals[index].nextEnemy };
    });

    const unique = new Set(resolved.map(posKey));
    if (unique.size !== resolved.length) {
      throw new Error("Enemy destination invariant failed: duplicate final positions");
    }
    return resolved;
  }

  function planEnemyMovesForState(gameState, cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning || DEFAULT_TUNING)) {
    const current = gameState.enemies.map((enemy) => ({ ...enemy }));
    const assignments = assignInterceptTargets(gameState, current);
    const proposals = current.map((_, index) => selectEnemyProposal(gameState, current, index, cfg, assignments));
    const resolvedMoves = resolveEnemyDestinations(current, proposals);
    const intentTiles = new Set();

    resolvedMoves.forEach((enemy, index) => {
      if (!samePosition(enemy, current[index])) intentTiles.add(posKey(enemy));
    });

    return { resolvedMoves, intentTiles };
  }

  /* =========================
     SPAWN / PROGRESSION
  ========================= */

  function isEdgeTile(position) {
    return position.x === 0 || position.y === 0 || position.x === GRID_SIZE - 1 || position.y === GRID_SIZE - 1;
  }

  function enemyCountForStage(stage) {
    if (stage <= 5) return 2;
    if (stage <= 10) return 3;
    if (stage <= 15) return 4;
    if (stage <= 20) return 5;
    return 6;
  }

  function getSafeSpawnTiles(gameState) {
    const enemyKeys = new Set(gameState.enemies.map(posKey));
    const tiles = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = { x, y };
        const key = posKey(tile);
        if (!isEdgeTile(tile)) continue;
        if (gameState.walls.has(key) || enemyKeys.has(key) || samePosition(tile, gameState.player)) continue;
        if (manhattan(tile, gameState.player) <= 1) continue;
        const hypothetical = new Set(enemyKeys);
        hypothetical.add(key);
        if (countEscapeOptionsAt(gameState, gameState.player, hypothetical, true) < 2) continue;
        tiles.push(tile);
      }
    }
    return tiles;
  }

  function pickSpawnTile(gameState) {
    const safe = getSafeSpawnTiles(gameState);
    if (!safe.length) return null;
    const trail = gameState.playerTrail || [];
    const weights = safe.map((tile) => trail.reduce((weight, trailKey) => {
      const [x, y] = trailKey.split(",").map(Number);
      return weight * (1 + Math.abs(tile.x - x) + Math.abs(tile.y - y));
    }, 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = gameState.rng() * total;
    for (let index = 0; index < safe.length; index++) {
      roll -= weights[index];
      if (roll <= 0) return safe[index];
    }
    return safe[safe.length - 1];
  }

  function spawnEnemy(gameState) {
    const tile = pickSpawnTile(gameState);
    if (!tile) return false;
    const id = gameState.nextEnemyId++;
    gameState.enemies.push({
      id,
      x: tile.x,
      y: tile.y,
      phase: visualPhase(gameState.seed, id),
      intent: null,
      intentLock: 0,
      stunned: 0,
    });
    return true;
  }

  function computeNextPortalTurn(stage, currentTurn) {
    const stageAdjustment = Math.min(5, Math.floor(Math.max(0, stage - 1) / 5));
    return currentTurn + Math.max(10, 15 - stageAdjustment);
  }

  function spawnPortalIfNeeded(gameState) {
    if (gameState.portal || gameState.turns < gameState.nextPortalAtTurn) return;
    const reachable = reachableTilesFrom(gameState.player, gameState.walls);
    const candidates = [...reachable]
      .map((key) => {
        const [x, y] = key.split(",").map(Number);
        return { x, y };
      })
      .filter((tile) => !samePosition(tile, gameState.player))
      .filter((tile) => !gameState.enemies.some((enemy) => samePosition(enemy, tile)));

    if (!candidates.length) {
      gameState.nextPortalAtTurn++;
      return;
    }
    gameState.portal = candidates[randInt(gameState, candidates.length)];
    debugAssertPortal(gameState);
  }

  function chooseRevivalTile(gameState) {
    const reachable = reachableTilesFrom(gameState.player, gameState.walls);
    const enemyKeys = new Set(gameState.enemies.map(posKey));
    const candidates = [];

    for (const key of reachable) {
      if (enemyKeys.has(key)) continue;
      const [x, y] = key.split(",").map(Number);
      const tile = { x, y };
      const escapes = countEscapeOptionsAt(gameState, tile, enemyKeys, false);
      if (escapes < 2) continue;
      const minimumDistance = gameState.enemies.length
        ? Math.min(...gameState.enemies.map((enemy) => manhattan(enemy, tile)))
        : GRID_SIZE * 2;
      candidates.push({ tile, escapes, minimumDistance });
    }

    candidates.sort((a, b) =>
      b.minimumDistance - a.minimumDistance ||
      b.escapes - a.escapes ||
      a.tile.y - b.tile.y ||
      a.tile.x - b.tile.x
    );
    return candidates[0]?.tile || null;
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
    spawnPortalIfNeeded(gameState);
    grantScheduledRewards(gameState);

    if (gameState.turns > gameState.best) {
      gameState.best = gameState.turns;
      memoryStore.bestScores[getBestKey(gameState.seedMode, gameState.seed, gameState.difficulty)] = gameState.best;
      saveMemoryStore();
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
    gameState.effects.freezeUntil = performanceNow() + DEATH_FREEZE_MS;
    gameState.effects.killer = killer ? { x: killer.x, y: killer.y } : null;
    playDeathSound();
    render();
    setTimeout(() => {
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
      if (countEscapeOptionsAt(gameState, gameState.player, enemyKeys, true) === 0) {
        const result = handleDeath(gameState, "No escape.", null);
        if (result === "DEAD") return false;
      }

      finalizeTurn(gameState);
      return true;
    } catch (error) {
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
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || (dx === 0 && dy === 0)) return false;

    if (gameState.phaseArmed) {
      if (dx !== 0 && dy !== 0) return false;
      const first = { x: gameState.player.x + dx, y: gameState.player.y + dy };
      const second = { x: first.x + dx, y: first.y + dy };
      if (!inBounds(first.x, first.y) || !inBounds(second.x, second.y)) return false;
      if (gameState.walls.has(posKey(first)) || gameState.walls.has(posKey(second))) return false;
      if (gameState.enemies.some((enemy) => samePosition(enemy, second))) return false;

      const phasedEnemy = gameState.enemies.find((enemy) => samePosition(enemy, first));
      if (phasedEnemy) phasedEnemy.stunned = Math.max(phasedEnemy.stunned, 1);
      gameState.phaseArmed = false;
      gameState.phaseUsed = true;
      movePlayer(gameState, second);
      playMoveSound();
      return completePlayerMove(gameState);
    }

    const isDiagonal = dx !== 0 && dy !== 0;
    if (isDiagonal && gameState.tokens.diag <= 0) return false;
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
      updateHud();
      return true;
    }

    void resolveTurnAsync(gameState.runId);
    return true;
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
    if (used > 0 && !gameState.gameOver) void resolveTurnAsync(gameState.runId);
    return true;
  }

  function setDifficulty(nextDifficulty) {
    if (!BASE_DIFFICULTY_CONFIG[nextDifficulty]) return false;
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
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function performanceNow() {
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

  function boot() {
    if (!hasDOM) return;
    cacheUI();
    loadMemoryStore();
    difficulty = BASE_DIFFICULTY_CONFIG[memoryStore.difficulty] ? memoryStore.difficulty : "standard";
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
    buildWalls,
    getEffectiveConfig,
    planEnemyMovesForState,
    resolveEnemyDestinations,
    chooseRevivalTile,
    initializeState,
    boot,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMCore;
if (typeof window !== "undefined" && typeof document !== "undefined") OMMCore.boot();
