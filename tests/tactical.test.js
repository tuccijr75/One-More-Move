"use strict";
const assert=require("node:assert/strict");
const ai=require("../app/ai.js");
const grid=require("../app/grid.js");
const core=require("../app/game.js");
const {simulate}=require("../scripts/lab.js");
const enemy=(id,x,y,stunned=0)=>({id,x,y,stunned,phase:0,intent:null,intentLock:0});
const state=(difficulty,overrides={})=>({difficulty,stage:1,player:{x:5,y:5},playerTrail:["5,5","4,5"],walls:new Set(),tokens:{diag:0},tuning:core.DEFAULT_TUNING,enemies:[enemy(0,5,4),enemy(1,2,2)],...overrides});
const plan=(s,policy="tactical-v2")=>ai.planTacticalMovesForState(s,core.getEffectiveConfig(s.difficulty,s.stage,s.tuning),s.tuning,policy);
(async()=>{
  for(const difficulty of ["standard","hard","hardcore"]){
    const s=state(difficulty);
    const p=plan(s);
    assert.ok(p.resolvedMoves.some(e=>grid.samePosition(e,s.player)),"kill priority");
    assert.equal(p.diagnostics.horizon,ai.TACTICAL_HORIZONS[difficulty]);
    if(difficulty==="standard") assert.deepEqual(p.resolvedMoves,core.planEnemyMovesForState(s).resolvedMoves,"Standard control unchanged");
    const stunned=state(difficulty,{enemies:[enemy(0,5,4,1)]});
    assert.deepEqual(plan(stunned).resolvedMoves[0],enemy(0,5,4,0),"stun must skip exactly one turn");
    const chase=state(difficulty,{walls:new Set(["4,3","4,4","4,5","4,6"]),enemies:[enemy(0,2,5)]});
    const moved=plan(chase).resolvedMoves[0];
    assert.equal(grid.shortestPathDist(moved,chase.player,chase.walls),grid.shortestPathDist(chase.enemies[0],chase.player,chase.walls)-1,"BFS pursuit around wall");
    for(let seed=0;seed<40;seed++){
      const run=core.createHeadlessRun({seed,difficulty});
      const v=run.snapshot();
      const fixture={...v,walls:new Set(v.walls)};
      const before=JSON.stringify(v);
      const result=plan(fixture);
      const refined=plan(fixture,"tactical-v3");
      assert.deepEqual(refined,plan(fixture,"tactical-v3"),"v3 deterministic");
      if(difficulty!=="hardcore")assert.deepEqual(refined,result,"v3 must preserve Standard and Hard exactly");
      else {
        const d=refined.diagnostics;
        assert.ok(d.combinations<=5**fixture.enemies.length);
        assert.ok(d.deviations===0||d.deviations===1);
        assert.equal(new Set(refined.resolvedMoves.map(grid.posKey)).size,fixture.enemies.length);
        refined.resolvedMoves.forEach((e,i)=>{assert.ok(grid.inBounds(e.x,e.y)&&!fixture.walls.has(grid.posKey(e))&&grid.manhattan(e,fixture.enemies[i])<=1);});
        if(d.deviations){assert.ok(-d.rank[1]>=1&&d.rank[1]<=d.strictRank[1]+1&&d.rank[2]<=d.strictRank[2]);}
        const first=d.containment.findIndex((x,i)=>x!==d.strictContainment[i]);
        assert.ok(first<0||d.containment[first]<d.strictContainment[first],"containment never worse than strict plan");
      }
      assert.deepEqual(result,plan(fixture),"planner deterministic");
      assert.equal(JSON.stringify({...fixture,walls:[...fixture.walls].sort()}),before,"planner input immutable");
      assert.equal(new Set(result.resolvedMoves.map(grid.posKey)).size,result.resolvedMoves.length);
      result.resolvedMoves.forEach((e,i)=>{
        const old=fixture.enemies[i];
        assert.ok(grid.inBounds(e.x,e.y));
        assert.ok(!fixture.walls.has(grid.posKey(e)));
        assert.ok(grid.manhattan(e,old)<=1);
      });
      if(difficulty!=="standard")assert.ok(result.diagnostics.combinations>0&&result.diagnostics.combinations<=5**fixture.enemies.length,"bounded exhaustive joint assignments");
    }
  }
  for(const difficulty of ["hard","hardcore"]){
    const crowded=state(difficulty,{enemies:[enemy(0,3,4),enemy(1,4,3)]});
    const moves=plan(crowded).resolvedMoves;
    assert.ok(moves.every((e,i)=>grid.manhattan(e,crowded.enemies[i])===1),"collision-free alternatives must avoid unnecessary holds");
    assert.equal(new Set(moves.map(grid.posKey)).size,2);
    const competing=state(difficulty,{enemies:[enemy(0,5,4),enemy(1,4,5)]});
    assert.equal(plan(competing).resolvedMoves.filter(e=>grid.samePosition(e,competing.player)).length,1,"one immediate kill wins contested player tile");
    assert.equal(plan(competing,"tactical-v3").resolvedMoves.filter(e=>grid.samePosition(e,competing.player)).length,1,"v3 preserves immediate kill");
    assert.deepEqual(plan(state(difficulty,{enemies:[enemy(0,5,4,1)]}),"tactical-v3").resolvedMoves,[enemy(0,5,4,0)],"v3 preserves stun expiry");
    const six=state(difficulty,{enemies:[enemy(0,1,1),enemy(1,2,2),enemy(2,3,3),enemy(3,7,7),enemy(4,8,8),enemy(5,9,9)]});
    assert.ok(plan(six).diagnostics.combinations<=15625,"six-enemy search cap");
  }
  const options={seed:777,difficulty:"hard",strategy:"tactical",maxActions:30,enemyPolicy:"tactical-v2",diagnostics:true};
  assert.deepEqual(await simulate(options),await simulate(options),"candidate seeded trace deterministic");
  const refinedOptions={...options,difficulty:"hardcore",enemyPolicy:"tactical-v3"};
  assert.deepEqual(await simulate(refinedOptions),await simulate(refinedOptions),"v3 seeded trace deterministic");
  assert.throws(()=>core.createHeadlessRun({seed:1,enemyPolicy:"unknown"}),/Invalid enemy policy/);
  console.log("Tactical candidate invariant tests passed.");
})().catch(error=>{console.error(error);process.exitCode=1});
