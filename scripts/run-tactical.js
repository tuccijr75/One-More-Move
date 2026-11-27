"use strict";
const fs=require("node:fs");
const assert=require("node:assert/strict");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {runMatrix}=require("./lab");
const {matchedThresholds}=require("./survival");
const root=path.resolve(__dirname,"..");
const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const sourceFiles=["app/grid.js","app/ai.js","app/config.js","app/generation.js","app/movement.js","app/progression.js","app/state.js","app/storage.js","app/presentation.js","app/game.js","scripts/lab.js","scripts/run-tactical.js","scripts/survival.js"];
const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&!["--held-out","--containment","--adversarial","--v4-held-out"].includes(args[0])))throw Error("Usage: node scripts/run-tactical.js [--held-out|--containment|--adversarial|--v4-held-out]");
const containment=args[0]==="--containment",heldOut=args[0]==="--held-out",v4HeldOut=args[0]==="--v4-held-out",adversarial=args[0]==="--adversarial"||v4HeldOut;
const options={runs:heldOut||containment||v4HeldOut?100:30,startSeed:v4HeldOut?60001:adversarial?40001:containment?20001:heldOut?10001:777,maxActions:160,inputMs:1000,revision,diagnostics:true};
const thresholds=[15,30,50,80];
const experiment=v4HeldOut?"v4-held-out":adversarial?"adversarial":containment?"containment":heldOut?"held-out":"screening";
const referencePolicy=containment||adversarial?"tactical-v2":"baseline",candidatePolicy=adversarial?"tactical-v4":containment?"tactical-v3":"tactical-v2";
(async()=>{
  const baseline=await runMatrix({...options,enemyPolicy:referencePolicy});
  const candidate=await runMatrix({...options,enemyPolicy:candidatePolicy});
  const comparisons=baseline.groups.map(group=>{
    const a=baseline.rows.filter(r=>r.difficulty===group.difficulty&&r.strategy===group.strategy);
    const lookup=new Map(candidate.rows.filter(r=>r.difficulty===group.difficulty&&r.strategy===group.strategy).map(r=>[r.seed,r]));
    const pairs=a.map(x=>[x,lookup.get(x.seed)]);
    if(pairs.some(([,y])=>!y))throw Error("Unmatched candidate seed");
    const c=candidate.groups.find(g=>g.difficulty===group.difficulty&&g.strategy===group.strategy);
    return {difficulty:group.difficulty,strategy:group.strategy,pairs:pairs.length,
      baselineMedian:group.turns.median,candidateMedian:c.turns.median,
      shorter:pairs.filter(([x,y])=>y.turns<x.turns).length,equal:pairs.filter(([x,y])=>y.turns===x.turns).length,longer:pairs.filter(([x,y])=>y.turns>x.turns).length,
      geometryChanged:pairs.filter(([x,y])=>x.geometrySha256!==y.geometrySha256).length,
      baselineCensored:group.censored,candidateCensored:c.censored,
      baselinePortalReached:group.portalReached,candidatePortalReached:c.portalReached,
      thresholdBounds:matchedThresholds(a,pairs.map(([,y])=>y),thresholds)};
  });
  const difficultyBounds=[];
  for(const strategy of ["random","greedy","portal","defensive","tactical"]){
    for(const [left,right] of [["standard","hard"],["hard","hardcore"]]){
      const a=candidate.rows.filter(r=>r.strategy===strategy&&r.difficulty===left);
      const b=candidate.rows.filter(r=>r.strategy===strategy&&r.difficulty===right);
      difficultyBounds.push({strategy,left,right,thresholds:matchedThresholds(a,b,thresholds)});
    }
  }
  const control=comparisons.filter(r=>r.difficulty==="standard"||((containment||adversarial)&&r.difficulty==="hard"));
  if(control.some(r=>r.geometryChanged!==0||r.equal!==r.pairs||r.baselineCensored!==r.candidateCensored))throw Error("Unchanged control diverged");
  // Full control-row equality includes trajectory, outcomes, rewards and timing.
  const controlProfiles=containment||adversarial?["standard","hard"]:["standard"];
  assert.deepEqual(candidate.rows.filter(r=>controlProfiles.includes(r.difficulty)),baseline.rows.filter(r=>controlProfiles.includes(r.difficulty)),"Control rows diverged");
  const tacticalHardcore=comparisons.find(r=>r.strategy==="tactical"&&r.difficulty==="hardcore");
  const adjacent=difficultyBounds.find(r=>r.strategy==="tactical"&&r.left==="hard"&&r.right==="hardcore");
  // Predeclared descriptive gates: not statistical confidence or release approval.
  const evaluation=v4HeldOut?{controlRows:options.runs*5*controlProfiles.length,
    noWorseThanV2AtAllThresholds:tacticalHardcore.thresholdBounds.every(x=>x.deltaUpper<=0),
    improvementOverV2AtOneOrMoreThresholds:tacticalHardcore.thresholdBounds.some(x=>x.deltaUpper<0),
    harderThanHardAtAllThresholds:adjacent.thresholds.every(x=>x.deltaUpper<=0),
    harderThanHardAtOneOrMoreThresholds:adjacent.thresholds.some(x=>x.deltaUpper<0),
    tacticalShorterExceedsLonger:tacticalHardcore.shorter>tacticalHardcore.longer,
    tacticalCensoredNotIncreased:tacticalHardcore.candidateCensored<=tacticalHardcore.baselineCensored}:null;
  const report={schemaVersion:2,experiment,revision,referencePolicy,candidatePolicy,options,thresholds,difficultyBounds,evaluation,sourceHashes:Object.fromEntries(sourceFiles.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),baseline,candidate,comparisons};
  const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,v4HeldOut?"v4-held-out.json":adversarial?"adversarial.json":containment?"containment.json":heldOut?"held-out.json":"tactical.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({revision,experiment,referencePolicy,candidatePolicy,options,evaluation,tacticalCandidateBounds:tacticalHardcore.thresholdBounds,comparisons:comparisons.map(({thresholdBounds,...rest})=>rest),candidateDifficultyComparisons:candidate.matchedComparisons,tacticalThresholdBounds:difficultyBounds.filter(r=>r.strategy==="tactical"),baselineMs:baseline.elapsedMs,candidateMs:candidate.elapsedMs,unreachablePortals:[...baseline.rows,...candidate.rows].reduce((n,r)=>n+r.unreachablePortals,0)},null,2));
  if([...baseline.rows,...candidate.rows].some(r=>r.unreachablePortals))throw Error("Unreachable portal observed");
})().catch(error=>{console.error(error);process.exitCode=1});
