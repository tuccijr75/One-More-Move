"use strict";
const core = require("../app/game.js");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");

const STRATEGIES = ["random", "greedy", "portal", "defensive", "tactical"];
const DIFFICULTIES = ["standard", "hard", "hardcore"];
const CARDINAL = [[0,-1],[-1,0],[1,0],[0,1]];
const DIAGONAL = [[-1,-1],[1,-1],[-1,1],[1,1]];
const inside = p => p.x >= 0 && p.y >= 0 && p.x < core.GRID_SIZE && p.y < core.GRID_SIZE;
const same = (a,b) => a && b && a.x === b.x && a.y === b.y;
const distance = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const move = (p,dx,dy,n=1) => ({x:p.x+dx*n,y:p.y+dy*n});

function view(snapshot) { return {...snapshot,walls:new Set(snapshot.walls)}; }

// Candidate policy, not a second engine. Every chosen command is checked by the
// canonical runtime. An unexpected rejection is a laboratory failure, not a death.
function candidates(s, abilities) {
  const result = [], ready = s.cooldownMs === 0;
  const enemies = new Set(s.enemies.map(core.posKey));
  const add = (dx,dy,destination,ability=null) => {
    if (!inside(destination)||enemies.has(core.posKey(destination))) return;
    result.push({dx,dy,destination,ability});
  };
  for(const [dx,dy] of CARDINAL) {
    const first=move(s.player,dx,dy);
    const second=move(s.player,dx,dy,2);
    if(!s.phaseArmed && inside(first)) {
      const wall=s.walls.has(core.posKey(first));
      if(!wall || s.wallIgnoreArmed) add(dx,dy,first);
      else if(abilities && ready && s.tokens.wall>0) add(dx,dy,first,"wall");
    }
    if((s.phaseArmed || (abilities && ready && !s.phaseUsed)) && inside(second) &&
       !s.walls.has(core.posKey(first)) && !s.walls.has(core.posKey(second))) {
      add(dx,dy,second,s.phaseArmed?null:"phase");
    }
  }
  if(!s.phaseArmed && ready && s.tokens.diag>0 && abilities) {
    for(const [dx,dy] of DIAGONAL) {
      const dest=move(s.player,dx,dy);
      if(!inside(dest)||s.walls.has(core.posKey(move(s.player,dx,0)))||
         s.walls.has(core.posKey(move(s.player,0,dy)))||
         (s.walls.has(core.posKey(dest))&&!s.wallIgnoreArmed)) continue;
      add(dx,dy,dest);
    }
  }
  return result;
}

function metrics(s,c,lookahead=false) {
  const enemies=new Set(s.enemies.map(core.posKey));
  const exits=core.countEscapeOptionsAt(s,c.destination,enemies,false);
  const portalDist=s.portal?core.shortestPathDist(c.destination,s.portal,s.walls):0;
  const clearance=s.enemies.length?Math.min(...s.enemies.map(e=>distance(e,c.destination))):20;
  const portal=same(c.destination,s.portal);
  let immediateRisk=0,nextExits=exits;
  if(lookahead && !portal) {
    const first=move(s.player,c.dx,c.dy);
    const phase=c.ability==="phase" || s.phaseArmed;
    const hypothetical={...s,player:c.destination,enemies:s.enemies.map(e=>
      phase&&same(e,first)?{...e,stunned:Math.max(e.stunned,1)}:{...e})};
    const plan=core.planEnemyMovesForState(hypothetical).resolvedMoves;
    const keys=new Set(plan.map(core.posKey));
    immediateRisk=Number(plan.some(e=>same(e,c.destination)&&e.stunned===0));
    nextExits=core.countEscapeOptionsAt(s,c.destination,keys,false);
  }
  return {...c,exits,portalDist,clearance,portal,immediateRisk,nextExits};
}

function choose(s, strategy, rng) {
  const tactical=strategy==="tactical", defensive=strategy==="defensive";
  const all=candidates(s,tactical);
  if(!all.length) return {candidate:null,proxy:null};
  if(strategy==="random") return {candidate:all[Math.floor(rng()*all.length)],proxy:null};
  const evaluated=all.map(c=>metrics(s,c,tactical||defensive));
  const score=c=>{
    if(c.portal)return 100000;
    if(strategy==="greedy")return c.exits*10+c.clearance;
    if(strategy==="portal")return -(Number.isFinite(c.portalDist)?c.portalDist:1000)*8+c.exits*3+c.clearance;
    if(defensive)return -c.immediateRisk*1000+c.nextExits*15+c.clearance*4;
    return -c.immediateRisk*1000+c.nextExits*14+c.clearance*3
      -(Number.isFinite(c.portalDist)?c.portalDist:1000)*4-(c.ability?5:0);
  };
  evaluated.sort((a,b)=>score(b)-score(a));
  return {candidate:evaluated[0],proxy:tactical||defensive?evaluated.every(c=>c.immediateRisk===1):null};
}

async function simulate({seed,difficulty,strategy,maxActions=160,inputMs=1000}) {
  const run=core.createHeadlessRun({seed,difficulty,inputMs});
  const policyRng=core.createRng((seed^0x85ebca6b)>>>0);
  const rewardUses={wall:0,phase:0,diag:0,freeze:0,timeFreeze:0};
  let actions=0,waits=0,portalSpawns=0,unreachablePortals=0,portalEntries=0;
  let riskSamples=0,allImmediateRisk=0,adjacentPressureSum=0,pressureSamples=0;
  let reason="action-cap",s=run.snapshot();
  const trajectory=createHash("sha256");
  function record(snapshot){
    // Ignore wall-clock and visual intent timing, but retain gameplay state and decisions.
    const { player,walls,enemies,turns,stage,portal,tokens,phaseUsed,phaseArmed,wallIgnoreArmed,freezeNext,holdSpace,holdMovesLeft,hasExtraLife,gameOver,deathCause }=snapshot;
    trajectory.update(JSON.stringify({player,walls,enemies:enemies.map(({id,x,y,stunned,intent,intentLock})=>({id,x,y,stunned,intent,intentLock})),turns,stage,portal,tokens,phaseUsed,phaseArmed,wallIgnoreArmed,freezeNext,holdSpace,holdMovesLeft,hasExtraLife,gameOver,deathCause})+"\n");
  }
  record(s);
  async function send(action){
    const result=await run.dispatch(action);
    if(!result.accepted)throw new Error("Policy command rejected: "+JSON.stringify({seed,difficulty,strategy,action,turn:s.turns,stage:s.stage}));
    if(action.type!=="wait")record(result.state);
    return result.state;
  }
  while(actions<maxActions&&!s.gameOver) {
    const previous=s;
    const decision=choose(view(s),strategy,policyRng);
    let c=decision.candidate;
    if(!c) {
      if(strategy==="tactical"&&s.cooldownMs>0&&core.hasPlayerEscape(view(s))) {
        s=await send({type:"wait",ms:s.cooldownMs});waits++;actions++;continue;
      }
      if(strategy==="tactical"&&s.holdSpace) {
        s=await send({type:"ability",name:"time-end"});actions++;continue;
      }
      reason=core.hasPlayerEscape(view(s))?"policy-no-route":"no-route";break;
    }
    if(decision.proxy!==null){riskSamples++;allImmediateRisk+=Number(decision.proxy);}
    if(strategy==="tactical"&&!c.ability&&!c.portal&&!(c.dx&&c.dy)&&c.immediateRisk&&s.cooldownMs===0&&!s.phaseArmed) {
      if(s.tokens.freeze>0&&!s.freezeNext){s=await send({type:"ability",name:"freeze"});rewardUses.freeze++;}
      else if(s.tokens.timeFreeze>0&&!s.holdSpace){s=await send({type:"ability",name:"time-start"});rewardUses.timeFreeze++;}
    }
    if(c.ability){s=await send({type:"ability",name:c.ability});rewardUses[c.ability]++;}
    if(c.dx&&c.dy)rewardUses.diag++;
    s=await send({type:"move",dx:c.dx,dy:c.dy});
    actions++;
    if(s.stage>previous.stage)portalEntries+=s.stage-previous.stage;
    if(s.portal&&(!previous.portal||s.stage!==previous.stage)) {
      portalSpawns++;
      if(!core.reachableTilesFrom(s.player,new Set(s.walls)).has(core.posKey(s.portal)))unreachablePortals++;
    }
    adjacentPressureSum+=s.enemies.filter(e=>distance(e,s.player)===1).length;
    pressureSamples++;
    if(new Set(s.enemies.map(core.posKey)).size!==s.enemies.length)throw new Error("Duplicate enemy position");
  }
  if(s.gameOver)reason=s.deathCause||"game-over";
  return {seed,difficulty,strategy,turns:s.turns,stage:s.stage,actions,clockMs:s.clockMs,
    outcome:reason,dead:s.gameOver,censored:!s.gameOver,waits,portalSpawns,portalEntries,unreachablePortals,rewardUses,
    riskSamples,allImmediateRisk,adjacentPressureSum,pressureSamples,trajectorySha256:trajectory.digest("hex")};
}
function quantile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.floor((sorted.length-1)*p)];
}
function summarize(rows){
  const portalReached=rows.filter(r=>r.portalEntries>0).length;
  const sum=(k)=>rows.reduce((a,b)=>a+b[k],0);
  return {runs:rows.length,deaths:rows.filter(x=>x.dead).length,censored:rows.filter(x=>x.censored).length,
    turns:{p10:quantile(rows.map(x=>x.turns),.1),median:quantile(rows.map(x=>x.turns),.5),p90:quantile(rows.map(x=>x.turns),.9),max:Math.max(...rows.map(x=>x.turns))},
    stages:{median:quantile(rows.map(x=>x.stage),.5),max:Math.max(...rows.map(x=>x.stage))},
    portalReached,portalSpawns:sum("portalSpawns"),portalEntries:sum("portalEntries"),unreachablePortals:sum("unreachablePortals"),
    immediateRiskProxy:{samples:sum("riskSamples"),allCandidatesIntercepted:sum("allImmediateRisk")},
    meanAdjacentPressure:sum("pressureSamples")?sum("adjacentPressureSum")/sum("pressureSamples"):null,
    rewardUses:Object.fromEntries(Object.keys(rows[0].rewardUses).map(k=>[k,rows.reduce((a,b)=>a+b.rewardUses[k],0)])),
    outcomes:rows.reduce((a,b)=>(a[b.outcome]=(a[b.outcome]||0)+1,a),{})};
}
function compareDifficulties(rows) {
  const results=[];
  for(const strategy of STRATEGIES)for(const [left,right] of [["standard","hard"],["hard","hardcore"],["standard","hardcore"]]){
    const a=rows.filter(r=>r.strategy===strategy&&r.difficulty===left);
    const bySeed=new Map(rows.filter(r=>r.strategy===strategy&&r.difficulty===right).map(r=>[r.seed,r]));
    const pairs=a.map(x=>[x,bySeed.get(x.seed)]);
    if(pairs.some(([,y])=>!y))throw new Error("Unmatched seed");
    const diffs=pairs.map(([x,y])=>y.turns-x.turns);
    results.push({strategy,left,right,pairs:pairs.length,
      shorter:pairs.filter(([x,y])=>y.turns<x.turns).length,
      equal:pairs.filter(([x,y])=>y.turns===x.turns).length,
      longer:pairs.filter(([x,y])=>y.turns>x.turns).length,
      medianObservedTurnDelta:quantile(diffs,.5),
      meanObservedTurnDelta:diffs.reduce((a,b)=>a+b,0)/pairs.length,
      stageChanged:pairs.filter(([x,y])=>x.stage!==y.stage).length,
      outcomeChanged:pairs.filter(([x,y])=>x.outcome!==y.outcome).length,
      trajectoryChanged:pairs.filter(([x,y])=>x.trajectorySha256!==y.trajectorySha256).length,
      bothDead:pairs.filter(([x,y])=>x.dead&&y.dead).length});
  }
  return results;
}
async function runMatrix({runs=3,startSeed=777,maxActions=100,inputMs=1000,revision="working-tree"}={}) {
  if(!Number.isInteger(runs)||runs<1||runs>10000||!Number.isInteger(startSeed)||startSeed<0||startSeed+runs-1>0xffffffff||
    !Number.isInteger(maxActions)||maxActions<1||maxActions>10000)throw new Error("Invalid experiment bounds");
  const started=performance.now(), rows=[], groups=[];
  for(const difficulty of DIFFICULTIES)for(const strategy of STRATEGIES){
    const group=[];
    for(let i=0;i<runs;i++)group.push(await simulate({seed:startSeed+i,difficulty,strategy,maxActions,inputMs}));
    rows.push(...group);groups.push({difficulty,strategy,...summarize(group)});
  }
  return {schemaVersion:2,revision,config:{runsPerGroup:runs,startSeed,maxActions,inputMs,settings:core.DEFAULT_TUNING,
    portalAccounting:"legacy-no-turn",clock:"deterministic-input-plus-engine-delay"},groups,matchedComparisons:compareDifficulties(rows),rows,
    elapsedMs:Math.round(performance.now()-started)};
}
module.exports={simulate,runMatrix,compareDifficulties,STRATEGIES,DIFFICULTIES};
