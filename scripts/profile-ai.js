"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const assert=require("node:assert/strict");
const core=require("../app/game");
const ai=require("../app/ai");
const grid=require("../app/grid");

const root=path.resolve(__dirname,"..");
const policies=["tactical-v2","tactical-v3"];
const settings=[{enemies:2,walls:10,stage:1},{enemies:4,walls:20,stage:15},{enemies:6,walls:30,stage:25}];
const fixturesPerGroup=40, repeats=3, startSeed=30001;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
const geometry=plan=>plan.resolvedMoves.map(({id,x,y,stunned})=>({id,x,y,stunned}));
const different=(a,b)=>JSON.stringify(geometry(a))!==JSON.stringify(geometry(b));
const files=["app/grid.js","app/ai.js","app/config.js","app/generation.js","app/movement.js","app/progression.js","app/state.js","app/storage.js","app/presentation.js","app/game.js","scripts/profile-ai.js"];

function fixture(spec,seed){
  const run=core.createHeadlessRun({seed,difficulty:"hardcore",settings:{initialEnemies:spec.enemies,walls:spec.walls}});
  const snapshot=run.snapshot();
  // Synthetic stress configuration: later stage number and requested density,
  // not a claim that this position occurred during a real playthrough.
  const state={...snapshot,stage:spec.stage,walls:new Set(snapshot.walls)};
  assert.equal(state.enemies.length,spec.enemies,"fixture enemy count");
  return state;
}
function plan(state,policy){
  return ai.planTacticalMovesForState(state,core.getEffectiveConfig(state.difficulty,state.stage,state.tuning),state.tuning,policy);
}
function verify(state,result){
  assert.equal(result.resolvedMoves.length,state.enemies.length);
  assert.equal(new Set(result.resolvedMoves.map(grid.posKey)).size,state.enemies.length);
  for(let i=0;i<state.enemies.length;i++){
    const enemy=result.resolvedMoves[i], prior=state.enemies[i];
    assert.ok(grid.inBounds(enemy.x,enemy.y)&&!state.walls.has(grid.posKey(enemy))&&grid.manhattan(enemy,prior)<=1);
  }
  assert.ok(result.diagnostics.combinations>0&&result.diagnostics.combinations<=5**state.enemies.length);
}
function summarize(rows){
  const timing={};
  for(const policy of policies){
    const samples=rows.flatMap(row=>row.timings[policy]);
    timing[policy]={samples:samples.length,p50Ms:percentile(samples,.5),p95Ms:percentile(samples,.95),maxMs:Math.max(...samples)};
  }
  return {fixtures:rows.length,timing,geometryChanged:rows.filter(x=>x.changed).length,
    improvedContainment:rows.filter(x=>x.improved).length,
    chaseExceptions:rows.filter(x=>x.deviations===1).length,
    maxCombinationsV2:Math.max(...rows.map(x=>x.combinationsV2)),
    maxCombinationsV3:Math.max(...rows.map(x=>x.combinationsV3))};
}
const groups=[],rows=[];
for(const [groupIndex,spec] of settings.entries()){
  // Warm up both paths before recording; alternate timing order to reduce bias.
  for(let i=0;i<5;i++){const s=fixture(spec,startSeed+1000+groupIndex*100+i);for(const policy of policies)plan(s,policy);}
  const group=[];
  for(let i=0;i<fixturesPerGroup;i++){
    const seed=startSeed+groupIndex*100+i, s=fixture(spec,seed);
    const a=plan(s,policies[0]), b=plan(s,policies[1]);verify(s,a);verify(s,b);
    const d=b.diagnostics;
    assert.deepEqual(d.strictRank,a.diagnostics.rank,"v3 strict reference must equal v2 rank");
    const first=d.containment.findIndex((v,k)=>v!==d.strictContainment[k]);
    assert.ok(first<0||d.containment[first]<d.strictContainment[first]);
    if(d.deviations)assert.ok(first>=0&&d.rank[1]<0&&d.rank[1]<=d.strictRank[1]+1&&d.rank[2]<=d.strictRank[2]);
    const timings=Object.fromEntries(policies.map(p=>[p,[]]));
    for(let repeat=0;repeat<repeats;repeat++){
      for(const policy of ((i+repeat)%2?policies.slice().reverse():policies)){
        const start=performance.now(),result=plan(s,policy),elapsed=performance.now()-start;
        timings[policy].push(elapsed);
        assert.deepEqual(result,policy===policies[0]?a:b,"timed result drift");
      }
    }
    group.push({seed,...spec,actualWalls:s.walls.size,changed:different(a,b),improved:first>=0,deviations:d.deviations,
      strictRank:d.strictRank,rank:d.rank,strictContainment:d.strictContainment,containment:d.containment,
      combinationsV2:a.diagnostics.combinations,combinationsV3:d.combinations,timings});
  }
  rows.push(...group);groups.push({...spec,...summarize(group)});
}
const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const report={schemaVersion:1,revision,environment:{node:process.version,platform:process.platform,arch:process.arch},
  config:{fixturesPerGroup,repeats,startSeed,settings,policies,synthetic:true},
  sourceHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),groups,rows};
const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"profile.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({revision,environment:report.environment,config:report.config,groups},null,2));
