"use strict";

/* Canonical grid geometry and pathfinding. No runtime state or external dependencies. */
const OMMGrid = (() => {
  const GRID_SIZE = 10;

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

  return Object.freeze({ GRID_SIZE, posKey, samePosition, inBounds, manhattan, getNeighbors, reachableTilesFrom, shortestPathDist, shortestPathDistToAny, buildBlockedSet, countEscapeOptionsAt });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMGrid;
