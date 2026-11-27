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

  // Node-only experimental policy. Standard is the original control.
  const TACTICAL_HORIZONS = Object.freeze({ standard: 1, hard: 2, hardcore: 3 });
  const TEAM_LIMIT = 6;

  function projectionTiles(gameState, horizon) {
    const exits = getInterceptTargets(gameState);
    const seen = new Set([posKey(gameState.player), ...exits.map(posKey)]);
    let frontier = exits;
    const projected = [];
    for (let depth = 2; depth <= horizon; depth++) {
      const next = [];
      for (const tile of frontier) {
        for (const candidate of getNeighbors(tile)) {
          const key = posKey(candidate);
          if (!inBounds(candidate.x,candidate.y) || gameState.walls.has(key) || seen.has(key)) continue;
          seen.add(key);
          next.push(candidate);
          projected.push(candidate);
        }
      }
      frontier = next;
    }
    return { exits, projected };
  }

  function bitCount(mask) {
    let count = 0;
    for (let bits = mask >>> 0; bits; bits = (bits & (bits - 1)) >>> 0) count++;
    return count;
  }

  function coverageMask(tile, targets, reach) {
    let mask = 0;
    targets.forEach((target,index) => {
      if (manhattan(tile,target) <= reach) mask |= 1 << index;
    });
    return mask;
  }

  function teamOptions(gameState,current,index,cfg,tuning,assignments,exits,projected) {
    const enemy = current[index];
    const stationary = selectEnemyProposal(gameState,current,index,cfg,assignments,tuning);
    function option(target, nextEnemy, rank, moved, closing, kill) {
      // Stunned enemies still occupy a square but cannot be counted as active threats.
      const active = nextEnemy.stunned === 0;
      const occupied = coverageMask(target,exits,0);
      return {target,nextEnemy,rank,moved,closing,kill,occupied,
        threat:active?coverageMask(target,exits,1):occupied,
        projected:active?coverageMask(target,projected,1):coverageMask(target,projected,0),
        coordination:Number.isFinite(rank[2])?rank[2]:10000};
    }
    if (enemy.stunned > 0) {
      return [option(stationary.target,stationary.nextEnemy,stationary.rank,0,0,0)];
    }
    const legal = getNeighbors(enemy).filter(tile=>inBounds(tile.x,tile.y)&&!gameState.walls.has(posKey(tile)));
    const ranked = legal.map(tile=>evaluateEnemyCandidate(gameState,current,index,enemy,tile,cfg,assignments.get(index)||null,tuning));
    const kills = ranked.filter(candidate=>samePosition(candidate.target,gameState.player));
    const others = ranked.filter(candidate=>!samePosition(candidate.target,gameState.player))
      .sort((a,b)=>compareRank(a.rank,b.rank));
    // Do not take a worse chase tier or greater BFS distance merely for containment.
    const best = others[0];
    const allowed = [...kills,...others.filter(c=>best&&c.rank[0]===best.rank[0]&&c.rank[1]===best.rank[1])];
    const choices = allowed.map(c=>{
      const kill = Number(samePosition(c.target,gameState.player));
      return option(c.target,{...enemy,x:c.target.x,y:c.target.y,intent:c.direction,intentLock:cfg.commitLockTurns},
        c.rank,1,Number(c.rank[0]===0),kill);
    });
    // Holding is a collision fallback, never preferred to an otherwise equal legal move.
    choices.push(option(enemy,{...enemy,intent:null,intentLock:0},[9,9,9,index],0,0,0));
    return choices;
  }

  function planTacticalMovesForState(gameState,cfg,tuning) {
    const horizon=TACTICAL_HORIZONS[gameState.difficulty];
    if (!horizon) throw new Error("Unknown tactical difficulty");
    if (gameState.difficulty==="standard") {
      return {...planEnemyMovesForState(gameState,cfg,tuning),diagnostics:{horizon,mode:"control",combinations:0}};
    }
    const current=gameState.enemies.map(enemy=>({...enemy}));
    if (current.length>TEAM_LIMIT) throw new Error("Experimental team size exceeds six enemies");
    const assignments=assignInterceptTargets(gameState,current);
    const {exits,projected}=projectionTiles(gameState,horizon);
    const candidates=current.map((_,index)=>teamOptions(gameState,current,index,cfg,tuning,assignments,exits,projected));
    const reserved=new Set(),selected=[];
    let best=null,bestRank=null,combinations=0;
    function search(index,kills,closing,moved,occupied,threat,projection,coordination) {
      if (index===candidates.length) {
        combinations++;
        const coverage=[bitCount(occupied),bitCount(threat),bitCount(projection)];
        const tactical=gameState.difficulty==="hard"
          ? [-coverage[0],-coverage[1],-coverage[2]]
          : [-coverage[1],-coverage[2],-coverage[0]];
        const rank=[-kills,-closing,-moved,...tactical,coordination];
        if (!bestRank||compareRank(rank,bestRank)<0) {
          bestRank=rank;best=selected.slice();
        }
        return;
      }
      for (const candidate of candidates[index]) {
        const key=posKey(candidate.target);
        if (reserved.has(key)) continue;
        reserved.add(key);selected.push(candidate);
        search(index+1,kills+candidate.kill,closing+candidate.closing,moved+candidate.moved,
          occupied|candidate.occupied,threat|candidate.threat,projection|candidate.projected,coordination+candidate.coordination);
        selected.pop();reserved.delete(key);
      }
    }
    search(0,0,0,0,0,0,0,0);
    if (!best) throw new Error("No collision-free team assignment");
    const resolvedMoves=resolveEnemyDestinations(current,best);
    const intentTiles=new Set(resolvedMoves.filter((enemy,index)=>!samePosition(enemy,current[index])).map(posKey));
    return {resolvedMoves,intentTiles,diagnostics:{horizon,mode:"joint",combinations,rank:bestRank}};
  }

  return Object.freeze({ planEnemyMovesForState, planTacticalMovesForState, resolveEnemyDestinations, TACTICAL_HORIZONS });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMAi;
