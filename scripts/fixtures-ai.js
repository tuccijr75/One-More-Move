"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const ai=require("../app/ai");
const grid=require("../app/grid");
const config=require("../app/config");
const generation=require("../app/generation");
const progression=require("../app/progression");
const stateModule=require("../app/state");
const {simulate}=require("./lab");
const root=path.resolve(__dirname,"..");
const fixtures=[],ids=new Set();
const policies=["tactical-v2","tactical-v4"];
const tuning=config.DEFAULT_TUNING;
const enemyView=e=>({id:e.id,x:e.x,y:e.y,stunned:e.stunned,intentX:e.intent?.dx??null,intentY:e.intent?.dy??null,intentLock:e.intentLock});
const point=p=>p?{x:p.x,y:p.y}:null;
const jsonCopy=x=>JSON.parse(JSON.stringify(x));
function add(id,category,s,difficulty){
  assert.ok(!ids.has(id));ids.add(id);
  const state={...s,difficulty,walls:new Set(s.walls)};
  const cfg=config.getEffectiveConfig(difficulty,state.stage,state.tuning);
  const expected={};
  for(const policy of ["baseline",...policies]){
    const plan=policy==="baseline"?ai.planEnemyMovesForState(state,cfg,state.tuning):ai.planTacticalMovesForState(state,cfg,state.tuning,policy);
    assert.equal(plan.resolvedMoves.length,state.enemies.length);
    assert.equal(new Set(plan.resolvedMoves.map(grid.posKey)).size,state.enemies.length);
    expected[policy]={enemies:plan.resolvedMoves.map(enemyView),intentTiles:[...plan.intentTiles].sort(),diagnostics:jsonCopy(plan.diagnostics??null)};
  }
  const changed=JSON.stringify(expected["tactical-v2"].enemies.map(e=>[e.x,e.y,e.stunned]))!==JSON.stringify(expected["tactical-v4"].enemies.map(e=>[e.x,e.y,e.stunned]));
  if(difficulty!=="hardcore")assert.deepEqual(expected["tactical-v2"],expected["tactical-v4"]);
  if(difficulty==="standard")assert.deepEqual(expected.baseline.enemies,expected["tactical-v2"].enemies);
  fixtures.push({id,category,changed,stage:state.stage,difficulty,player:point(state.player),portal:point(state.portal),walls:[...state.walls].sort(),
    enemies:state.enemies.map(enemyView),allowDiagonalEscape:(state.tokens?.diag??0)>0,tuning:jsonCopy(state.tuning),config:jsonCopy(cfg),expected});
}
function make(seed,stage=1,settings=tuning){
  const s=stateModule.initializeState(seed,"FIXTURE",{runId:1,difficulty:"hardcore",tuning:settings,best:0});
  while(s.stage<stage){
    s.turns=s.nextPortalAtTurn;generation.spawnPortalIfNeeded(s);assert.ok(s.portal);
    s.player={...s.portal};s.playerTrail=[grid.posKey(s.player),...s.playerTrail].slice(0,2);
    progression.advanceStage(s,settings);
  }
  return s;
}
function synthetic(id,overrides){
  const s=make(1);Object.assign(s,{walls:new Set(),player:{x:5,y:5},portal:null,enemies:[],...overrides});
  for(const difficulty of ["standard","hard","hardcore"])add(id+"-"+difficulty,"constructed",s,difficulty);
}
function enemy(id,x,y,stunned=0,intent=null,intentLock=0){return {id,x,y,stunned,intent,intentLock};}
function literal(v){
  if(v===null)return "nil";
  if(typeof v==="boolean")return String(v);
  if(typeof v==="number"){assert.ok(Number.isFinite(v),"Nonfinite fixture number");return String(v);}
  if(typeof v==="string")return JSON.stringify(v);
  if(Array.isArray(v))return "{"+v.map(literal).join(",")+"}";
  return "{"+Object.entries(v).filter(([,x])=>x!==null).map(([k,x])=>"["+literal(k)+"]="+literal(x)).join(",")+"}";
}
(async()=>{
  // Explicit kill, stun, contested destination, portal, unreachable chase and tuning cases.
  synthetic("kill",{enemies:[enemy(0,5,4,0,{dx:1,dy:0},3),enemy(1,4,5)]});
  synthetic("stun",{enemies:[enemy(0,5,4,1),enemy(1,2,4)]});
  synthetic("collision",{enemies:[enemy(0,3,4),enemy(1,4,3)]});
  synthetic("portal",{enemies:[enemy(0,3,4),enemy(1,3,6)],portal:{x:6,y:5}});
  synthetic("blocked",{walls:new Set(["3,2","2,3","4,3","3,4"]),enemies:[enemy(0,3,3),enemy(1,7,7)]});
  synthetic("diagonal",{walls:new Set(["5,4","4,5"]),tokens:{diag:1},enemies:[enemy(0,3,3),enemy(1,8,6)]});
  synthetic("tuning",{stage:25,tuning:config.sanitizeTuning({...tuning,escapePenalty:3.5,gapFillBonus:5.5}),enemies:[enemy(0,3,4),enemy(1,3,6),enemy(2,8,8)]});
  for(const seed of [71001,71002,71003,71004,71005,71006])for(const stage of [1,6,11,16,21,25,100,105]){
    const s=make(seed,stage);
    s.turns=s.nextPortalAtTurn;generation.spawnPortalIfNeeded(s);assert.ok(s.portal);
    for(const difficulty of ["standard","hard","hardcore"])add("stage-"+seed+"-"+stage+"-"+difficulty,"forced-stage",s,difficulty);
  }
  // Use the audited source runs, preserving every changed sampled state and three
  // evenly spaced comparison states per run. This is a conformance corpus, not a
  // representative effect-size sample.
  let actualRuns=0,actualChanged=0,actualSampled=0;
  for(const sourcePolicy of ["tactical-v2","tactical-v3"])for(const strategy of ["greedy","defensive","tactical"]){
    for(let seed=50001;seed<=50010;seed++){
      const events=[];
      await simulate({seed,difficulty:"hardcore",strategy,enemyPolicy:sourcePolicy,maxActions:160,inputMs:1000,diagnostics:true,onEnemyTurn:e=>events.push(e)});
      actualRuns++;
      const count=Math.min(32,events.length);
      const controls=new Set([0,Math.floor((count-1)/2),count-1]);
      for(let i=0;i<count;i++){
        const index=count===1?0:Math.floor(i*(events.length-1)/(count-1));
        const s={...events[index].before,walls:new Set(events[index].before.walls)};
        const cfg=config.getEffectiveConfig(s.difficulty,s.stage,s.tuning);
        const a=ai.planTacticalMovesForState(s,cfg,s.tuning,"tactical-v2"),b=ai.planTacticalMovesForState(s,cfg,s.tuning,"tactical-v4");
        const geometry=p=>p.resolvedMoves.map(e=>[e.x,e.y,e.stunned]);
        const changed=JSON.stringify(geometry(a))!==JSON.stringify(geometry(b));
        if(!changed&&!controls.has(i))continue;
        add("actual-"+sourcePolicy+"-"+strategy+"-"+seed+"-"+index,changed?"actual-changed":"actual-control",s,"hardcore");
        actualSampled++;if(changed)actualChanged++;
      }
    }
  }
  assert.equal(actualRuns,60);
  assert.equal(actualChanged,32,"frozen audit changed-state count");
  assert.ok(fixtures.some(f=>f.stage>=100&&f.enemies.length===6&&f.walls.length===30));
  const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  const files=["app/ai.js","app/grid.js","app/config.js","app/generation.js","app/progression.js","app/state.js","app/game.js","scripts/lab.js","scripts/fixtures-ai.js"];
  const report={schemaVersion:1,revision,sourceHashes:Object.fromEntries(files.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),
    contract:{coordinates:"zero-based x/y",enemyOrder:"array order preserved; id never reindexed",wallEncoding:"x,y keys",intentEncoding:"nullable intentX/intentY",configuration:"explicit effective config and tuning; no recalculation by consumer",policyNames:["baseline",...policies]},
    summary:{fixtures:fixtures.length,actualRuns,actualSampled,actualChanged,constructed:fixtures.filter(f=>f.category==="constructed").length,forcedStage:fixtures.filter(f=>f.category==="forced-stage").length},fixtures};
  const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"ai-fixtures.json"),JSON.stringify(report,null,2)+"\n");
  fs.writeFileSync(path.join(dir,"AiFixtures.lua"),"-- Generated from frozen JavaScript oracle. Do not edit.\nreturn "+literal(report)+"\n");
  console.log(JSON.stringify({revision,summary:report.summary,fixtureSha256:crypto.createHash("sha256").update(JSON.stringify(fixtures)).digest("hex")},null,2));
})().catch(error=>{console.error(error);process.exitCode=1});
