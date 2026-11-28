"use strict";

/* Canonical seeded generation, enemy placement, portals and revival selection. */
const OMMGeneration = (() => {
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const { GRID_SIZE, posKey, samePosition, manhattan, reachableTilesFrom, countEscapeOptionsAt } = grid;

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

  function spawnPortalIfNeeded(gameState, debugAssertPortal) {
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
    if (debugAssertPortal) debugAssertPortal(gameState);
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

  return Object.freeze({ createRng, randomSeed, buildWalls, enemyCountForStage, spawnEnemy, computeNextPortalTurn, spawnPortalIfNeeded, chooseRevivalTile });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMGeneration;
