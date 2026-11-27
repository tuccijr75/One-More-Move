"use strict";
// Diagnostic corpus. Only the canonical JS runtime advances natural traces.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const cp=require("node:child_process");
const core=require("../app/game"),grid=require("../app/grid"),config=require("../app/config"),generation=require("../app/generation"),progression=require("../app/progression"),stateModule=require("../app/state");
const root=path.resolve(__dirname,"..");
const dirs=[[0,-1],[0,1],[-1,0],[1,0]];
const profiles=["standard","hard","hardcore"];
const seeds=Array.from({length:12},(_,i)=>90001+i);
const point=p=>p?{x:p.x,y:p.y}:null;
function view(s){
 return {player:point(s.player),walls:[...s.walls].sort(),enemies:s.enemies.map(e=>({id:e.id,x:e.x,y:e.y,stunned:e.stunned,intentX:e.intent?.dx??null,intentY:e.intent?.dy??null,intentLock:e.intentLock})),
 playerTrail:[...s.playerTrail],wallCount:s.wallCount,nextEnemyId:s.nextEnemyId,turns:s.turns,stage:s.stage,portal:point(s.portal),nextPortalTurn:s.nextPortalAtTurn,nextSpawnTurn:s.nextSpawnTurn,
 gameOver:s.gameOver,deathCause:s.deathCause??null,hasExtraLife:s.hasExtraLife,tokens:{...s.tokens},phaseUsed:s.phaseUsed,phaseArmed:s.phaseArmed,wallIgnoreArmed:s.wallIgnoreArmed,freezeNext:s.freezeNext,
 timeFreezeMovesRemaining:s.holdSpace?s.holdMovesLeft:0,cooldownUntil:s.rewardCooldownUntil};
}
function literal(v){
 if(v===null)return "nil";
 if(typeof v==="boolean")return String(v);
 if(typeof v==="number"){assert.ok(Number.isFinite(v));return String(v);}
 if(typeof v==="string")return JSON.stringify(v);
 if(Array.isArray(v))return "{"+v.map(literal).join(",")+"}";
 return "{"+Object.entries(v).filter(([,x])=>x!==null).map(([k,x])=>"["+literal(k)+"]="+literal(x)).join(",")+"}";
}
function policy(d){return d==="hardcore"?"tactical-v4":d==="hard"?"tactical-v2":"baseline";}
async function natural(seed,difficulty){
 const run=core.createHeadlessRun({seed,difficulty,enemyPolicy:policy(difficulty),inputMs:1000});
 let s=run.snapshot();const initial=view(s),steps=[];
 async function send(action){
   const at=s.clockMs+1000;
   const r=await run.dispatch(action);
   const command=action.type==="move"?action:action.name==="time-end"?{type:"endTimeFreeze"}:{type:"ability",ability:action.name==="time-start"?"time":action.name};
   s=r.state;steps.push({command,atMs:at,accepted:r.accepted,expected:view(s)});
 }
 for(let turn=0;turn<80&&!s.gameOver;turn++){
   // Exercise rejected input and initial Phase, then deterministic portal/escape seeking.
   if(turn===0){await send({type:"move",dx:2,dy:0});await send({type:"ability",name:"phase"});}
   if(!s.phaseArmed&&s.cooldownMs<=1000){
     if(s.tokens.freeze>0&&!s.freezeNext)await send({type:"ability",name:"freeze"});
     else if(s.tokens.timeFreeze>0&&!s.holdSpace)await send({type:"ability",name:"time-start"});
   }
   const walls=new Set(s.walls),enemies=new Set(s.enemies.map(grid.posKey));
   const choices=dirs.map(([dx,dy])=>({dx,dy,first:{x:s.player.x+dx,y:s.player.y+dy},target:{x:s.player.x+dx*(s.phaseArmed?2:1),y:s.player.y+dy*(s.phaseArmed?2:1)}})).filter(c=>grid.inBounds(c.target.x,c.target.y)&&!walls.has(grid.posKey(c.target))&&!walls.has(grid.posKey(c.first))&&!enemies.has(grid.posKey(c.target)));
   if(!choices.length){if(s.holdSpace){await send({type:"ability",name:"time-end"});continue;}break;}
   const score=c=>{const p=c.target;const clearance=s.enemies.length?Math.min(...s.enemies.map(e=>grid.manhattan(e,p))):20;
     const pd=s.portal?grid.shortestPathDist(p,s.portal,walls):0;
     return (s.portal&&grid.samePosition(p,s.portal)?10000:0)+clearance*5+grid.countEscapeOptionsAt({...s,walls},p,enemies,false)*3-(Number.isFinite(pd)?pd:1000)*8;};
   choices.sort((a,b)=>score(b)-score(a));await send({type:"move",dx:choices[0].dx,dy:choices[0].dy});
 }
 return {seed,difficulty,policy:policy(difficulty),initial,steps};
}
// Forced component chains deliberately bypass survival. Each stage input sets a
// portal at an adjacent legal tile and lets the canonical progression advance.
function forced(seed){
 const s=stateModule.initializeState(seed,"PARITY",{runId:1,difficulty:"standard",tuning:config.DEFAULT_TUNING,best:0});
 const initial=view(s),steps=[];
 for(let i=0;i<25;i++){
   s.turns=s.nextPortalAtTurn;generation.spawnPortalIfNeeded(s);assert.ok(s.portal);
   const portal=point(s.portal),occupied=new Set(s.enemies.map(grid.posKey));
   // Preserve JS-generated portal as an explicit input; generation itself is not compared in forced chains.
   const generated=view(s);
   const prior=grid.getNeighbors(portal).find(p=>grid.inBounds(p.x,p.y)&&!s.walls.has(grid.posKey(p))&&!occupied.has(grid.posKey(p)));
   if(!prior)break;
   s.player=portal;s.playerTrail=[grid.posKey(portal),...s.playerTrail].slice(0,2);
   progression.advanceStage(s,s.tuning);
   steps.push({generated,prior,expected:view(s)});
 }
 return {seed,initial,steps};
}
(async()=>{
 const naturalRuns=[];
 for(const d of profiles)for(const seed of seeds)naturalRuns.push(await natural(seed,d));
 const forcedRuns=seeds.map(forced);
 const corpus={schemaVersion:1,revision:cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),naturalRuns,forcedRuns};
 const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,"trace.json"),JSON.stringify(corpus,null,2)+"\n");
 fs.writeFileSync(path.join(dir,"TraceFixtures.lua"),"return "+literal(corpus)+"\n");
 console.log(JSON.stringify({naturalRuns:naturalRuns.length,naturalCommands:naturalRuns.reduce((n,r)=>n+r.steps.length,0),forcedRuns:forcedRuns.length,forcedTransitions:forcedRuns.reduce((n,r)=>n+r.steps.length,0)}));
})().catch(e=>{console.error(e);process.exitCode=1;});
