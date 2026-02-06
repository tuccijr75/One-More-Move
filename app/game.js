/* =========================
   SETTINGS (versioned)
========================= */
function tuningKey() {
  return `one-more-move-tuning-v${SETTINGS_VERSION}`;
}

const SETTINGS_VERSION = 1;

// In-memory storage replacement
const memoryStore = {
  settings: {},
  difficulty: 'standard',
  bestScores: {},
  muted: false
};

const DEFAULT_TUNING = {
  version: SETTINGS_VERSION,

  // board
  walls: 10,
  initialEnemies: 2,

  // spawning
  initialSpawn: 10,
  rampSpeed: 15,

  // AI tuning
  escapePenalty: 1.5,
  gapFillBonus: 3.0,
};

function loadTuning() {
  let raw = null;
  try {
    raw = memoryStore.settings[tuningKey()];
  } catch {
    raw = null;
  }

  // No settings yet → defaults
  if (!raw || typeof raw !== "object") {
    saveTuning(DEFAULT_TUNING);
    return { ...DEFAULT_TUNING };
  }

  // Migration hook
  if (raw.version !== SETTINGS_VERSION) {
    raw = migrateSettings(raw);
    saveTuning(raw);
  }

  return {
    ...DEFAULT_TUNING,
    ...raw,
  };
}

function saveTuning(tuning) {
  memoryStore.settings[tuningKey()] = { ...tuning };
}

function migrateSettings(oldSettings) {
  // Future-proof switch
  switch (oldSettings.version) {
    default:
      return {
        ...DEFAULT_TUNING,
        version: SETTINGS_VERSION,
      };
  }
}

function applySettings() {
  tuning = loadTuning();

  WALL_COUNT = tuning.walls;
  INITIAL_ENEMIES = tuning.initialEnemies;

  stateSpawnInitial = tuning.initialSpawn;
  stateRampSpeed = tuning.rampSpeed;

  recomputeEffectiveConfig();
}

const GRID_SIZE = 10;
const CELL_SIZE = 60;
let WALL_COUNT;
let INITIAL_ENEMIES;
const INTENT_FLASH_MS = 100;
const DEATH_FREEZE_MS = 280;
const STATUS_MS = 1200;
const WALL_ADD_EVERY_STAGES = 5;  // add +1 wall at stage 5,10,15...
const WALL_MAX = 30;              // safety cap (optional but recommended)

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const turnsEl = document.getElementById("turns");
const bestEl = document.getElementById("best");
const stageEl = document.getElementById("stage");
const difficultyEl = document.getElementById("difficulty");
const seedEl = document.getElementById("seed");
const modeEl = document.getElementById("mode");
const overlayEl = document.getElementById("overlay");
const stageBannerEl = document.getElementById("stage-banner");
const finalTurnsEl = document.getElementById("final-turns");
const deathCauseEl = document.getElementById("death-cause");
const finalSeedEl = document.getElementById("final-seed");
const finalModeEl = document.getElementById("final-mode");

const settingsEl = document.getElementById("settings");
const settingsBackEl = document.getElementById("settings-back");
const settingsSaveEl = document.getElementById("settings-save");
const settingsResetEl = document.getElementById("settings-reset");

const wallCountInput = document.getElementById("set-wallCount");
const enemyCountInput = document.getElementById("set-initialEnemies");
const initialSpawnInput = document.getElementById("set-initialSpawn");
const rampSpeedInput = document.getElementById("set-rampSpeed");
const escapePenaltyInput = document.getElementById("set-escapePenalty");
const gapFillInput = document.getElementById("set-gapFill");

const SLIDER_PAIRS = [
  ["set-wallCount", "set-wallCountNum"],
  ["set-initialEnemies", "set-initialEnemiesNum"],
  ["set-initialSpawn", "set-initialSpawnNum"],
  ["set-rampSpeed", "set-rampSpeedNum"],
  ["set-escapePenalty", "set-escapePenaltyNum"],
  ["set-gapFill", "set-gapFillNum"],
];

function bindSlider(slider, number) {
  slider.addEventListener("input", () => number.value = slider.value);
  number.addEventListener("input", () => slider.value = number.value);
}

let stateSpawnInitial = DEFAULT_TUNING.initialSpawn;
let stateRampSpeed = DEFAULT_TUNING.rampSpeed;
let rng = null;
let state = null;
let difficulty = "standard";
let muted = false;
let audioContext = null;

const BASE_DIFFICULTY_CONFIG = {
  standard: { turnDelay: 150, showIntentFlash: true, escapePenalty: 1.5, gapFillBonus: 3.0, spawnFloor: 3, dangerFeedback: true },
  hard: { turnDelay: 120, showIntentFlash: true, escapePenalty: 2.0, gapFillBonus: 3.5, spawnFloor: 3, dangerFeedback: true },
  hardcore: { turnDelay: 80, showIntentFlash: false, escapePenalty: 2.5, gapFillBonus: 4.0, spawnFloor: 2, dangerFeedback: false },
};

// =========================
// TUNING + EFFECTIVE CONFIG
// =========================

let tuning = { ...DEFAULT_TUNING };
let effectiveCfg = null;

function getEffectiveConfig(difficulty, stage, tuning) {
  const base = BASE_DIFFICULTY_CONFIG[difficulty];
  const s = Math.max(1, stage || 1);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const pressureMult = clamp(1 + 0.02 * (s - 1), 1, 1.30);
  const gapMult      = clamp(1 + 0.015 * (s - 1), 1, 1.25);
  const speedMult    = clamp(1 - 0.008 * (s - 1), 0.80, 1.00);

  const escapePenaltyTuned =
    base.escapePenalty *
    (tuning.escapePenalty / BASE_DIFFICULTY_CONFIG.standard.escapePenalty);

  const gapFillBonusTuned =
    base.gapFillBonus *
    (tuning.gapFillBonus / BASE_DIFFICULTY_CONFIG.standard.gapFillBonus);

  return {
    ...base,
    turnDelay: Math.round(base.turnDelay * speedMult),
    escapePenalty: escapePenaltyTuned * pressureMult,
    gapFillBonus: gapFillBonusTuned * gapMult,
  };
}

function recomputeEffectiveConfig() {
  effectiveCfg = getEffectiveConfig(
    difficulty,
    state?.stage || 1,
    tuning
  );
}

function showStageBanner(stage) {
  if (!stageBannerEl) return;
  stageBannerEl.textContent = `STAGE ${stage}`;
  stageBannerEl.classList.remove("hidden");
  state.effects.stageBannerUntil = performance.now() + 700;
}

function startStageTransitionFx() {
  const now = performance.now();
  state.effects.stageFx = {
    startMs: now,
    durationMs: 520,
    x: state.player.x,
    y: state.player.y
  };
}

/* =========================
   RNG
========================= */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

function randInt(max) {
  return Math.floor(rng() * max);
}

/* =========================
   HELPERS
========================= */
function posKey(p) { return `${p.x},${p.y}`; }
function inBounds(x, y) { return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE; }
function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function getNeighbors(pos) {
  return [
    { x: pos.x, y: pos.y - 1 },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x + 1, y: pos.y },
  ];
}

function countPlayerEscapeOptions(enemyKeys) {
  let count = 0;
  for (const n of getNeighbors(state.player)) {
    if (!inBounds(n.x, n.y)) continue;
    const k = posKey(n);
    if (state.walls.has(k)) continue;
    if (enemyKeys.has(k)) continue;
    count++;
  }
  // Conditional diagonal escapes (only if diagonal token available)
  if (state.tokens?.diag > 0) {
    const px = state.player.x;
    const py = state.player.y;

    const diagonals = [
      { x: px - 1, y: py - 1 },
      { x: px + 1, y: py - 1 },
      { x: px - 1, y: py + 1 },
      { x: px + 1, y: py + 1 },
    ];

    for (const d of diagonals) {
      if (!inBounds(d.x, d.y)) continue;

      const k = posKey(d);
      if (state.walls.has(k)) continue;
      if (enemyKeys.has(k)) continue;

      // Diagonal wall-cut prevention (same rule as movement)
      const a = posKey({ x: d.x, y: py });
      const b = posKey({ x: px, y: d.y });
      if (state.walls.has(a) || state.walls.has(b)) continue;

      count++;
    }
  }

  return count;
}

function isEnemyNear(enemy) {
  return manhattan(enemy, state.player) <= 2;
}

function getPlayerInterceptTargets() {
  return getNeighbors(state.player)
    .filter(p => inBounds(p.x, p.y))
    .filter(p => !state.walls.has(posKey(p)));
}

function scoreEnemyMove(idx, enemy, tile, cfg) {
// HARD ATTACK OVERRIDE — killing move always wins
if (tile.x === state.player.x && tile.y === state.player.y) {
  return 100000;
}

  const blocked = buildBlockedSet(idx, tile);
  const dist = shortestPathDist(tile, state.player, blocked);

  let score = -dist * 20;

// Aggressive adjacency bias
if (dist === 1) {
  score +=
    difficulty === "standard" ? 6 :
    difficulty === "hard"     ? 10 :
    difficulty === "hardcore" ? 16 :
                                6;
}

// Intercept bias: prefer occupying player-adjacent tiles
const intercepts = getPlayerInterceptTargets();
if (intercepts.length) {
  const interceptDist = shortestPathDistToAny(
    tile,
    intercepts,
    blocked
  );

  const interceptWeight =
    difficulty === "standard" ? 6 :
    difficulty === "hard"     ? 10 :
    difficulty === "hardcore" ? 16 :
                                6;
if (interceptDist <= dist) {
  score -= interceptDist * interceptWeight;
}

}

  // Soft coordination: discourage multiple enemies targeting same intercept
  for (const other of state.enemies) {
    if (other === enemy) continue;
    if (other.intent && enemy.intent && posKey({
    x: enemy.x + enemy.intent.dx,
    y: enemy.y + enemy.intent.dy
  }) === posKey(tile)) {

    score -=
      difficulty === "standard" ? 2 :
      difficulty === "hard"     ? 6 :
      difficulty === "hardcore" ? 12 :
                                  2;
  }
}

// Penalize moves that leave player escape routes
  const hypothetical = new Set(state.enemies.map((e, i) => i === idx ? posKey(tile) : posKey(e)));
  
  const escapeCount = countPlayerEscapeOptions(hypothetical);

// Stronger pressure earlier, scaled by difficulty
const escapeWeight =
  difficulty === "standard" ? 1.0 :
  difficulty === "hard"     ? 1.4 :
  difficulty === "hardcore" ? 1.9 :
                              1.0;

// Trap only matters if we're not falling behind on chase
if (dist <= 3) {
score -= escapeCount * cfg.escapePenalty * escapeWeight;
}

// Brutal final squeeze
if (escapeCount <= 1) {
  score -= 6 * escapeWeight;
}

// Bonus for closing gaps between enemies
for (const other of state.enemies) {
  if (other === enemy) continue;
  const gap = manhattan(tile, other);
  if (gap <= 2) score += cfg.gapFillBonus;
}

  return score;
}

function enemyPulseStrength(enemy) {
  const d = manhattan(enemy, state.player);
  if (d === 1) return 1.0;
  if (d === 2) return 0.45;
  return 0.0;
}

function playerHaloPhase() {
  // Slow, calm rotation
  return (performance.now() * 0.0004) % 1; // 0 → 1
}

// Smooth 0..1 pulse with per-enemy phase offset (breathing feel)
function pulsePhaseOffset(offset) {
  const t = performance.now() * 0.012; // ~1.9 Hz
  return (Math.sin(t + offset) + 1) / 2; // 0..1
}

/* =========================
   GRID UTILITIES (Phase 1)
========================= */

// Build a blocked tile set (walls + enemies)
function buildBlockedSet(excludeEnemyIdx = null, hypotheticalTile = null) {
  const blocked = new Set(state.walls);

  state.enemies.forEach((e, i) => {
    if (i === excludeEnemyIdx) {
      if (hypotheticalTile) blocked.add(posKey(hypotheticalTile));
    } else {
      blocked.add(posKey(e));
    }
  });

  return blocked;
}

// BFS flood fill: all reachable tiles from start
function reachableTilesFrom(start, blockedSet) {
  const visited = new Set();
  const queue = [start];
  visited.add(posKey(start));

  while (queue.length) {
    const cur = queue.shift();
    for (const n of getNeighbors(cur)) {
      if (!inBounds(n.x, n.y)) continue;
      const k = posKey(n);
      if (blockedSet.has(k)) continue;
      if (visited.has(k)) continue;
      visited.add(k);
      queue.push(n);
    }
  }

  return visited;
}

function buildWallsCount(count) {
  const avoid = new Set();
  avoid.add(posKey(state.player));
  for (const e of state.enemies) avoid.add(posKey(e));
  if (state.portal) avoid.add(posKey(state.portal));

  for (let attempt = 0; attempt < 200; attempt++) {
    const walls = new Set();
    while (walls.size < count) {
      const x = randInt(GRID_SIZE);
      const y = randInt(GRID_SIZE);
      const k = `${x},${y}`;
      if (avoid.has(k)) continue;
      walls.add(k);
    }

    const blocked = new Set(walls);
    const reachable = reachableTilesFrom(state.player, blocked);
    if (reachable.size > 1) return walls;
  }

  return state.walls;
}

// Shortest path distance using BFS
function shortestPathDist(from, to, blockedSet) {
  if (posKey(from) === posKey(to)) return 0;

  const visited = new Set();
  const queue = [{ pos: from, dist: 0 }];
  visited.add(posKey(from));

  while (queue.length) {
    const { pos, dist } = queue.shift();
    for (const n of getNeighbors(pos)) {
      if (!inBounds(n.x, n.y)) continue;
      const k = posKey(n);
      if (blockedSet.has(k)) continue;
      if (visited.has(k)) continue;
      if (k === posKey(to)) return dist + 1;
      visited.add(k);
      queue.push({ pos: n, dist: dist + 1 });
    }
  }

  return Infinity;
}

// Shortest path to any target (single BFS)
function shortestPathDistToAny(from, targets, blockedSet) {
  const targetKeys = new Set(targets.map(posKey));
  const visited = new Set();
  const queue = [{ pos: from, dist: 0 }];
  visited.add(posKey(from));

  while (queue.length) {
    const { pos, dist } = queue.shift();
    const k = posKey(pos);
    if (targetKeys.has(k)) return dist;

    for (const n of getNeighbors(pos)) {
      if (!inBounds(n.x, n.y)) continue;
      const nk = posKey(n);
      if (blockedSet.has(nk)) continue;
      if (visited.has(nk)) continue;
      visited.add(nk);
      queue.push({ pos: n, dist: dist + 1 });
    }
  }

  return Infinity;
}

function relocateWallsOnStageAdvance() {
  if (state.stage % WALL_ADD_EVERY_STAGES === 0) {
    WALL_COUNT = Math.min(WALL_MAX, WALL_COUNT + 1);
  }
  state.walls = buildWallsCount(WALL_COUNT);
}

/* =========================
   STAGES & PORTAL
========================= */
function computeNextPortalTurn(stage, currentTurn) {
  return currentTurn + 15;
}

function spawnPortalIfNeeded() {
  if (state.portal) return;
  if (state.turns < state.nextPortalAtTurn) return;

  const blocked = new Set(state.walls);
  const reachable = reachableTilesFrom(state.player, blocked);

  const candidates = [...reachable]
    .map(k => {
      const [x, y] = k.split(",").map(Number);
      return { x, y };
    })
    .filter(p => !(p.x === state.player.x && p.y === state.player.y))
    .filter(p => !state.enemies.some(e => e.x === p.x && e.y === p.y));

  if (!candidates.length) {
    // fairness fallback — try again next turn
    state.nextPortalAtTurn++;
    return;
  }

  state.portal = candidates[randInt(candidates.length)];
}

function enemyCountForStage(stage) {
  if (stage <= 5) return 2;
  if (stage <= 10) return 3;
  if (stage <= 15) return 4;
  if (stage <= 20) return 5;
  return 6; // hard cap for this release
}

function advanceStage() {
  startStageTransitionFx();     // spin + dissolve on the player tile
  state.stage++;
  showStageBanner(state.stage);

  // Remove portal
  state.portal = null;

  // Compute next portal timing
  state.nextPortalAtTurn = computeNextPortalTurn(state.stage, state.turns);

  relocateWallsOnStageAdvance();

  // Extra life cadence (non-cumulative)
  if (state.stage % 15 === 0 && !state.hasExtraLife) {
    state.hasExtraLife = true;
  }

  // Reset enemies for new stage (stage identity)
  state.enemies = [];
  const targetEnemies = enemyCountForStage(state.stage);
  for (let i = 0; i < targetEnemies; i++) {
    spawnEnemy();
  }

  // Reset spawn pacing for the new stage
  state.nextSpawnTurn = Math.max(1, stateSpawnInitial);

  // Recompute difficulty scaling
  recomputeEffectiveConfig();

  updateHud();

}

/* =========================
   WALLS / SPAWN
========================= */
function isEdgeTile(pos) {
  return pos.x === 0 || pos.x === GRID_SIZE - 1 || pos.y === 0 || pos.y === GRID_SIZE - 1;
}

function getSafeSpawnTiles() {
  const tiles = [];
  const enemyKeys = new Set(state.enemies.map(posKey));
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const key = `${x},${y}`;
      if (!isEdgeTile({ x, y })) continue;
      if (state.walls.has(key) || enemyKeys.has(key)) continue;
      if (manhattan({ x, y }, state.player) <= 1) continue;

      // Forced-loss rejection: do not allow a spawn that immediately removes all escape options
      const hypothetical = new Set(enemyKeys);
      hypothetical.add(key);
      if (countPlayerEscapeOptions(hypothetical) < 2) continue;

      tiles.push({ x, y });

    }
  }
  return tiles;
}

function pickSpawnTile() {
  const safe = getSafeSpawnTiles();
  if (!safe.length) return null;

  const trail = state.playerTrail || [];
  const weights = safe.map(t => {
    let w = 1;
    for (const pk of trail) {
      const [px, py] = pk.split(",").map(Number);
      w *= (1 + Math.abs(t.x - px) + Math.abs(t.y - py));
    }
    return w;
  });

  let total = 0;
  for (const w of weights) total += w;

  let r = rng() * total;
  for (let i = 0; i < safe.length; i++) {
    r -= weights[i];
    if (r <= 0) return safe[i];
  }
  return safe[safe.length - 1];
}

function spawnEnemy() {
  const tile = pickSpawnTile();
  if (!tile) return false;
  state.enemies.push({
  x: tile.x,
  y: tile.y,
  phase: rng() * Math.PI * 2, // stable per-enemy phase offset
 
  // Commitment
  intent: null,
  intentLock: 0,

  stunned: 0,
});

  return true;
}

/* =========================
   AUDIO (safe minimal)
========================= */
function ensureAudio() {
  if (audioContext || muted) return;
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    audioContext = null;
  }
}

function playTone({ frequency, duration, type, gain }) {
  if (!audioContext || muted) return;
  const o = audioContext.createOscillator();
  const g = audioContext.createGain();
  o.type = type;
  o.frequency.value = frequency;
  g.gain.value = gain;
  o.connect(g);
  g.connect(audioContext.destination);
  o.start();
  o.stop(audioContext.currentTime + duration);
}

function playMoveSound() { playTone({ frequency: 480, duration: 0.05, type: "triangle", gain: 0.06 }); }
function playEnemySound() { playTone({ frequency: 140, duration: 0.08, type: "sine", gain: 0.08 }); }
function playDeathSound() { playTone({ frequency: 80, duration: 0.18, type: "sawtooth", gain: 0.1 }); }

/* =========================
   HUD / STATE
========================= */
function showCooldownStatus(now) {
  const remainingMs = Math.max(0, state.rewardCooldownUntil - now);
  if (remainingMs <= 0) return;

  const secs = Math.ceil(remainingMs / 1000);
  state.effects.statusText = `Ability cooling down (${secs}s)`;
  state.effects.statusUntil = now + 900;
}

function bestKey(seedMode) {
  return `one-more-move-best-v${SETTINGS_VERSION}-${seedMode}`;
}

function updateHud() {
  // These spans are "numbers only" (labels already exist in HTML)
  turnsEl.textContent = state.turns;
  bestEl.textContent  = state.best;
  stageEl.textContent = state.stage;

  // Center HUD items should stay short (no prefixes)
  difficultyEl.textContent = difficulty.toUpperCase();
  seedEl.textContent       = `Seed ${state.seed}`;
  modeEl.textContent       = String(state.seedMode || "RUN").toUpperCase();

  // Focus: Diagonal token, Wall token, Phase Step availability, Freeze Turn token, Time Freeze (Space) moves
  const focusEl = document.getElementById("focus");
if (focusEl) {
  const D = state.tokens?.diag ?? 0;          // Diagonal token
  const W = state.tokens?.wall ?? 0;          // Wall Ignore token
  const F = state.phaseUsed ? 0 : 1;          // Phase Step ready (1) vs used (0)
  const B = state.tokens?.freeze ?? 0;        // Freeze Turn token (B)

  const holding = !!state.holdSpace;
  const tfReady = state.tokens?.timeFreeze ?? 0;
  const TF = holding ? (state.holdMovesLeft ?? 0) : (tfReady ? 2 : 0);

  focusEl.innerHTML = `
    <span class="f-item">D <span class="f-val">${D}</span></span>
    <span class="f-item">W <span class="f-val">${W}</span></span>
    <span class="f-item">F <span class="f-val">${F}</span></span>
    <span class="f-item">B <span class="f-val">${B}</span></span>
    <span class="f-item tf ${holding ? "" : "is-off"}">TF <span class="f-val">${TF}</span></span>
  `;
  }
}

function setDifficulty(newDifficulty) {
  if (!BASE_DIFFICULTY_CONFIG[newDifficulty]) return;
  difficulty = newDifficulty;
  recomputeEffectiveConfig();
  memoryStore.difficulty = difficulty;
  updateHud();

  // ✅ SAFE UI SYNC (only if settings panel exists)
  const profileEl = document.getElementById("settings-profile");
  if (profileEl) {
    profileEl.textContent = difficulty.toUpperCase();
  }
}

/* =========================
   ADVANCED AI (restored)
========================= */
function planEnemyMoves(cfg) {
  const current = state.enemies.map(e => ({ ...e }));
  const desired = [];

  // choose best neighbor for each enemy (vacated tiles allowed)
  current.forEach((enemy, idx) => {
    // Skip stunned enemies (Phase Step safeguard)
    if (enemy.stunned > 0) {
      desired.push({ ...enemy, stunned: enemy.stunned - 1 });
      return;
    }

    let candidates = getNeighbors(enemy)
      .filter(t => inBounds(t.x, t.y))
      .filter(t => !state.walls.has(posKey(t)));

    // --- Commitment drop check (belongs once per enemy, BEFORE scoring tiles) ---
    // If the player pulled away relative to the enemy's CURRENT position,
    // drop commitment so this enemy can re-path.
    if (
      enemy.intentLock > 0 &&
      enemy.intent &&
      manhattan(enemy, state.player) >
        manhattan(
          { x: enemy.x - enemy.intent.dx, y: enemy.y - enemy.intent.dy },
          state.player
        )
    ) {
      enemy.intentLock = 0;
      enemy.intent = null;
    }

    // Commitment: if intent is locked, force that direction unless blocked
    if (enemy.intentLock > 0 && enemy.intent) {
      const locked = {
        x: enemy.x + enemy.intent.dx,
        y: enemy.y + enemy.intent.dy
      };
      const lockedKey = posKey(locked);

      // occupancy must be checked against CURRENT snapshot
      const occupied = current.some(
        (e, j) => j !== idx && e.x === locked.x && e.y === locked.y
      );

      if (inBounds(locked.x, locked.y) && !state.walls.has(lockedKey) && !occupied) {
        candidates = [locked];
      }
    }

    if (!candidates.length) {
      desired.push({ ...enemy });
      return;
    }

    let best = { ...enemy };
    let bestScore = -Infinity;
    let bestDist = Infinity;

    // Precompute once per enemy (saves work and avoids subtle drift bugs)
    const currentEscapes = countPlayerEscapeOptions(new Set(current.map(posKey)));

    for (const tile of candidates) {
      let score = scoreEnemyMove(idx, enemy, tile, cfg);

      // Keep this tie-breaker local to the candidate
      const dist = manhattan(tile, state.player);

      // If this candidate reduces player escape options, reward it
      const hypotheticalEnemyKeys = new Set(
        current.map((e, i) => (i === idx ? posKey(tile) : posKey(e)))
      );
      const nextEscapes = countPlayerEscapeOptions(hypotheticalEnemyKeys);

      if (nextEscapes < currentEscapes) {
        score +=
          difficulty === "standard" ? 2 :
          difficulty === "hard"     ? 6 :
          difficulty === "hardcore" ? 12 :
                                      2;
      }

      // THEN compare (MUST be inside the candidate loop)
      if (score > bestScore || (score === bestScore && dist < bestDist)) {
        best = {
          ...enemy,
          x: tile.x,
          y: tile.y,
          intent: { dx: tile.x - enemy.x, dy: tile.y - enemy.y },
          intentLock:
            difficulty === "standard" ? 1 :
            difficulty === "hard"     ? 2 :
            difficulty === "hardcore" ? 3 :
                                        2
        };
        bestScore = score;
        bestDist = dist;
      }
    }

    // decay lock if did not move
    if (best.x === enemy.x && best.y === enemy.y) {
      best.intent = null;
      best.intentLock = 0;
    }

    desired.push(best);
  });

  // disallow moving into a tile whose occupant stays
  const origins = current.map(p => ({ ...p }));
  desired.forEach((target, i) => {
    origins.forEach((origin, j) => {
      if (i === j) return;
      const ok =
        posKey(target) === posKey(origin) &&
        posKey(desired[j]) === posKey(origin);
      if (ok) desired[i] = { ...origins[i] };
    });
  });

  // destination map
  const destMap = new Map();
  desired.forEach((tile, idx) => {
    const k = posKey(tile);
    if (!destMap.has(k)) destMap.set(k, []);
    destMap.get(k).push(idx);
  });

  const resolved = current.map(e => ({ ...e }));
  const resolvedIdx = new Set();

  // allow pure swaps
  for (let i = 0; i < desired.length; i++) {
    if (resolvedIdx.has(i)) continue;

    for (let j = i + 1; j < desired.length; j++) {
      if (resolvedIdx.has(j)) continue;

      const swapA = posKey(desired[i]) === posKey(current[j]);
      const swapB = posKey(desired[j]) === posKey(current[i]);
      if (!swapA || !swapB) continue;

      // Never allow swaps that would move into the player tile (kills must resolve as kills).
      if (
        (desired[i].x === state.player.x && desired[i].y === state.player.y) ||
        (desired[j].x === state.player.x && desired[j].y === state.player.y)
      ) {
        continue;
      }

      const a = destMap.get(posKey(desired[i])) || [];
      const b = destMap.get(posKey(desired[j])) || [];

      if (a.length === 1 && b.length === 1) {
        resolved[i] = { ...desired[i] };
        resolved[j] = { ...desired[j] };
        resolvedIdx.add(i);
        resolvedIdx.add(j);
      }
    }
  }

  // resolve collisions
  for (const [k, indices] of destMap.entries()) {
    const contenders = indices.filter(idx => !resolvedIdx.has(idx));
    if (!contenders.length) continue;

    if (contenders.length === 1) {
      resolved[contenders[0]] = { ...desired[contenders[0]] };
      continue;
    }

    let winner = contenders[0];
    let bestDist = manhattan(current[winner], state.player);

    for (const idx of contenders.slice(1)) {
      const dist = manhattan(current[idx], state.player);
      if (dist < bestDist || (dist === bestDist && idx < winner)) {
        winner = idx;
        bestDist = dist;
      }
    }

    resolved[winner] = { ...desired[winner] };
  }

  // If an enemy ultimately did not move (due to collisions/swaps), clear its intent lock.
  resolved.forEach((e, i) => {
    if (e.x === current[i].x && e.y === current[i].y) {
      e.intent = null;
      e.intentLock = 0;
    }
  });

  // If any enemy ended on the player tile, force that outcome (prevents swap/collision canceling kills).
  const killer = resolved.find(e => e.x === state.player.x && e.y === state.player.y);
  if (killer) {
    return {
      resolvedMoves: resolved,
      intentTiles: new Set([posKey(killer)])
    };
  }

  return {
    resolvedMoves: resolved,
    intentTiles: new Set(
      desired
        .filter((e, i) => e.x !== current[i].x || e.y !== current[i].y)
        .map(posKey)
    )
  };
}

/* =========================
   TURN / DEATH
========================= */
function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function handleDeath(cause, killer) {
  // Extra life trigger
  if (state.hasExtraLife) {
    state.hasExtraLife = false;

  // Relocate player to safest reachable tile
    const blocked = new Set(state.walls);
    const reachable = reachableTilesFrom(state.player, blocked);

    let best = null;
    let bestScore = -Infinity;

    for (const k of reachable) {
    const [x, y] = k.split(",").map(Number);
    if (state.enemies.some(e => e.x === x && e.y === y)) continue;

    const hypothetical = new Set(state.enemies.map(posKey));
    const escapes = countPlayerEscapeOptions(hypothetical);

    const minDist = Math.min(
      ...state.enemies.map(e => manhattan(e, { x, y }))
      );

    let score = escapes * 10 + minDist;
    if (score > bestScore) {
      bestScore = score;
      best = { x, y };
    }
  }

  if (best) {
    state.player = best;
    updateHud();
    return;
    }
  }

  state.gameOver = true;
  state.inputLocked = true;

  // freeze
  state.effects.freezeUntil = performance.now() + DEATH_FREEZE_MS;
  state.effects.killer = killer ? { x: killer.x, y: killer.y } : null;

  playDeathSound();
  
  setTimeout(() => {
    overlayEl.classList.remove("hidden");
    finalTurnsEl.textContent = `Turns Survived: ${state.turns}`;
    deathCauseEl.textContent = cause;
    finalSeedEl.textContent = `Seed: ${state.seed}`;
    finalModeEl.textContent = `Mode: ${state.seedMode}`;
    state.inputLocked = false;
  }, DEATH_FREEZE_MS);
}

function onTurnAdvanced() {
  spawnPortalIfNeeded();
  updateHud();
}

async function resolveTurnAsync() {

// Enforce enemy movement eventually
if (state.freezeNext) {
  state.freezeNext = false;

  // Skip enemy movement only
  state.turns++;
  onTurnAdvanced();
  state.inputLocked = false;
  return;
}

  state.inputLocked = true;

  const cfg = effectiveCfg;
  await delay(cfg.turnDelay);

  const plan = planEnemyMoves(cfg);

  if (cfg.showIntentFlash) {
    state.effects.intentTiles = plan.intentTiles;
    await delay(INTENT_FLASH_MS);
    state.effects.intentTiles = null;
  }

  state.enemies = plan.resolvedMoves;
  
  // enemy sound (safe)
  if (!state.gameOver && state.enemies.length) playEnemySound();

  // death: enemy on player
  const hit = state.enemies.find(
  e => e.stunned === 0 && e.x === state.player.x && e.y === state.player.y
  );
  if (hit) return handleDeath("Intercepted.", hit);

  // death: no escape
  const enemyKeys = new Set(state.enemies.map(posKey));
  if (!countPlayerEscapeOptions(enemyKeys)) return handleDeath("No escape.", null);

  state.turns++;

  onTurnAdvanced();

  // Turn economy relief valves: every 12 turns grant a token (D -> W -> B cycle)
if (state.turns % 12 === 0) {
  const phase = Math.floor(state.turns / 12) % 3;
  if (phase === 0 && state.tokens.diag === 0) state.tokens.diag = 1;
  if (phase === 1 && state.tokens.wall === 0) state.tokens.wall = 1;
  if (phase === 2 && state.tokens.freeze === 0) state.tokens.freeze = 1;
}

// ✅ Time Freeze earns every 50 turns (max 1 owned)
if (state.turns % 50 === 0 && (state.tokens.timeFreeze ?? 0) === 0) {
  state.tokens.timeFreeze = 1;
}

  if (state.turns > state.best) {
    state.best = state.turns;
    memoryStore.bestScores[bestKey(state.seedMode)] = state.best;
  }

  if (state.turns >= state.nextSpawnTurn) {
    const cap = enemyCountForStage(state.stage);

    if (state.enemies.length < cap) {
      spawnEnemy();
    }

    const interval = Math.max(
      cfg.spawnFloor,
      Math.floor(stateRampSpeed - state.turns / stateRampSpeed)
    );
    state.nextSpawnTurn += interval;
  }

  updateHud();
  state.inputLocked = false;
  state.effects.lastEnemyTurn = state.turns;

}

function payTurnDebtAsync() {
  if (!state || state.gameOver || state.inputLocked) return;
  if (state.turnDebt <= 0) return;

  const debt = state.turnDebt;
  state.turnDebt = 0;

  if (state.payingDebt) return;
state.payingDebt = true;

  (async () => {
   try {
    for (let i = 0; i < debt; i++) {
      if (!state || state.gameOver) return;
      await resolveTurnAsync();

    }
   } catch (err) {
     console.error("Turn debt error:", err);
   } finally {
     state.payingDebt = false;
   }
  })();
}

/* =========================
   MOVEMENT
========================= */
function attemptMove(dx, dy) {
  if (state.gameOver || state.inputLocked) return;
  if (state.holdSpace && state.holdMovesLeft <= 0) return;

  // =========================
  // Phase Step (armed) — replaces normal movement
  // =========================
  if (state.phaseArmed) {
    if (dx !== 0 && dy !== 0) return;

    const first = { x: state.player.x + dx, y: state.player.y + dy };
    const second = { x: first.x + dx, y: first.y + dy };

    // bounds
    if (
      !inBounds(first.x, first.y) ||
      !inBounds(second.x, second.y)
    ) return;

    // walls (both tiles block phase step)
    if (
      state.walls.has(posKey(first)) ||
      state.walls.has(posKey(second))
    ) return;

    // second tile cannot be an enemy (first may be)
    const secondHasEnemy = state.enemies.some(
      e => e.x === second.x && e.y === second.y
    );
    if (secondHasEnemy) return;

    // Freeze enemy passed through (Phase Step safeguard)
    const phasedEnemy = state.enemies.find(
      e => e.x === first.x && e.y === first.y
    );
    if (phasedEnemy) {
      phasedEnemy.stunned = 1;
    }

    // commit movement
    state.player = { x: second.x, y: second.y };
    state.playerTrail.unshift(posKey(state.player));
    state.playerTrail = state.playerTrail.slice(0, 2);

    state.phaseUsed = true;
    state.phaseArmed = false;

    ensureAudio();
    playMoveSound();
    
    if (state.holdSpace) {
      state.holdMovesLeft--;
      state.holdStepsUsed++;
      updateHud();
      state.inputLocked = false;
      return;
    }

    resolveTurnAsync();
    return;
  }

  // =========================
  // Normal movement
  // =========================
  const nx = state.player.x + dx;
  const ny = state.player.y + dy;
  if (!inBounds(nx, ny)) return;

  const k = `${nx},${ny}`;

  // Wall Ignore token: bypass exactly one wall
  if (state.walls.has(k)) {
    if (state.wallIgnoreArmed) {
      state.wallIgnoreArmed = false;
    } else {
      return;
    }
  }
  
  // Diagonal wall cutting prevention (normal movement only)
  if (dx !== 0 && dy !== 0) {
    const a = posKey({ x: state.player.x + dx, y: state.player.y });
    const b = posKey({ x: state.player.x, y: state.player.y + dy });
    if (state.walls.has(a) || state.walls.has(b)) return;
  }
  
  state.player = { x: nx, y: ny };
  state.playerTrail.unshift(k);
  state.playerTrail = state.playerTrail.slice(0, 2);

  // =========================
  // Portal entry → advance stage
  // =========================
  if (state.portal && nx === state.portal.x && ny === state.portal.y) {
    advanceStage();
    return;
  }

  // stepped onto enemy
  const stepped = state.enemies.find(e => e.x === nx && e.y === ny);
  if (stepped) return handleDeath("Intercepted.", stepped);

  ensureAudio();
  playMoveSound();
  
  if (state.holdSpace) {
    state.holdMovesLeft--;
    state.holdStepsUsed++;
    updateHud();
    state.inputLocked = false;
    return;
  }

  resolveTurnAsync();
}

/* =========================
   DRAWING
========================= */
function drawWalls() {
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#5a5a5a";
  for (const k of state.walls) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(x * CELL_SIZE + 4, y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  }
}

function drawPortal() {
  if (!state.portal) return;

  ctx.save();
  ctx.globalAlpha = 1;

  const px = state.portal.x * CELL_SIZE + 4;
  const py = state.portal.y * CELL_SIZE + 4;
  const size = CELL_SIZE - 8;

  // Base tile (black void)
  ctx.fillStyle = "#000";
  ctx.fillRect(px, py, size, size);

  // Soft white halo
  ctx.globalAlpha = 0.8;
  ctx.shadowColor = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, size - 2, size - 2);

  ctx.restore();
}

function drawTile(px, py, size, baseColor, shadow = true) {
  ctx.save();

  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
  }

  ctx.fillStyle = baseColor;
  ctx.fillRect(px, py, size, size);

  // subtle edge bevel (not shiny)
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);

  ctx.restore();
}

function drawEnemies() {
  // (per-enemy phase used below)
  for (const e of state.enemies) {
    ctx.save();
    ctx.globalAlpha = 1;

    if (e.stunned > 0) {
      ctx.globalAlpha = 0.6;        // ← ADD (stunned dim)
    }
  
    const px = e.x * CELL_SIZE + 4;
    const py = e.y * CELL_SIZE + 4;
    const size = CELL_SIZE - 8;
    const phase = pulsePhaseOffset(e.phase || 0);

    drawTile(px, py, size, e.stunned > 0 ? "#6aaeff" : "#c43636");

    const strength = enemyPulseStrength(e); // 1.0 at dist=1, 0.45 at dist=2, else 0
  if (strength > 0) {
  ctx.save();

  // soft glow (breathing)
  ctx.globalAlpha = 0.55 * strength;
  ctx.shadowColor = `rgba(255, 107, 107, ${0.55 * strength})`;
  ctx.shadowBlur = 10 + 26 * phase * strength;

  // glow body slightly larger
  ctx.fillStyle = "#ff4d4d";
  ctx.fillRect(
    e.x * CELL_SIZE + 3,
    e.y * CELL_SIZE + 3,
    CELL_SIZE - 6,
    CELL_SIZE - 6
  );

  // inner “hot core”
  ctx.globalAlpha = (0.35 + 0.65 * phase) * strength;
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#ffb3b3";
  const inset = 9 - 4 * phase; // breath in/out
  ctx.fillRect(
    e.x * CELL_SIZE + inset,
    e.y * CELL_SIZE + inset,
    CELL_SIZE - inset * 2,
    CELL_SIZE - inset * 2
  );

  // outline pulse
  ctx.globalAlpha = (0.35 + 0.65 * phase) * strength;
  ctx.strokeStyle = "#ffd1d1";
  ctx.lineWidth = 2 + 3 * phase * strength;
  ctx.strokeRect(
    e.x * CELL_SIZE + 5,
    e.y * CELL_SIZE + 5,
    CELL_SIZE - 10,
    CELL_SIZE - 10
  );

  ctx.restore();
 }
 }
}

function drawPlayer() {
  const now = performance.now();
  const fx = state.effects.stageFx;

  if (fx) {
    const p = Math.min(1, (now - fx.startMs) / fx.durationMs);
    const size = CELL_SIZE - 8;
    const px = fx.x * CELL_SIZE + 4;
    const py = fx.y * CELL_SIZE + 4;
    const cx = px + size / 2;
    const cy = py + size / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p * Math.PI * 8);
    ctx.translate(-cx, -cy);

    const grid = 8;
    const cell = size / grid;
    const keepRatio = 1 - p;

    function cellRand(i) {
      const n = (i * 2654435761) >>> 0;
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }

    let idx = 0;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++, idx++) {
        if (cellRand(idx) > keepRatio) continue;
        ctx.fillStyle = "#3a7bd5";
        ctx.fillRect(
          px + x * cell,
          py + y * cell,
          cell,
          cell
        );
      }
    }

    ctx.restore();

    if (p >= 1) state.effects.stageFx = null;
    return;
  }
  
  const size = CELL_SIZE - 8;
  const px = state.player.x * CELL_SIZE + 4;
  const py = state.player.y * CELL_SIZE + 4;

  drawTile(px, py, size, "#3a7bd5");
  drawMovingSquareHalo(px, py, size);
}

function drawMovingSquareHalo(px, py, size) {
  const t = playerHaloPhase() * 4;
  const perimeter = size * 4;
  const segmentLength = size * 0.6;   // how much of the edge is lit
  const offset = (t * perimeter) % perimeter;

  // subtle pulse (alive, not cartoony)
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.004);

  ctx.save();

  ctx.strokeStyle = `rgba(120,180,255,${0.75 + 0.25 * pulse})`;
  ctx.lineWidth = 3 + pulse * 1.5;
  ctx.shadowColor = "rgba(120,180,255,0.6)";
  ctx.shadowBlur = 8 + pulse * 6;
  ctx.lineCap = "round";

  ctx.beginPath();

  let remaining = segmentLength;
  let d = offset;

  while (remaining > 0) {
    if (d < size) {
      // top edge
      const len = Math.min(size - d, remaining);
      ctx.moveTo(px + d, py);
      ctx.lineTo(px + d + len, py);
      remaining -= len;
      d += len;
    } else if (d < size * 2) {
      // right edge
      const dd = d - size;
      const len = Math.min(size - dd, remaining);
      ctx.moveTo(px + size, py + dd);
      ctx.lineTo(px + size, py + dd + len);
      remaining -= len;
      d += len;
    } else if (d < size * 3) {
      // bottom edge
      const dd = d - size * 2;
      const len = Math.min(size - dd, remaining);
      ctx.moveTo(px + size - dd, py + size);
      ctx.lineTo(px + size - dd - len, py + size);
      remaining -= len;
      d += len;
    } else {
      // left edge
      const dd = d - size * 3;
      const len = Math.min(size - dd, remaining);
      ctx.moveTo(px, py + size - dd);
      ctx.lineTo(px, py + size - dd - len);
      remaining -= len;
      d += len;
    }

    if (d >= perimeter) d -= perimeter;
  }

  ctx.stroke();
  ctx.restore();
}

function drawIntentTiles() {
  const cfg = effectiveCfg;
  if (!state.effects.intentTiles || !cfg.showIntentFlash) return;

  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(200,50,50,0.25)";
  for (const k of state.effects.intentTiles) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillRect(x * CELL_SIZE + 4, y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  }
}

function render() {
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawWalls();
  drawPortal();
  drawIntentTiles();
  drawEnemies();
  drawPlayer();
  
  if (stageBannerEl && state?.effects?.stageBannerUntil) {
    if (performance.now() > state.effects.stageBannerUntil) {
      stageBannerEl.classList.add("hidden");
    }
  }

  // killer highlight during freeze
  if (state.effects.freezeUntil && performance.now() < state.effects.freezeUntil && state.effects.killer) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#ff6b6b";
    ctx.fillRect(
      state.effects.killer.x * CELL_SIZE + 2,
      state.effects.killer.y * CELL_SIZE + 2,
      CELL_SIZE - 4,
      CELL_SIZE - 4
    );
  }

 // danger label = adjacency boolean
const dangerNow = state.enemies.some(isEnemyNear);

const hudEl = document.getElementById("hud");

if (effectiveCfg.dangerFeedback) {
  hudEl.classList.toggle("danger", dangerNow);
} else {
  hudEl.classList.remove("danger");
}

}

/* =========================
   INPUT
========================= */
function handleKeyDown(e) {
  if (!state) return;
 
  const key = e.key.toLowerCase();
  const now = performance.now();

  // ESC to close settings modal
  if (key === "escape" && !settingsEl.classList.contains("hidden")) {
    closeSettings();
    return;
 }

  const blockedKeys = [
  "arrowup", "arrowdown", "arrowleft", "arrowright",
  "w", "a", "s", "d", " ", "escape",
  "1", "2", "3", "r", "n", "m", "x", "y"
];

if (blockedKeys.includes(key)) {
  e.preventDefault();
}

  if (key === "x") {
    openSettings();
    return;
}

if (key === "y") {
  overlayEl.classList.add("hidden");
  applySettings();
  initState({ seed: Math.floor(Date.now() / 86400000), seedMode: "DAILY" });
  return;
}

// difficulty hotkeys (always allowed)
  if (key === "1") return setDifficulty("standard");
  if (key === "2") return setDifficulty("hard");
  if (key === "3") return setDifficulty("hardcore");
  
  if (key === "r") return replaySeed();
  if (key === "n") return newRunSameDifficulty();
  if (key === "m") return manualSeedRun();

  if (state.gameOver || state.inputLocked) return;
  
  // Reward cooldown feedback (only for reward-related keys)
  if (
    now < state.rewardCooldownUntil &&
    ["q","e","z","c","v","b","f", " "].includes(key)
  ) {
    showCooldownStatus(now);
    return;
  }

// Diagonal move token (single-use, max 1 owned, global cooldown on use)
if (state.tokens.diag > 0 && now >= state.rewardCooldownUntil) {
  if (key === "q") {
    state.tokens.diag = 0;
    state.rewardCooldownUntil = now + 30000;
    updateHud();
    return attemptMove(-1, -1);
  }
  if (key === "e") {
    state.tokens.diag = 0;
    state.rewardCooldownUntil = now + 30000;
    updateHud();
    return attemptMove(1, -1);
  }
  if (key === "z") {
    state.tokens.diag = 0;
    state.rewardCooldownUntil = now + 30000;
    updateHud();
    return attemptMove(-1, 1);
  }
  if (key === "c") {
    state.tokens.diag = 0;
    state.rewardCooldownUntil = now + 30000;
    updateHud();
    return attemptMove(1, 1);
  }
}

// Wall Ignore token: arm for next move (max 1 owned, global cooldown on use)
if (
  key === "v" &&
  state.tokens.wall > 0 &&
  !state.wallIgnoreArmed &&
  now >= state.rewardCooldownUntil
) {
  state.tokens.wall = 0;
  state.wallIgnoreArmed = true;
  state.rewardCooldownUntil = now + 30000;
  updateHud();
  return;
}

if (e.key === " " && e.repeat) return;
if (
  key === "b" && 
  state.tokens.freeze > 0 && 
  !state.holdSpace &&
  performance.now() >= state.rewardCooldownUntil
) {
  if (state.effects.lastEnemyTurn === state.turns) return;
  state.tokens.freeze = 0;
  state.freezeNext = true;
  state.rewardCooldownUntil = performance.now() + 30000;
  updateHud();
  return;
}

 // Optional: spend 5 turns to delay the next spawn
  if (key === "p") {
    if (state.turns >= 5) {
      state.turns -= 5;
      state.nextSpawnTurn += 5;
      updateHud();
  }
    return;
  }

 // Phase Step: press F to arm, next move becomes a dash (global cooldown on use)
  if (
    key === "f" &&
    !state.phaseUsed &&
    !state.phaseArmed &&
    now >= state.rewardCooldownUntil
  ) {
    state.phaseArmed = true;
    state.rewardCooldownUntil = now + 30000;
    updateHud();
    return;
  }

  if (key === "w" || key === "arrowup") return attemptMove(0, -1);
  if (key === "s" || key === "arrowdown") return attemptMove(0, 1);
  if (key === "a" || key === "arrowleft") return attemptMove(-1, 0);
  if (key === "d" || key === "arrowright") return attemptMove(1, 0);

 if (e.key === " ") {
  if (e.repeat) return;                 // ✅ EXACT placement (prevents reset spam)
  if (state.holdSpace) return;          // already active
  if ((state.tokens.timeFreeze ?? 0) <= 0) return; // must be earned

  // Consume the earned Time Freeze
  state.tokens.timeFreeze = 0;

  // Respect global reward cooldown
  state.rewardCooldownUntil = now + 30000;

  // Start “hold space” mode (freeze enemies, allow up to 2 moves)
  state.holdSpace = true;
  state.holdMovesLeft = 2;
  state.holdStepsUsed = 0;

  updateHud(); // show TF immediately
  return;
 }

}

function handleKeyUp(e) {
  if (e.key === " ") {
    
    // Release “hold space”; if you used it, pay +1 enemy-turn debt
    if (state && state.holdSpace) {
      state.holdSpace = false;

    if (state.holdStepsUsed > 0) {
      state.turnDebt += 1;

     // Ensure at least one enemy turn is scheduled
     if (!state.inputLocked) {
      payTurnDebtAsync();
     } else {
     // Force-unlock and resolve exactly once
     state.inputLocked = false;
     payTurnDebtAsync();
    }
}
 
      state.holdMovesLeft = 2;
      state.holdStepsUsed = 0;

      updateHud();
    }

  }
}

/* =========================
   INIT
========================= */
function initPreferences() {
  const saved = memoryStore.difficulty;
  if (saved && BASE_DIFFICULTY_CONFIG[saved]) difficulty = saved;
  muted = memoryStore.muted;
}

function openSettings() {
  if (state && !state.gameOver) {
   // Optional: flash HUD or show brief message
   return;
}
  const s = loadTuning();
  settingsEl.classList.remove("hidden");

  document.getElementById("settings-profile").textContent = difficulty.toUpperCase();
  
  wallCountInput.value = WALL_COUNT;
  document.getElementById("set-wallCountNum").value = WALL_COUNT;
  enemyCountInput.value = INITIAL_ENEMIES;
  document.getElementById("set-initialEnemiesNum").value = INITIAL_ENEMIES;
 
  initialSpawnInput.value = s.initialSpawn;
  document.getElementById("set-initialSpawnNum").value = s.initialSpawn;
  rampSpeedInput.value = s.rampSpeed;
  document.getElementById("set-rampSpeedNum").value = s.rampSpeed;
  escapePenaltyInput.value = s.escapePenalty;
  document.getElementById("set-escapePenaltyNum").value = s.escapePenalty;
  gapFillInput.value = s.gapFillBonus;
  document.getElementById("set-gapFillNum").value = s.gapFillBonus;
}

function closeSettings() {
  settingsEl.classList.add("hidden");
}

function persistSettingsFromUI() {
  const next = {
    version: SETTINGS_VERSION,

    walls: Number(wallCountInput.value),
    initialEnemies: Number(enemyCountInput.value),

    initialSpawn: Number(initialSpawnInput.value),
    rampSpeed: Number(rampSpeedInput.value),
    escapePenalty: Number(escapePenaltyInput.value),
    gapFillBonus: Number(gapFillInput.value),
                                                                     };

  saveTuning(next);
  closeSettings();
}

function resetSettings() {
  delete memoryStore.settings[tuningKey()];
  location.reload();
}

function initState({ seed, seedMode }) {
  rng = mulberry32(seed);

  state = {
  player: { x: 5, y: 5 },
  walls: new Set(),          // temporary, immediately replaced
  enemies: [],
  turns: 0,
  best: Number(memoryStore.bestScores[bestKey(seedMode)] || 0),
  nextSpawnTurn: Math.max(1, stateSpawnInitial),
  gameOver: false,
  inputLocked: false,
  holdSpace: false,
  holdMovesLeft: 2,
  holdStepsUsed: 0,
  playerTrail: [],
  stage: 1,
  portal: null,
  nextPortalAtTurn: computeNextPortalTurn(1, 0),
  hasExtraLife: false,
  rewardCooldownUntil: 0,
  phaseUsed: false,
  phaseArmed: false,
  tokens: { diag: 0, wall: 0, freeze: 0, timeFreeze: 0 },
  freezeNext: false,
  wallIgnoreArmed: false,
  payingDebt: false,
  turnDebt: 0,
  seed,
  seedMode,
  effects: {
    intentTiles: null,
    freezeUntil: 0,
    killer: null,
    lastEnemyTurn: -1,
    stageFx: null,
    stageBannerUntil: 0,
    statusUntil: 0,
    statusText:
      seedMode === "NEW" ? "NEW SEED" :
      seedMode === "REPLAY" ? "REPLAYING SEED" : "",
  },
};
  
  state.walls = buildWallsCount(WALL_COUNT);

  const spawnCount = Math.max(0, Math.min(INITIAL_ENEMIES, GRID_SIZE * 2));
    for (let i = 0; i < spawnCount; i++) spawnEnemy();
    
  overlayEl.classList.add("hidden");
  updateHud();
  render();

  if (!animationRunning) {
    animationRunning = true;
    requestAnimationFrame(animationLoop);
  }
}

function replaySeed() {
  if (!state) return;
  applySettings();
  overlayEl.classList.add("hidden");
  initState({ seed: state.seed, seedMode: "REPLAY" });
}

function newRunSameDifficulty() {
  overlayEl.classList.add("hidden");
  applySettings();
  initState({ seed: randomSeed(), seedMode: "NEW" });
}

function manualSeedRun() {
  const input = prompt("Enter seed (number):");
  if (!input) return;

  const seed = Number(input);
  if (!Number.isInteger(seed)) {
    alert("Invalid seed.");
    return;
  }

  overlayEl.classList.add("hidden");
  applySettings();
  initState({ seed, seedMode: "MANUAL" });
}

let animationRunning = false;

function animationLoop() {
  if (!state || state.gameOver) {
    animationRunning = false;
    return;
  }

  render();
  requestAnimationFrame(animationLoop);
}

function boot() {
  initPreferences();
  applySettings();

  // =========================
  // Wire settings sliders (UI only)
  // =========================
  for (const [sliderId, numberId] of SLIDER_PAIRS) {
    const slider = document.getElementById(sliderId);
    const number = document.getElementById(numberId);
    if (slider && number) {
      bindSlider(slider, number);
    }
  }

  initState({ seed: randomSeed(), seedMode: "RUN" });
  canvas.focus();
  canvas.addEventListener("click", () => canvas.focus());
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
settingsBackEl.addEventListener("click", closeSettings);
settingsSaveEl.addEventListener("click", persistSettingsFromUI);
settingsResetEl.addEventListener("click", resetSettings);

boot();
