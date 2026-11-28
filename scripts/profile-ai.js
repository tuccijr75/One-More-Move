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
const policies=["tactical-v2","tactical-v3","tactical-v4"];
const initial=[{enemies:2,walls:10,stage:1},{enemies:4,walls:20,stage:15},{enemies:6,walls:30,stage:25}];
const settings=[...initial.map(spec=>({...spec,layout:"initial"})),...initial.map(spec=>({...spec,layout:"contested"}))];
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
  if(spec.layout==="contested"){
    const reachable=grid.reachableTilesFrom(state.player,state.walls);
    const tiles=[...reachable].map(key=>{const [x,y]=key.split(",").map(Number);return {x,y};})
      .filter(tile=>grid.manhattan(tile,state.player)>=2)
      .sort((a,b)=>grid.manhattan(a,state.player)-grid.manhattan(b,state.player)||a.y-b.y||a.x-b.x)
      .slice(0,Math.max(12,spec.enemies));
    assert.ok(tiles.length>=spec.enemies,"not enough contested squares");
    const rng=core.createRng((seed^0xa2174c1d)>>>0);
    state.enemies=state.enemies.map(enemy=>{
      const [tile]=tiles.splice(Math.floor(rng()*tiles.length),1);
      return {...enemy,...tile};
    });
  }
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
    maxCombinationsV3:Math.max(...rows.map(x=>x.combinationsV3)),v4GeometryChanged:rows.filter(x=>x.v4Changed).length,
    v4ForecastImproved:rows.filter(x=>x.v4Improved).length,v4SearchActivated:rows.filter(x=>x.v4Examined>0).length,
    maxV4ResponseCalls:Math.max(...rows.map(x=>x.v4ResponseCalls))};
}
const groups=[],rows=[];
for(const [groupIndex,spec] of settings.entries()){
  // Warm up both paths before recording; alternate timing order to reduce bias.
  for(let i=0;i<5;i++){const s=fixture(spec,startSeed+1000+groupIndex*100+i);for(const policy of policies)plan(s,policy);}
  const group=[];
  for(let i=0;i<fixturesPerGroup;i++){
    const seed=startSeed+groupIndex*100+i, s=fixture(spec,seed);
    const a=plan(s,policies[0]), b=plan(s,policies[1]),c=plan(s,policies[2]);verify(s,a);verify(s,b);verify(s,c);
    assert.deepEqual(c.diagnostics.strictRank,a.diagnostics.rank);
    assert.deepEqual(c.diagnostics.rank.slice(0,3),a.diagnostics.rank.slice(0,3));
    assert.ok(c.diagnostics.responseCalls<=16&&c.diagnostics.examined<=4);
    const forecast=c.diagnostics.forecast,strictForecast=c.diagnostics.strictForecast;
    const v4First=forecast?forecast.findIndex((v,k)=>v!==strictForecast[k]):-1;
    assert.ok(v4First<0||forecast[v4First]<strictForecast[v4First]);
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
        assert.deepEqual(result,policy===policies[0]?a:policy===policies[1]?b:c,"timed result drift");
      }
    }
    group.push({seed,...spec,actualWalls:s.walls.size,changed:different(a,b),improved:first>=0,deviations:d.deviations,
      strictRank:d.strictRank,rank:d.rank,strictContainment:d.strictContainment,containment:d.containment,
      combinationsV2:a.diagnostics.combinations,combinationsV3:d.combinations,v4Changed:different(a,c),v4Improved:v4First>=0,v4Examined:c.diagnostics.examined,v4ResponseCalls:c.diagnostics.responseCalls,timings});
  }
  rows.push(...group);groups.push({...spec,...summarize(group)});
}
const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const report={schemaVersion:2,revision,environment:{node:process.version,platform:process.platform,arch:process.arch},
  config:{fixturesPerGroup,repeats,startSeed,settings,policies,synthetic:true},
  sourceHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),groups,rows};
const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"profile.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({revision,environment:report.environment,config:report.config,groups},null,2));
