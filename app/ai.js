"use strict";

/* Canonical enemy policy and collision resolution. Configuration and tuning are explicit inputs. */
const OMMAi = (() => {
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const { posKey, samePosition, inBounds, manhattan, getNeighbors, shortestPathDist, shortestPathDistToAny, buildBlockedSet, countEscapeOptionsAt } = grid;

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

  function evaluateEnemyCandidate(gameState, current, index, enemy, tile, cfg, assignedTarget, tuning) {
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

  function selectEnemyProposal(gameState, current, index, cfg, assignments, tuning) {
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
      .map((tile) => evaluateEnemyCandidate(gameState, current, index, enemy, tile, cfg, assignedTarget, tuning))
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
      if (!moving.has(index)) return samePosition(proposals[index].target, enemy)
        ? { ...proposals[index].nextEnemy }
        : { ...enemy, intent: null, intentLock: 0 };
      return { ...proposals[index].nextEnemy };
    });

    const unique = new Set(resolved.map(posKey));
    if (unique.size !== resolved.length) {
      throw new Error("Enemy destination invariant failed: duplicate final positions");
    }
    return resolved;
  }

  function planEnemyMovesForState(gameState, cfg, tuning) {
    const current = gameState.enemies.map((enemy) => ({ ...enemy }));
    const assignments = assignInterceptTargets(gameState, current);
    const proposals = current.map((_, index) => selectEnemyProposal(gameState, current, index, cfg, assignments, tuning));
    const resolvedMoves = resolveEnemyDestinations(current, proposals);
    const intentTiles = new Set();

    resolvedMoves.forEach((enemy, index) => {
      if (!samePosition(enemy, current[index])) intentTiles.add(posKey(enemy));
    });

    return { resolvedMoves, intentTiles };
  }

  return Object.freeze({ planEnemyMovesForState, resolveEnemyDestinations });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMAi;
