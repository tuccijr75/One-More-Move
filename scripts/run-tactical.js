"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {runMatrix}=require("./lab");
const root=path.resolve(__dirname,"..");
const revision=cp.execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const sourceFiles=["app/grid.js","app/ai.js","app/config.js","app/generation.js","app/movement.js","app/progression.js","app/state.js","app/storage.js","app/presentation.js","app/game.js","scripts/lab.js","scripts/run-tactical.js"];
const options={runs:30,startSeed:777,maxActions:160,inputMs:1000,revision,diagnostics:true};
(async()=>{
  const baseline=await runMatrix({...options,enemyPolicy:"baseline"});
  const candidate=await runMatrix({...options,enemyPolicy:"tactical-v1"});
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
      baselinePortalReached:group.portalReached,candidatePortalReached:c.portalReached};
  });
  const report={schemaVersion:1,revision,options,sourceHashes:Object.fromEntries(sourceFiles.map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.join(root,name))).digest("hex")])),baseline,candidate,comparisons};
  const dir=path.join(root,"dist/lab");fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"tactical.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({revision,options,comparisons,candidateDifficultyComparisons:candidate.matchedComparisons,baselineMs:baseline.elapsedMs,candidateMs:candidate.elapsedMs,unreachablePortals:[...baseline.rows,...candidate.rows].reduce((n,r)=>n+r.unreachablePortals,0)},null,2));
  if([...baseline.rows,...candidate.rows].some(r=>r.unreachablePortals))throw Error("Unreachable portal observed");
})().catch(error=>{console.error(error);process.exitCode=1});
