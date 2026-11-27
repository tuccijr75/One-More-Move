"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {performance}=require("node:perf_hooks");
const core=require("../app/game");
const ai=require("../app/ai");
const grid=require("../app/grid");
const {simulate}=require("./lab");

const root=path.resolve(__dirname,"..");
const policies=["tactical-v2","tactical-v3","tactical-v4"];
const sourcePolicies=["tactical-v2","tactical-v3"];
const strategies=["greedy","defensive","tactical"];
const settings={startSeed:50001,runsPerGroup:10,maxActions:160,inputMs:1000,maxAuditsPerRun:32};
const sourceFiles=["app/grid.js","app/ai.js","app/config.js","app/generation.js","app/movement.js","app/progression.js","app/state.js","app/storage.js","app/presentation.js","app/game.js","scripts/lab.js","scripts/audit-ai.js"];
const geom=plan=>plan.resolvedMoves.map(({id,x,y,stunned})=>({id,x,y,stunned}));
const diff=(a,b)=>JSON.stringify(geom(a))!==JSON.stringify(geom(b));
const compareRank=(a,b)=>{for(let i=0;i<a.length;i++){if(a[i]<b[i])return -1;if(a[i]>b[i])return 1;}return 0;};
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
function audit(event,sourcePolicy,strategy,index){
  const before=event.before, state={...before,walls:new Set(before.walls)};
  const cfg=core.getEffectiveConfig(state.difficulty,state.stage,state.tuning);
  const plans={},latency={};
  for(const policy of policies){
    const start=performance.now();
    const plan=ai.planTacticalMovesForState(state,cfg,state.tuning,policy);
    latency[policy]=performance.now()-start;
    plans[policy]=plan;
    assert.equal(plan.resolvedMoves.length,state.enemies.length);
    assert.equal(new Set(plan.resolvedMoves.map(grid.posKey)).size,state.enemies.length);
    plan.resolvedMoves.forEach((e,i)=>assert.ok(grid.inBounds(e.x,e.y)&&!state.walls.has(grid.posKey(e))&&grid.manhattan(e,state.enemies[i])<=1));
  }
  const v2=plans["tactical-v2"],v3=plans["tactical-v3"],v4=plans["tactical-v4"];
  assert.deepEqual(plans[sourcePolicy].resolvedMoves,event.resolvedMoves,"actual source plan must replay");
  assert.deepEqual(plans[sourcePolicy].diagnostics,event.diagnostics,"actual source diagnostics must replay");
  assert.deepEqual(v3.diagnostics.strictRank,v2.diagnostics.rank);
  assert.deepEqual(v4.diagnostics.strictRank,v2.diagnostics.rank);
  assert.deepEqual(v4.diagnostics.rank.slice(0,3),v2.diagnostics.rank.slice(0,3));
  assert.ok(v4.diagnostics.responseCalls<=16&&v4.diagnostics.examined<=4);
  const d=v4.diagnostics;
  if(d.forecast)assert.ok(compareRank(d.forecast,d.strictForecast)<=0,"forecast regressed");
  const activeNear=state.enemies.some(e=>e.stunned===0&&grid.manhattan(e,state.player)<=4);
  const v3Changed=diff(v2,v3),v4Changed=diff(v2,v4);
  const category=v2.diagnostics.rank[0]<0?"immediate-kill":!activeNear?"outside-activation":
    d.examined===0?"no-eligible-comparison":v4Changed?"changed":"evaluated-no-change";
  return {seed:state.seed,sourcePolicy,strategy,index,turn:state.turns,stage:state.stage,enemies:state.enemies.length,
    category,activeNear,v3Changed,v4Changed,v3Deviation:v3.diagnostics.deviations,
    strictRank:v2.diagnostics.rank,strictForecast:d.strictForecast,forecast:d.forecast,
    examined:d.examined,responseCalls:d.responseCalls,combinations:v2.diagnostics.combinations,latency,
    // Exact detached inputs and all three decisions for reproducible diagnosis.
    before,plans:Object.fromEntries(policies.map(p=>[p,{resolvedMoves:plans[p].resolvedMoves,diagnostics:plans[p].diagnostics}]))};
}
function summarize(rows){
  return {auditedTurns:rows.length,stages:rows.reduce((m,r)=>(m[r.stage]=(m[r.stage]||0)+1,m),{}),
    enemyCounts:rows.reduce((m,r)=>(m[r.enemies]=(m[r.enemies]||0)+1,m),{}),
    categories:rows.reduce((m,r)=>(m[r.category]=(m[r.category]||0)+1,m),{}),
    v3Changed:rows.filter(r=>r.v3Changed).length,v3Deviation:rows.filter(r=>r.v3Deviation).length,
    v4Changed:rows.filter(r=>r.v4Changed).length,v4Activated:rows.filter(r=>r.examined>0).length,
    v4ResponseCalls:rows.reduce((n,r)=>n+r.responseCalls,0),
    p95Ms:Object.fromEntries(policies.map(p=>[p,percentile(rows.map(r=>r.latency[p]),.95)]))};
}
(async()=>{
  const groups=[],rows=[],runs=[];
  for(const sourcePolicy of sourcePolicies)for(const strategy of strategies){
    const group=[];
    for(let seed=settings.startSeed;seed<settings.startSeed+settings.runsPerGroup;seed++){
      const events=[];
      const result=await simulate({seed,difficulty:"hardcore",strategy,enemyPolicy:sourcePolicy,maxActions:settings.maxActions,inputMs:settings.inputMs,diagnostics:true,onEnemyTurn:event=>events.push(event)});
      // Preserve the whole run's time distribution: evenly spaced indices,
      // including first and final enemy turn. No selecting for favorable outcomes.
      const count=Math.min(settings.maxAuditsPerRun,events.length);
      for(let i=0;i<count;i++){
        const index=count===1?0:Math.floor(i*(events.length-1)/(count-1));
        group.push(audit(events[index],sourcePolicy,strategy,index));
      }
      runs.push({sourcePolicy,...result,actualEnemyTurns:events.length,auditedTurns:count});
    }
    rows.push(...group);groups.push({sourcePolicy,strategy,...summarize(group)});
  }
  assert.equal(runs.length,60);
  assert.ok(rows.length>0&&rows.length<=60*settings.maxAuditsPerRun);
  assert.ok(runs.every(r=>r.unreachablePortals===0));
  const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const report={schemaVersion:1,revision,settings,sourcePolicies,strategies,policies,environment:{node:process.version,platform:process.platform,arch:process.arch},
    sourceHashes:Object.fromEntries(sourceFiles.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),
    summary:summarize(rows),groups,runs,rows};
  const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"audit.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({revision,settings,sourcePolicies,strategies,runs:runs.length,summary:report.summary,groups},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
