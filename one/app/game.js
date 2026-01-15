const GRID_SIZE = 10;
const CELL_SIZE = 60;
const WALL_COUNT = 10;
const INITIAL_ENEMIES = 2;
const ESCAPE_PENALTY_WEIGHT = 1.5;
const GAP_FILL_BONUS = 3.0;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const turnsEl = document.getElementById("turns");
const bestEl = document.getElementById("best");
const overlayEl = document.getElementById("overlay");
const finalTurnsEl = document.getElementById("final-turns");

let rng = null;
let state = null;
let showForecast = false;
const TURN_DELAY_MS = 130;
const INTENT_FLASH_MS = 100;
const PULSE_DURATION_MS = 100;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

function initState() {
  rng = mulberry32(Date.now() & 0xffffffff);
  const player = { x: 5, y: 5 };
  state = {
    player,
    walls: buildWalls(),
    enemies: [],
    turns: 0,
    best: Number(localStorage.getItem("one-more-move-best") || 0),
    nextSpawnTurn: 10,
    gameOver: false,
    inputLocked: false,
    intentFlashTiles: null,
    pulseUntil: 0,
  };

  for (let i = 0; i < INITIAL_ENEMIES; i += 1) {
    spawnEnemy();
  }

  updateHud();
  overlayEl.classList.add("hidden");
  render();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateHud() {
  turnsEl.textContent = `Turns: ${state.turns}`;
  bestEl.textContent = `Best: ${state.best}`;
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

function scoreEnemyMove(enemyIndex, target) {
  const enemyPositions = new Set(state.enemies.map(posKey));
  enemyPositions.delete(posKey(state.enemies[enemyIndex]));
  enemyPositions.add(posKey(target));

  const distanceScore = -manhattan(target, state.player);
  const escapeOptions = countPlayerEscapeOptions(enemyPositions);
  const escapePenalty = ESCAPE_PENALTY_WEIGHT * escapeOptions;

  let gapBonus = 0;
  const isAdjacentToPlayer = manhattan(target, state.player) === 1;
  const targetKey = posKey(target);
  const isBlank =
    !state.walls.has(targetKey) &&
    !state.enemies.some((enemy, index) => index !== enemyIndex && posKey(enemy) === targetKey) &&
    !(state.player.x === target.x && state.player.y === target.y);
  if (isAdjacentToPlayer && isBlank) {
    gapBonus = GAP_FILL_BONUS;
  }

  return distanceScore - escapePenalty + gapBonus;
}

function computeEnemyPlans() {
  const currentPositions = state.enemies.map((enemy) => ({ ...enemy }));
  const occupied = new Set(currentPositions.map(posKey));
  const desired = [];

  currentPositions.forEach((enemy, index) => {
    const candidates = getNeighbors(enemy)
      .filter((tile) => inBounds(tile.x, tile.y))
      .filter((tile) => !state.walls.has(posKey(tile)))
      .filter((tile) => !occupied.has(posKey(tile)));

    if (candidates.length === 0) {
      desired.push({ ...enemy });
      return;
    }

    let best = null;
    let bestScore = -Infinity;
    let bestDistance = Infinity;

    for (const tile of candidates) {
      const score = scoreEnemyMove(index, tile);
      const dist = manhattan(tile, state.player);
      if (score > bestScore || (score === bestScore && dist < bestDistance)) {
        best = tile;
        bestScore = score;
        bestDistance = dist;
      }
    }

    desired.push(best ? { ...best } : { ...enemy });
  });

  const destinationMap = new Map();
  desired.forEach((tile, index) => {
    const key = posKey(tile);
    if (!destinationMap.has(key)) {
      destinationMap.set(key, []);
    }
    destinationMap.get(key).push(index);
  });

  const finalPositions = currentPositions.map((enemy) => ({ ...enemy }));

  for (const [key, indices] of destinationMap.entries()) {
    if (indices.length === 1) {
      const idx = indices[0];
      finalPositions[idx] = { ...desired[idx] };
      continue;
    }

    let winningIndex = indices[0];
    let bestDistance = manhattan(currentPositions[winningIndex], state.player);
    for (const idx of indices.slice(1)) {
      const dist = manhattan(currentPositions[idx], state.player);
      if (dist < bestDistance) {
        winningIndex = idx;
        bestDistance = dist;
      }
    }

    finalPositions[winningIndex] = { ...desired[winningIndex] };
  }

  return finalPositions;
}

function playerHasMoves() {
  const enemyPositions = new Set(state.enemies.map(posKey));
  return getNeighbors(state.player).some((tile) => {
    if (!inBounds(tile.x, tile.y)) {
      return false;
    }
    const key = posKey(tile);
    if (state.walls.has(key)) {
      return false;
    }
    if (enemyPositions.has(key)) {
      return false;
    }
    return true;
  });
}

async function resolveTurnAsync() {
  state.inputLocked = true;
  await delay(TURN_DELAY_MS);

  const plannedPositions = computeEnemyPlans();
  state.intentFlashTiles = plannedPositions;
  render();
  await delay(INTENT_FLASH_MS);
  state.intentFlashTiles = null;

  state.enemies = plannedPositions;
  if (state.enemies.some((enemy) => enemy.x === state.player.x && enemy.y === state.player.y)) {
    endGame();
    state.inputLocked = false;
    return;
  }

  if (!playerHasMoves()) {
    endGame();
    state.inputLocked = false;
    return;
  }

  state.turns += 1;
  if (state.turns > state.best) {
    state.best = state.turns;
    localStorage.setItem("one-more-move-best", String(state.best));
  }

  if (state.turns >= state.nextSpawnTurn) {
    spawnEnemy();
    const interval = Math.max(3, Math.floor(10 - state.turns / 15));
    state.nextSpawnTurn += interval;
  }

  updateHud();
  state.pulseUntil = performance.now() + PULSE_DURATION_MS;
  render();
  setTimeout(() => {
    render();
  }, PULSE_DURATION_MS);
  state.inputLocked = false;
}

function endGame() {
  state.gameOver = true;
  finalTurnsEl.textContent = `Turns Survived: ${state.turns}`;
  overlayEl.classList.remove("hidden");
  updateHud();
  render();
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
  if (state.enemies.some((enemy) => enemy.x === target.x && enemy.y === target.y)) {
    endGame();
    return;
  }

  render();
  resolveTurnAsync();
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
  }

  if (key === "r") {
    initState();
    return;
  }
  if (event.key === " ") {
    showForecast = true;
    render();
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

function render() {
  drawGrid();

  const wallPositions = Array.from(state.walls).map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  drawSquares(wallPositions, "#5a5a5a");
  if (state.intentFlashTiles) {
    drawSquares(state.intentFlashTiles, "rgba(200,50,50,0.25)");
  }
  drawSquares(state.enemies, "#d63c3c");
  drawPlayer();

  if (showForecast && !state.gameOver) {
    const planned = computeEnemyPlans();
    drawSquares(planned, "#ff4d4d", 0.35);
  }
}

window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);

initState();
