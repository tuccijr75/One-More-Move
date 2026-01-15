const GRID_SIZE = 10;
const CELL_SIZE = 60;
const WALL_COUNT = 10;
const INITIAL_ENEMIES = 2;
const INTENT_FLASH_MS = 100;
const PULSE_DURATION_MS = 100;
const DEATH_FREEZE_MS = 280;
const NO_MARGIN_MS = 300;
const STATUS_MS = 1200;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const turnsEl = document.getElementById("turns");
const bestEl = document.getElementById("best");
const difficultyEl = document.getElementById("difficulty");
const seedEl = document.getElementById("seed");
const modeEl = document.getElementById("mode");
const noMarginEl = document.getElementById("no-margin");
const statusEl = document.getElementById("status");
const overlayEl = document.getElementById("overlay");
const finalTurnsEl = document.getElementById("final-turns");
const deathCauseEl = document.getElementById("death-cause");
const finalSeedEl = document.getElementById("final-seed");
const finalModeEl = document.getElementById("final-mode");

let rng = null;
let state = null;
let showForecast = false;
let difficulty = "standard";
let muted = false;
let audioContext = null;

const DIFFICULTY_CONFIG = {
  standard: {
    turnDelay: 150,
    showIntentFlash: true,
    showForecast: true,
    escapePenalty: 1.5,
    gapFillBonus: 3.0,
    spawnFloor: 3,
    dangerFeedback: true,
  },
  hard: {
    turnDelay: 120,
    showIntentFlash: true,
    showForecast: true,
    escapePenalty: 2.0,
    gapFillBonus: 3.5,
    spawnFloor: 3,
    dangerFeedback: true,
  },
  hardcore: {
    turnDelay: 80,
    showIntentFlash: false,
    showForecast: false,
    escapePenalty: 2.5,
    gapFillBonus: 4.0,
    spawnFloor: 2,
    dangerFeedback: false,
  },
};

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashToSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dailySeed() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  return hashToSeed(date);
}

function randomSeed() {
  if (window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0];
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function randInt(max) {
  return Math.floor(rng() * max);
}

function posKey(pos) {
  return `${pos.x},${pos.y}`;
}

function inBounds(x, y) {
  return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function getNeighbors(pos) {
  return [
    { x: pos.x, y: pos.y - 1 },
    { x: pos.x, y: pos.y + 1 },
    { x: pos.x - 1, y: pos.y },
    { x: pos.x + 1, y: pos.y },
  ];
}

function buildWalls() {
  const walls = new Set();
  while (walls.size < WALL_COUNT) {
    const x = randInt(GRID_SIZE);
    const y = randInt(GRID_SIZE);
    if (x === 5 && y === 5) {
      continue;
    }
    walls.add(`${x},${y}`);
  }
  return walls;
}

function isEdgeTile(pos) {
  return pos.x === 0 || pos.x === GRID_SIZE - 1 || pos.y === 0 || pos.y === GRID_SIZE - 1;
}

function isAdjacent(a, b) {
  return manhattan(a, b) <= 1;
}

function getOppositeEdgeCandidates(player) {
  const candidates = new Set();
  const preferRight = player.x < GRID_SIZE / 2;
  const preferLeft = player.x >= GRID_SIZE / 2;
  const preferBottom = player.y < GRID_SIZE / 2;
  const preferTop = player.y >= GRID_SIZE / 2;

  if (preferRight) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      candidates.add(`9,${y}`);
    }
  }
  if (preferLeft) {
    for (let y = 0; y < GRID_SIZE; y += 1) {
      candidates.add(`0,${y}`);
    }
  }
  if (preferBottom) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      candidates.add(`${x},9`);
    }
  }
  if (preferTop) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      candidates.add(`${x},0`);
    }
  }

  return candidates;
}

function getSafeSpawnTiles() {
  const tiles = [];
  const player = state.player;
  const enemyPositions = new Set(state.enemies.map(posKey));
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const key = `${x},${y}`;
      if (!isEdgeTile({ x, y })) {
        continue;
      }
      if (state.walls.has(key)) {
        continue;
      }
      if (enemyPositions.has(key)) {
        continue;
      }
      if (player.x === x && player.y === y) {
        continue;
      }
      const candidate = { x, y };
      if (isAdjacent(candidate, player)) {
        continue;
      }
      let adjacentEnemy = false;
      for (const enemy of state.enemies) {
        if (isAdjacent(candidate, enemy)) {
          adjacentEnemy = true;
          break;
        }
      }
      if (adjacentEnemy) {
        continue;
      }
      tiles.push(candidate);
    }
  }
  return tiles;
}

function pickSpawnTile() {
  const safeTiles = getSafeSpawnTiles();
  if (safeTiles.length === 0) {
    return null;
  }
  const preferredKeys = getOppositeEdgeCandidates(state.player);
  const preferred = safeTiles.filter((tile) => preferredKeys.has(posKey(tile)));
  const pool = preferred.length > 0 ? preferred : safeTiles;
  return pool[randInt(pool.length)];
}

function spawnEnemy() {
  const tile = pickSpawnTile();
  if (!tile) {
    return false;
  }
  state.enemies.push(tile);
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureAudio() {
  if (audioContext || muted) {
    return;
  }
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch (error) {
    audioContext = null;
  }
}

function playTone({ frequency, duration, type, gain }) {
  if (!audioContext || muted) {
    return;
  }
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.value = gain;
  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playMoveSound() {
  playTone({ frequency: 480, duration: 0.05, type: "triangle", gain: 0.06 });
}

function playEnemySound() {
  playTone({ frequency: 140, duration: 0.08, type: "sine", gain: 0.08 });
}

function playDeathSound() {
  playTone({ frequency: 80, duration: 0.18, type: "sawtooth", gain: 0.1 });
}

function bestKey(seedMode) {
  return `one-more-move-best-${difficulty}-${seedMode}`;
}

function setDifficulty(nextDifficulty) {
  difficulty = nextDifficulty;
  localStorage.setItem("one-more-move-difficulty", difficulty);
  if (!DIFFICULTY_CONFIG[difficulty].showForecast) {
    showForecast = false;
  }
  state.best = Number(localStorage.getItem(bestKey(state.seedMode)) || 0);
  updateHud();
  render();
}

function setMuted(nextValue) {
  muted = nextValue;
  localStorage.setItem("one-more-move-muted", muted ? "1" : "0");
  setStatus(muted ? "Muted" : "Sound On");
}

function setStatus(message) {
  state.effects.statusText = message;
  state.effects.statusUntil = performance.now() + STATUS_MS;
  render();
}

function updateHud() {
  turnsEl.textContent = `Turns: ${state.turns}`;
  bestEl.textContent = `Best: ${state.best}`;
  difficultyEl.textContent = `Difficulty: ${difficulty.toUpperCase()}`;
  seedEl.textContent = `Seed: ${state.seed}`;
  modeEl.textContent = `Mode: ${state.seedMode}`;
}

function countPlayerEscapeOptions(enemyPositions) {
  let count = 0;
  for (const neighbor of getNeighbors(state.player)) {
    const key = posKey(neighbor);
    if (!inBounds(neighbor.x, neighbor.y)) {
      continue;
    }
    if (state.walls.has(key)) {
      continue;
    }
    if (enemyPositions.has(key)) {
      continue;
    }
    count += 1;
  }
  return count;
}

function scoreEnemyMove(enemyIndex, target, config) {
  const enemyPositions = new Set(state.enemies.map(posKey));
  enemyPositions.delete(posKey(state.enemies[enemyIndex]));
  enemyPositions.add(posKey(target));

  const distanceScore = -manhattan(target, state.player);
  const escapeOptions = countPlayerEscapeOptions(enemyPositions);
  const escapePenalty = config.escapePenalty * escapeOptions;

  let gapBonus = 0;
  const isAdjacentToPlayer = manhattan(target, state.player) === 1;
  const targetKey = posKey(target);
  const isBlank =
    !state.walls.has(targetKey) &&
    !state.enemies.some((enemy, index) => index !== enemyIndex && posKey(enemy) === targetKey) &&
    !(state.player.x === target.x && state.player.y === target.y);
  if (isAdjacentToPlayer && isBlank) {
    gapBonus = config.gapFillBonus;
  }

  return distanceScore - escapePenalty + gapBonus;
}

function planEnemyMoves(config) {
  const currentPositions = state.enemies.map((enemy) => ({ ...enemy }));
  const desired = [];
  const plans = [];

  currentPositions.forEach((enemy, index) => {
    const candidates = getNeighbors(enemy)
      .filter((tile) => inBounds(tile.x, tile.y))
      .filter((tile) => !state.walls.has(posKey(tile)));

    if (candidates.length === 0) {
      desired.push({ ...enemy });
      plans.push({ from: { ...enemy }, to: { ...enemy }, score: -Infinity });
      return;
    }

    let best = null;
    let bestScore = -Infinity;
    let bestDistance = Infinity;

    for (const tile of candidates) {
      const score = scoreEnemyMove(index, tile, config);
      const dist = manhattan(tile, state.player);
      if (score > bestScore || (score === bestScore && dist < bestDistance)) {
        best = tile;
        bestScore = score;
        bestDistance = dist;
      }
    }

    const chosen = best ? { ...best } : { ...enemy };
    desired.push(chosen);
    plans.push({ from: { ...enemy }, to: { ...chosen }, score: bestScore });
  });

  const origins = currentPositions.map((pos) => ({ ...pos }));
  desired.forEach((target, index) => {
    origins.forEach((origin, originIndex) => {
      if (index === originIndex) {
        return;
      }
      const originKey = posKey(origin);
      if (posKey(target) === originKey && posKey(desired[originIndex]) === originKey) {
        desired[index] = { ...origins[index] };
      }
    });
  });

  const destinationMap = new Map();
  desired.forEach((tile, index) => {
    const key = posKey(tile);
    if (!destinationMap.has(key)) {
      destinationMap.set(key, []);
    }
    destinationMap.get(key).push(index);
  });

  const resolved = currentPositions.map((enemy) => ({ ...enemy }));
  const resolvedIndices = new Set();

  for (let i = 0; i < desired.length; i += 1) {
    if (resolvedIndices.has(i)) {
      continue;
    }
    for (let j = i + 1; j < desired.length; j += 1) {
      if (resolvedIndices.has(j)) {
        continue;
      }
      const swapA = posKey(desired[i]) === posKey(currentPositions[j]);
      const swapB = posKey(desired[j]) === posKey(currentPositions[i]);
      if (swapA && swapB) {
        const keyA = posKey(desired[i]);
        const keyB = posKey(desired[j]);
        const targetsA = destinationMap.get(keyA) || [];
        const targetsB = destinationMap.get(keyB) || [];
        if (targetsA.length === 1 && targetsB.length === 1) {
          resolved[i] = { ...desired[i] };
          resolved[j] = { ...desired[j] };
          resolvedIndices.add(i);
          resolvedIndices.add(j);
        }
      }
    }
  }

  for (const [key, indices] of destinationMap.entries()) {
    const contenders = indices.filter((index) => !resolvedIndices.has(index));
    if (contenders.length === 0) {
      continue;
    }
    if (contenders.length === 1) {
      const idx = contenders[0];
      resolved[idx] = { ...desired[idx] };
      continue;
    }

    let winningIndex = contenders[0];
    let bestDistance = manhattan(currentPositions[winningIndex], state.player);
    for (const idx of contenders.slice(1)) {
      const dist = manhattan(currentPositions[idx], state.player);
      if (dist < bestDistance || (dist === bestDistance && idx < winningIndex)) {
        winningIndex = idx;
        bestDistance = dist;
      }
    }

    resolved[winningIndex] = { ...desired[winningIndex] };
  }

  const intentTiles = new Set(desired.map(posKey));

  return {
    plans,
    resolvedMoves: resolved,
    intentTiles,
    desiredMoves: desired,
  };
}

function triggerDangerPulse() {
  if (!DIFFICULTY_CONFIG[difficulty].dangerFeedback) {
    return;
  }
  scoreEl.classList.remove("danger-pulse");
  void scoreEl.offsetWidth;
  scoreEl.classList.add("danger-pulse");
  state.effects.noMarginUntil = performance.now() + NO_MARGIN_MS;
}

function handleDeath(cause, killerPos) {
  state.gameOver = true;
  state.inputLocked = true;
  state.effects.freezeUntil = performance.now() + DEATH_FREEZE_MS;
  state.effects.killerPos = killerPos;
  state.effects.overlayVisible = false;
  state.deathCause = cause;
  playDeathSound();
  render();
  setTimeout(() => {
    state.effects.overlayVisible = true;
    overlayEl.classList.remove("hidden");
    finalTurnsEl.textContent = `Turns Survived: ${state.turns}`;
    deathCauseEl.textContent = state.deathCause;
    finalSeedEl.textContent = `Seed: ${state.seed}`;
    finalModeEl.textContent = `Mode: ${state.seedMode}`;
    state.inputLocked = false;
  }, DEATH_FREEZE_MS);
}

async function resolveTurnAsync() {
  state.inputLocked = true;
  const config = DIFFICULTY_CONFIG[difficulty];
  await delay(config.turnDelay);

  const plan = planEnemyMoves(config);
  if (config.showIntentFlash) {
    state.effects.intentTiles = plan.intentTiles;
    render();
    await delay(INTENT_FLASH_MS);
    state.effects.intentTiles = null;
  }

  state.enemies = plan.resolvedMoves;
  playEnemySound();

  const enemyOnPlayer = state.enemies.find(
    (enemy) => enemy.x === state.player.x && enemy.y === state.player.y
  );
  if (enemyOnPlayer) {
    handleDeath("Intercepted.", { ...enemyOnPlayer });
    return;
  }

  const escapeOptions = countPlayerEscapeOptions(new Set(state.enemies.map(posKey)));
  if (config.dangerFeedback) {
    const lastOptions = state.lastEscapeOptions ?? escapeOptions;
    if (escapeOptions === 1 && lastOptions >= 2) {
      triggerDangerPulse();
    }
    state.lastEscapeOptions = escapeOptions;
  }

  if (escapeOptions === 0) {
    handleDeath("No escape.", null);
    return;
  }

  state.turns += 1;
  if (state.turns > state.best) {
    state.best = state.turns;
    localStorage.setItem(bestKey(state.seedMode), String(state.best));
  }

  if (state.turns >= state.nextSpawnTurn) {
    spawnEnemy();
    const interval = Math.max(config.spawnFloor, Math.floor(10 - state.turns / 15));
    state.nextSpawnTurn += interval;
  }

  state.pulseUntil = performance.now() + PULSE_DURATION_MS;
  updateHud();
  render();
  setTimeout(() => {
    render();
  }, PULSE_DURATION_MS);
  state.inputLocked = false;
}

function initState({ seed, seedMode }) {
  rng = mulberry32(seed);
  const player = { x: 5, y: 5 };
  const config = DIFFICULTY_CONFIG[difficulty];
  state = {
    player,
    walls: buildWalls(),
    enemies: [],
    turns: 0,
    best: Number(localStorage.getItem(bestKey(seedMode)) || 0),
    nextSpawnTurn: 10,
    gameOver: false,
    inputLocked: false,
    pulseUntil: 0,
    seed,
    seedMode,
    deathCause: "",
    lastEscapeOptions: null,
    effects: {
      intentTiles: null,
      noMarginUntil: 0,
      statusUntil: 0,
      statusText: "",
      freezeUntil: 0,
      killerPos: null,
      overlayVisible: false,
    },
  };

  for (let i = 0; i < INITIAL_ENEMIES; i += 1) {
    spawnEnemy();
  }

  showForecast = config.showForecast ? showForecast : false;
  overlayEl.classList.add("hidden");
  updateHud();
  render();
}

function startRun({ mode, replay }) {
  const seedMode = mode;
  let seed = state?.seed ?? 0;
  if (seedMode === "DAILY") {
    seed = dailySeed();
  } else if (replay && state?.seed) {
    seed = state.seed;
  } else {
    seed = randomSeed();
  }
  initState({ seed, seedMode });
}

function attemptMove(dx, dy) {
  if (state.gameOver || state.inputLocked) {
    return;
  }

  const target = { x: state.player.x + dx, y: state.player.y + dy };
  if (!inBounds(target.x, target.y)) {
    return;
  }
  if (state.walls.has(posKey(target))) {
    return;
  }

  state.player = target;
  const steppedEnemy = state.enemies.find(
    (enemy) => enemy.x === target.x && enemy.y === target.y
  );
  if (steppedEnemy) {
    handleDeath("Intercepted.", { ...steppedEnemy });
    return;
  }

  ensureAudio();
  playMoveSound();
  state.lastEscapeOptions = countPlayerEscapeOptions(new Set(state.enemies.map(posKey)));
  render();
  resolveTurnAsync();
}

function copySeed() {
  const text = `Seed: ${state.seed} | Mode: ${state.seedMode}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => setStatus("Seed copied"))
      .catch(() => setStatus("Copy failed"));
  } else {
    setStatus("Copy failed");
  }
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }

  if ((state.effects.overlayVisible || state.turns === 0) && ["1", "2", "3"].includes(key)) {
    if (key === "1") {
      setDifficulty("standard");
    }
    if (key === "2") {
      setDifficulty("hard");
    }
    if (key === "3") {
      setDifficulty("hardcore");
    }
    return;
  }

  if (key === "m") {
    ensureAudio();
    setMuted(!muted);
    return;
  }

  if (key === "q") {
    if (window.electronAPI && window.electronAPI.quit) {
      window.electronAPI.quit();
    }
    return;
  }

  if (key === "c") {
    copySeed();
    return;
  }

  if (key === "t") {
    startRun({ mode: state.seedMode, replay: true });
    return;
  }

  if (key === "d") {
    const nextMode = state.seedMode === "DAILY" ? "RUN" : "DAILY";
    startRun({ mode: nextMode, replay: false });
    return;
  }

  if (key === "r" && !state.inputLocked) {
    startRun({ mode: state.seedMode, replay: false });
    return;
  }

  if (event.key === " " && DIFFICULTY_CONFIG[difficulty].showForecast) {
    showForecast = true;
    render();
    return;
  }

  if (event.key === " " && !DIFFICULTY_CONFIG[difficulty].showForecast) {
    setStatus("Forecast disabled in Hardcore");
    return;
  }

  switch (key) {
    case "arrowup":
    case "w":
      attemptMove(0, -1);
      break;
    case "arrowdown":
    case "s":
      attemptMove(0, 1);
      break;
    case "arrowleft":
    case "a":
      attemptMove(-1, 0);
      break;
    case "arrowright":
    case "d":
      attemptMove(1, 0);
      break;
    default:
      break;
  }
}

function handleKeyUp(event) {
  if (event.key === " ") {
    showForecast = false;
    render();
  }
}

function drawGrid() {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#1b1b1b";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_SIZE; i += 1) {
    const offset = i * CELL_SIZE;
    ctx.beginPath();
    ctx.moveTo(offset, 0);
    ctx.lineTo(offset, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, offset);
    ctx.lineTo(canvas.width, offset);
    ctx.stroke();
  }
}

function drawSquares(positions, color, alpha = 1) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  positions.forEach((pos) => {
    ctx.fillRect(pos.x * CELL_SIZE + 4, pos.y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
  });
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const now = performance.now();
  const scale = now < state.pulseUntil ? 0.9 : 1;
  const size = (CELL_SIZE - 8) * scale;
  const offset = (CELL_SIZE - size) / 2;
  ctx.fillStyle = "#3a7bd5";
  ctx.fillRect(
    state.player.x * CELL_SIZE + 4 + offset,
    state.player.y * CELL_SIZE + 4 + offset,
    size,
    size
  );
}

function drawKiller() {
  if (!state.effects.killerPos) {
    return;
  }
  ctx.fillStyle = "#ff6b6b";
  ctx.fillRect(
    state.effects.killerPos.x * CELL_SIZE + 2,
    state.effects.killerPos.y * CELL_SIZE + 2,
    CELL_SIZE - 4,
    CELL_SIZE - 4
  );
}

function render() {
  drawGrid();

  const wallPositions = Array.from(state.walls).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  drawSquares(wallPositions, "#5a5a5a");

  if (state.effects.intentTiles && DIFFICULTY_CONFIG[difficulty].showIntentFlash) {
    const tiles = Array.from(state.effects.intentTiles).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    });
    drawSquares(tiles, "rgba(200,50,50,0.25)");
  }

  drawSquares(state.enemies, "#d63c3c");

  if (state.effects.freezeUntil && performance.now() < state.effects.freezeUntil) {
    drawKiller();
  }

  drawPlayer();

  if (showForecast && !state.gameOver && DIFFICULTY_CONFIG[difficulty].showForecast) {
    const plan = planEnemyMoves(DIFFICULTY_CONFIG[difficulty]);
    const tiles = Array.from(plan.intentTiles).map((key) => {
      const [x, y] = key.split(",").map(Number);
      return { x, y };
    });
    drawSquares(tiles, "#ff4d4d", 0.35);
  }

  const now = performance.now();
  noMarginEl.classList.toggle("active", now < state.effects.noMarginUntil);
  if (now < state.effects.statusUntil) {
    statusEl.textContent = state.effects.statusText;
  } else {
    statusEl.textContent = "";
  }
}

function initPreferences() {
  difficulty = localStorage.getItem("one-more-move-difficulty") || "standard";
  muted = localStorage.getItem("one-more-move-muted") === "1";
}

function boot() {
  initPreferences();
  const seedMode = "RUN";
  startRun({ mode: seedMode, replay: false });
  setStatus("Press 1/2/3 to set difficulty");
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

boot();
