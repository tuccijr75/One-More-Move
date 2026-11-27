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

  // Ordinary cardinal route pressure only: abilities, enemy conflicts on future
  // turns, revival and dynamic wall generation are deliberately not predicted.
  function containmentModel(gameState, exits) {
    const tiles=[], keys=new Map();
    const routes=exits.map(exit=>{
      const next=getNeighbors(exit).filter(tile=>inBounds(tile.x,tile.y)&&!gameState.walls.has(posKey(tile)));
      return {portal:Boolean(gameState.portal&&samePosition(exit,gameState.portal)),next:next.map(tile=>{
        const key=posKey(tile);
        if(!keys.has(key)){keys.set(key,tiles.length);tiles.push(tile);}
        return {index:keys.get(key),portal:Boolean(gameState.portal&&samePosition(tile,gameState.portal))};
      })};
    });
    // At most the 9 distinct second-step cardinal squares around a grid cell.
    if(tiles.length>31)throw Error("Containment mask overflow");
    return {tiles,routes};
  }

  function continuationThreat(target, active, walls, tiles) {
    let mask=0;
    const reached=new Set([posKey(target)]);
    let frontier=[target];
    if(active){
      for(let depth=0;depth<2;depth++){
        const next=[];
        for(const tile of frontier)for(const neighbor of getNeighbors(tile)){
          const key=posKey(neighbor);
          if(!inBounds(neighbor.x,neighbor.y)||walls.has(key)||reached.has(key))continue;
          reached.add(key);next.push(neighbor);
        }
        frontier=next;
      }
    }
    tiles.forEach((tile,index)=>{if(reached.has(posKey(tile)))mask|=1<<index;});
    return mask;
  }

  function containmentRank(model,occupied,threat,continuation,continuationOccupied) {
    let safe=0,worst=0,total=0;
    for(let index=0;index<model.routes.length;index++){
      const route=model.routes[index],bit=1<<index;
      if(occupied&bit)continue;
      if(!route.portal&&(threat&bit))continue;
      safe++;
      // Portal entry ends this stage before an enemy response; protect its
      // status rather than treating it as an ordinary dead end.
      const count=route.portal?5:route.next.filter(next=>
        !(continuationOccupied&(1<<next.index))&&(next.portal||!(continuation&(1<<next.index)))).length;
      worst=Math.max(worst,count);total+=count;
    }
    return [safe,worst,total];
  }

  function teamOptions(gameState,current,index,cfg,tuning,assignments,exits,projected,containment=null) {
    const enemy = current[index];
    const stationary = selectEnemyProposal(gameState,current,index,cfg,assignments,tuning);
    function option(target, nextEnemy, rank, moved, closing, kill) {
      // Stunned enemies still occupy a square but cannot be counted as active threats.
      const active = nextEnemy.stunned === 0;
      const occupied = coverageMask(target,exits,0);
      return {target,nextEnemy,rank,moved,closing,kill,occupied,
        threat:active?coverageMask(target,exits,1):occupied,
        projected:active?coverageMask(target,projected,1):coverageMask(target,projected,0),
        coordination:Number.isFinite(rank[2])?rank[2]:10000,
        deviation:0,
        continuation:containment?continuationThreat(target,active,gameState.walls,containment.tiles):0,
        continuationOccupied:containment?coverageMask(target,containment.tiles,0):0};
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
    const alternatives=containment&&best&&best.rank[0]===0&&Number.isFinite(best.rank[1])
      ? others.filter(c=>!allowed.includes(c)&&Number.isFinite(c.rank[1])&&c.rank[1]<=best.rank[1]+2)
      : [];
    const choices = [...allowed,...alternatives].map(c=>{
      const kill = Number(samePosition(c.target,gameState.player));
      const choice=option(c.target,{...enemy,x:c.target.x,y:c.target.y,intent:c.direction,intentLock:cfg.commitLockTurns},
        c.rank,1,Number(c.rank[0]===0),kill);
      choice.deviation=Number(alternatives.includes(c));
      return choice;
    });
    // Holding is a collision fallback, never preferred to an otherwise equal legal move.
    choices.push(option(enemy,{...enemy,intent:null,intentLock:0},[9,9,9,index],0,0,0));
    return choices;
  }

  const RESPONSE_BEAM = 4;

  // Evaluate a player-max / enemy-min exchange: ordinary cardinal player replies,
  // followed by the real v2 joint planner. No recursive v4 calls or RNG draws.
  function replyPressure(gameState, current, choices, cfg, tuning) {
    const enemies=resolveEnemyDestinations(current,choices);
    const occupied=new Set(enemies.map(posKey));
    const replies=getInterceptTargets(gameState).filter(tile=>!occupied.has(posKey(tile)));
    let worst=[0,0,0],surviving=0,calls=0;
    for(const player of replies){
      let value;
      if(gameState.portal&&samePosition(player,gameState.portal)){
        // Portal transition precedes enemy response; model as a successful escape.
        value=[2,0,0];
      }else{
        const next={...gameState,player,enemies};
        const response=planTacticalMovesForState(next,cfg,tuning,"tactical-v2").resolvedMoves;
        calls++;
        const intercepted=response.some(enemy=>enemy.stunned===0&&samePosition(enemy,player));
        if(intercepted)value=[0,0,0];
        else{
          const keys=new Set(response.map(posKey));
          const exits=countEscapeOptionsAt(next,player,keys,false);
          const clearance=response.length?Math.min(...response.map(enemy=>manhattan(enemy,player))):20;
          value=[1,exits,clearance];
        }
      }
      if(value[0]>0)surviving++;
      if(compareRank(value,worst)>0)worst=value;
    }
    return {rank:[...worst,surviving],calls};
  }

  function planTacticalMovesForState(gameState,cfg,tuning,policy="tactical-v2") {
    const horizon=TACTICAL_HORIZONS[gameState.difficulty];
    if (!horizon) throw new Error("Unknown tactical difficulty");
    if (gameState.difficulty==="standard") {
      return {...planEnemyMovesForState(gameState,cfg,tuning),diagnostics:{horizon,mode:"control",combinations:0}};
    }
    const current=gameState.enemies.map(enemy=>({...enemy}));
    if (current.length>TEAM_LIMIT) throw new Error("Experimental team size exceeds six enemies");
    const assignments=assignInterceptTargets(gameState,current);
    const {exits,projected}=projectionTiles(gameState,horizon);
    const containment=policy==="tactical-v3"&&gameState.difficulty==="hardcore"?containmentModel(gameState,exits):null;
    const adversarial=policy==="tactical-v4"&&gameState.difficulty==="hardcore"&&current.some(e=>e.stunned===0&&manhattan(e,gameState.player)<=4);
    const candidates=current.map((_,index)=>teamOptions(gameState,current,index,cfg,tuning,assignments,exits,projected,containment));
    const reserved=new Set(),selected=[];
    let best=null,bestRank=null,bestContainment=null,combinations=0;
    // Store bounded leaf summaries only for v3. At most 5^6 assignments.
    const alternatives=[];
    const beam=[];
    function search(index,kills,closing,moved,occupied,threat,projection,coordination,deviations,continuation,continuationOccupied) {
      if (index===candidates.length) {
        combinations++;
        const coverage=[bitCount(occupied),bitCount(threat),bitCount(projection)];
        const tactical=gameState.difficulty==="hard"
          ? [-coverage[0],-coverage[1],-coverage[2]]
          : [-coverage[1],-coverage[2],-coverage[0]];
        const rank=[-kills,-closing,-moved,...tactical,coordination];
        const pressure=containment?containmentRank(containment,occupied,threat,continuation,continuationOccupied):null;
        if (deviations===0&&(!bestRank||compareRank(rank,bestRank)<0)) {
          bestRank=rank;best=selected.slice();bestContainment=pressure;
        }
        if(containment)alternatives.push({choices:selected.slice(),rank,pressure,deviations,kills,closing,moved});
        if(adversarial){
          // Stable rank order, with the strict best always in the shortlist.
          // Keep only the four strongest heuristic leaves, never expand the tree recursively.
          const index=beam.findIndex(entry=>compareRank(rank,entry.rank)<0);
          if(index>=0)beam.splice(index,0,{choices:selected.slice(),rank});
          else if(beam.length<RESPONSE_BEAM)beam.push({choices:selected.slice(),rank});
          if(beam.length>RESPONSE_BEAM)beam.pop();
        }
        return;
      }
      for (const candidate of candidates[index]) {
        const key=posKey(candidate.target);
        if (reserved.has(key)||deviations+candidate.deviation>1) continue;
        reserved.add(key);selected.push(candidate);
        search(index+1,kills+candidate.kill,closing+candidate.closing,moved+candidate.moved,
          occupied|candidate.occupied,threat|candidate.threat,projection|candidate.projected,coordination+candidate.coordination,
          deviations+candidate.deviation,continuation|candidate.continuation,continuationOccupied|candidate.continuationOccupied);
        selected.pop();reserved.delete(key);
      }
    }
    search(0,0,0,0,0,0,0,0,0,0,0);
    if (!best) throw new Error("No collision-free team assignment");
    const strictRank=bestRank;
    const strictContainment=bestContainment;
    let chosenDeviation=0;
    if(containment&&strictRank[0]===0){
      let selectedAlternative=null,selectedRank=null;
      for(const alternative of alternatives){
        if(alternative.kills!==0||alternative.moved< -strictRank[2])continue;
        if(alternative.deviations===0){
          // A stricter pressure objective may break a tie, never lose closing moves.
          if(alternative.closing!==-strictRank[1])continue;
        }else{
          // A single off-best move is allowed only with an active closing ally,
          // no lost team movement, and at most one fewer closing enemy.
          if(alternative.closing<1||alternative.closing< -strictRank[1]-1)continue;
        }
        if(compareRank(alternative.pressure,strictContainment)>=0)continue;
        const rank=[...alternative.pressure,alternative.deviations,...alternative.rank];
        if(!selectedRank||compareRank(rank,selectedRank)<0){selectedAlternative=alternative;selectedRank=rank;}
      }
      if(selectedAlternative){
        best=selectedAlternative.choices;bestRank=selectedAlternative.rank;
        bestContainment=selectedAlternative.pressure;chosenDeviation=selectedAlternative.deviations;
      }
    }
    let forecast=null,strictForecast=null,responseCalls=0,examined=0;
    if(adversarial&&strictRank[0]===0){
      const eligible=beam.filter(entry=>entry.rank.slice(0,3).every((v,i)=>v===strictRank[i]));
      if(eligible.length>1){
        const initial=replyPressure(gameState,current,best,cfg,tuning);
        forecast=strictForecast=initial.rank;responseCalls+=initial.calls;examined=1;
        for(const entry of eligible.slice(1)){
          const evaluation=replyPressure(gameState,current,entry.choices,cfg,tuning);
          responseCalls+=evaluation.calls;examined++;
          if(compareRank(evaluation.rank,forecast)<0){
            best=entry.choices;bestRank=entry.rank;forecast=evaluation.rank;
          }
        }
      }
    }
    const resolvedMoves=resolveEnemyDestinations(current,best);
    const intentTiles=new Set(resolvedMoves.filter((enemy,index)=>!samePosition(enemy,current[index])).map(posKey));
    return {resolvedMoves,intentTiles,diagnostics:{horizon,mode:"joint",combinations,rank:bestRank,...(containment?{strictRank,strictContainment,containment:bestContainment,deviations:chosenDeviation}: {}),...(policy==="tactical-v4"&&gameState.difficulty==="hardcore"?{strictRank,forecast,strictForecast,responseCalls,examined}: {})}};
  }

  return Object.freeze({ planEnemyMovesForState, planTacticalMovesForState, resolveEnemyDestinations, TACTICAL_HORIZONS });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMAi;
