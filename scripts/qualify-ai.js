"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const grid=require("../app/grid");
const config=require("../app/config");
const generation=require("../app/generation");
const progression=require("../app/progression");
const stateModule=require("../app/state");
const ai=require("../app/ai");

const root=path.resolve(__dirname,"..");
const seeds=Array.from({length:24},(_,i)=>70001+i);
const stages=[1,5,6,10,11,15,16,20,21,25,30,45,50,100,105];
const policies=["tactical-v2","tactical-v4"];
const difficulties=["standard","hard","hardcore"];
const tuning=config.DEFAULT_TUNING;
const files=["app/grid.js","app/ai.js","app/config.js","app/generation.js","app/progression.js","app/state.js","scripts/qualify-ai.js"];
const detached=s=>{const {rng,effects,...rest}=s;return {...rest,walls:[...s.walls].sort()};};
const geometry=p=>p.resolvedMoves.map(({id,x,y,stunned})=>({id,x,y,stunned}));
const percentile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1];
const rows=[],chains=[];
let transitions=0,portals=0,shortSpawns=0,wallFallbacks=0;
function verifyBoard(s){
  const key=grid.posKey(s.player),reachable=grid.reachableTilesFrom(s.player,s.walls);
  assert.ok(grid.inBounds(s.player.x,s.player.y)&&!s.walls.has(key));
  assert.equal(s.wallCount,Math.min(config.WALL_MAX,tuning.walls+Math.floor(s.stage/config.WALL_ADD_EVERY_STAGES)));
  assert.ok(s.walls.size<=s.wallCount);
  if(s.walls.size!==s.wallCount)wallFallbacks++;
  const target=generation.enemyCountForStage(s.stage);
  assert.ok(s.enemies.length<=target);
  if(s.enemies.length<target)shortSpawns++;
  const occupied=new Set(s.enemies.map(grid.posKey));
  assert.equal(occupied.size,s.enemies.length);
  assert.equal(new Set(s.enemies.map(e=>e.id)).size,s.enemies.length);
  for(const e of s.enemies){
    assert.ok(grid.inBounds(e.x,e.y)&&!s.walls.has(grid.posKey(e))&&!grid.samePosition(e,s.player));
    assert.ok(grid.manhattan(e,s.player)>1,"stage-entry spawn distance");
  }
  assert.ok(grid.countEscapeOptionsAt(s,s.player,occupied,false)>=2,"stage-entry escape geometry");
  if(s.portal){
    const k=grid.posKey(s.portal);
    assert.ok(reachable.has(k)&&k!==key&&!occupied.has(k)&&!s.walls.has(k),"portal generation validity");
  }
}
function verifyPlan(s,p){
  assert.equal(p.resolvedMoves.length,s.enemies.length);
  assert.equal(new Set(p.resolvedMoves.map(grid.posKey)).size,s.enemies.length);
  p.resolvedMoves.forEach((e,i)=>{
    const old=s.enemies[i];
    assert.equal(e.id,old.id);
    assert.ok(grid.inBounds(e.x,e.y)&&!s.walls.has(grid.posKey(e))&&grid.manhattan(e,old)<=1);
    if(old.stunned>0){assert.ok(grid.samePosition(e,old));assert.equal(e.stunned,old.stunned-1);}
  });
  if(s.difficulty!=="standard")assert.ok(p.diagnostics.combinations<=5**s.enemies.length);
}
function sample(s,layout){
  const before=JSON.stringify(detached(s));
  for(const difficulty of difficulties){
    const input={...s,difficulty};
    const cfg=config.getEffectiveConfig(difficulty,s.stage,tuning);
    const plans={},latency={};
    for(const policy of policies){
      const start=performance.now();
      const plan=ai.planTacticalMovesForState(input,cfg,tuning,policy);
      latency[policy]=performance.now()-start;
      verifyPlan(input,plan);
      assert.deepEqual(plan,ai.planTacticalMovesForState(input,cfg,tuning,policy),"deterministic planner replay");
      plans[policy]=plan;
    }
    const a=plans[policies[0]],b=plans[policies[1]];
    if(difficulty==="standard"){
      assert.deepEqual(a,b,"Standard unchanged");
      assert.deepEqual(a.resolvedMoves,ai.planEnemyMovesForState(input,cfg,tuning).resolvedMoves,"Standard legacy parity");
    }else if(difficulty==="hard")assert.deepEqual(a,b,"Hard unchanged");
    else{
      assert.deepEqual(b.diagnostics.strictRank,a.diagnostics.rank);
      assert.deepEqual(b.diagnostics.rank.slice(0,3),a.diagnostics.rank.slice(0,3));
      assert.ok(b.diagnostics.responseCalls<=16&&b.diagnostics.examined<=4);
    }
    rows.push({seed:s.seed,stage:s.stage,layout,difficulty,enemies:s.enemies.length,walls:s.walls.size,
      requestedWalls:s.wallCount,changed:JSON.stringify(geometry(a))!==JSON.stringify(geometry(b)),
      responseCalls:b.diagnostics.responseCalls??0,latency,
      input:detached(input),plans:Object.fromEntries(policies.map(p=>[p,{resolvedMoves:plans[p].resolvedMoves,diagnostics:plans[p].diagnostics}]))});
  }
  assert.equal(JSON.stringify(detached(s)),before,"planner mutated scenario");
}
function chain(seed,record){
  const s=stateModule.initializeState(seed,"QUALIFICATION",{runId:1,difficulty:"hardcore",tuning,best:0});
  let lifeExpected=false;
  const trace=crypto.createHash("sha256");
  for(let stage=1;stage<=105;stage++){
    assert.equal(s.stage,stage);
    if(stage%15===0)lifeExpected=true;
    assert.equal(s.hasExtraLife,lifeExpected,"extra life must be boolean and awarded at threshold");
    if(record)verifyBoard(s);
    trace.update(JSON.stringify(detached(s))+"\n");
    if(record&&stages.includes(stage))sample(s,"stage-entry");
    // Force the existing portal schedule, then invoke the canonical generator.
    // This is a component qualification chain, NOT a survived playthrough.
    s.turns=s.nextPortalAtTurn;
    generation.spawnPortalIfNeeded(s);
    assert.ok(s.portal,"expected reachable portal");
    if(record){
      portals++;
      const key=grid.posKey(s.portal);
      assert.ok(grid.reachableTilesFrom(s.player,s.walls).has(key)&&!s.enemies.some(e=>grid.samePosition(e,s.portal)));
    }
    trace.update(JSON.stringify(detached(s))+"\n");
    if(record&&stages.includes(stage))sample(s,"portal-active");
    if(stage===105)break;
    // Explicitly emulate one life consumption after stage 30 to verify re-award.
    if(stage===30){s.hasExtraLife=false;lifeExpected=false;}
    s.player={...s.portal};
    s.playerTrail=[grid.posKey(s.player),...s.playerTrail].slice(0,2);
    const turn=s.turns;
    progression.advanceStage(s,tuning);
    assert.equal(s.turns,turn,"preserve current portal accounting");
    assert.equal(s.portal,null);
    assert.equal(s.nextPortalAtTurn,generation.computeNextPortalTurn(s.stage,turn));
    assert.equal(s.nextSpawnTurn,turn+tuning.initialSpawn);
    if(record)transitions++;
  }
  return trace.digest("hex");
}
for(const seed of seeds){
  const hash=chain(seed,true);
  assert.equal(chain(seed,false),hash,"stage-chain deterministic replay");
  chains.push({seed,sha256:hash});
}
assert.equal(rows.length,seeds.length*stages.length*2*difficulties.length);
assert.equal(transitions,seeds.length*104);
assert.equal(portals,seeds.length*105);
const groups=stages.map(stage=>{
  const sampleRows=rows.filter(r=>r.stage===stage&&r.difficulty==="hardcore");
  return {stage,fixtures:sampleRows.length,maxEnemies:Math.max(...sampleRows.map(r=>r.enemies)),
    maxWalls:Math.max(...sampleRows.map(r=>r.walls)),changed:sampleRows.filter(r=>r.changed).length,
    maxResponseCalls:Math.max(...sampleRows.map(r=>r.responseCalls)),
    p95Ms:Object.fromEntries(policies.map(p=>[p,percentile(sampleRows.map(r=>r.latency[p]),.95)]))};
});
const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const report={schemaVersion:1,revision,environment:{node:process.version,platform:process.platform,arch:process.arch},
  settings:{seeds,stages,policies,difficulties,forcedStageTransitions:true},sourceHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),
  summary:{transitions,portals,shortSpawns,wallFallbacks,pairedPlannerFixtures:rows.length,controlFixtures:rows.filter(r=>r.difficulty!=="hardcore").length},groups,chains,rows};
const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"qualification.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({revision,summary:report.summary,groups},null,2));
