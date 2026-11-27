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

  // Experimental policy. The shipping browser continues to use the legacy planner.
  const TACTICAL_HORIZONS = Object.freeze({ standard: 1, hard: 2, hardcore: 3 });

  function tacticalAssignments(gameState, current, horizon) {
    const player = gameState.player;
    const prior = gameState.playerTrail?.[1]?.split(",").map(Number);
    const heading = prior && prior.length === 2 && prior.every(Number.isFinite)
      ? { x: Math.sign(player.x - prior[0]), y: Math.sign(player.y - prior[1]) }
      : { x: 0, y: 0 };
    const corridors = getInterceptTargets(gameState).map(exit => {
      const dx = exit.x - player.x, dy = exit.y - player.y;
      let target = exit;
      // A bounded straight-corridor projection, not a claim of predicting future moves.
      for (let step = 1; step < horizon; step++) {
        const next = { x: target.x + dx, y: target.y + dy };
        if (!inBounds(next.x, next.y) || gameState.walls.has(posKey(next))) break;
        target = next;
      }
      return { exit, target, forward: dx * heading.x + dy * heading.y };
    }).sort((a,b) => b.forward - a.forward || a.exit.y - b.exit.y || a.exit.x - b.exit.x);

    const mobile = current.map((enemy,index) => {
      const blocked = buildBlockedSet(gameState,{excludeEnemyIdx:index});
      blocked.delete(posKey(player));
      return {enemy,index,blocked,distance:shortestPathDist(enemy,player,blocked)};
    }).filter(item => item.enemy.stunned <= 0)
      .sort((a,b) => a.distance - b.distance || a.index - b.index);
    const assignments = new Map();
    if (!mobile.length) return assignments;
    const pursuer = mobile.shift();
    assignments.set(pursuer.index,{role:"pursuer",target:player});
    const remaining = [...corridors];
    while (mobile.length && remaining.length) {
      // Allocate distinct corridors, prioritizing the projected direction of travel.
      const corridor = remaining.shift();
      const ranked = mobile.map(item=>({item,distance:shortestPathDist(item.enemy,corridor.target,item.blocked)}))
        .sort((a,b)=>a.distance-b.distance||a.item.index-b.item.index);
      if (!Number.isFinite(ranked[0].distance)) continue;
      const item = ranked[0].item;
      mobile.splice(mobile.indexOf(item),1);
      const role = corridor.forward > 0 ? "interceptor" : corridor.forward === 0 ? "flanker" : "containment";
      assignments.set(item.index,{role,target:corridor.target});
    }
    for (const item of mobile) assignments.set(item.index,{role:"containment",target:player});
    return assignments;
  }

  function planTacticalMovesForState(gameState, cfg, tuning) {
    const horizon = TACTICAL_HORIZONS[gameState.difficulty];
    if (!horizon) throw new Error("Unknown tactical difficulty");
    const current = gameState.enemies.map(enemy=>({...enemy}));
    const assignments = tacticalAssignments(gameState,current,horizon);
    const fallback = assignInterceptTargets(gameState,current);
    const proposals = Array(current.length);
    const reserved = new Set();
    // The closest pursuer chooses first; other enemies avoid redundant destinations
    // only among moves with equal immediate chase tier and path distance.
    const order = current.map((_,index)=>index).sort((a,b)=>
      Number(assignments.get(b)?.role==="pursuer")-Number(assignments.get(a)?.role==="pursuer") || a-b);
    for (const index of order) {
      const enemy = current[index];
      const legal = getNeighbors(enemy).filter(tile=>inBounds(tile.x,tile.y)&&!gameState.walls.has(posKey(tile)));
      if (enemy.stunned>0 || !legal.length || legal.some(tile=>samePosition(tile,gameState.player))) {
        proposals[index]=selectEnemyProposal(gameState,current,index,cfg,fallback,tuning);
      } else {
        const role = assignments.get(index) || {role:"containment",target:gameState.player};
        const ranked = legal.map(tile=>{
          const evaluated = evaluateEnemyCandidate(gameState,current,index,enemy,tile,cfg,role.target,tuning);
          const blocked = buildBlockedSet(gameState,{excludeEnemyIdx:index,hypotheticalTile:tile});
          blocked.delete(posKey(role.target));
          const roleDistance=shortestPathDist(tile,role.target,blocked);
          // Strict kill/chase priorities remain above the tactical role score.
          const rank=[evaluated.rank[0],evaluated.rank[1],Number(reserved.has(posKey(tile))),
            roleDistance,...evaluated.rank.slice(2)];
          return {...evaluated,rank};
        }).sort((a,b)=>compareRank(a.rank,b.rank));
        const selected=ranked[0];
        proposals[index]={target:selected.target,rank:[...selected.rank,index],
          nextEnemy:{...enemy,x:selected.target.x,y:selected.target.y,intent:selected.direction,intentLock:cfg.commitLockTurns}};
      }
      reserved.add(posKey(proposals[index].target));
    }
    const resolvedMoves=resolveEnemyDestinations(current,proposals);
    const intentTiles=new Set(resolvedMoves.filter((enemy,index)=>!samePosition(enemy,current[index])).map(posKey));
    return {resolvedMoves,intentTiles,diagnostics:{horizon,roles:[...assignments].map(([index,role])=>({id:current[index].id,...role}))}};
  }

  return Object.freeze({ planEnemyMovesForState, planTacticalMovesForState, resolveEnemyDestinations, TACTICAL_HORIZONS });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMAi;
