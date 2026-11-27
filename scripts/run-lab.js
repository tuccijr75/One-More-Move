"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const crypto=require("node:crypto");
const {runMatrix}=require("./lab");
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const m=/^--(runs|seed|max-actions|input-ms)=(\d+)$/.exec(arg);
  if(!m)throw new Error("Unknown argument: "+arg);
  return [m[1],Number(m[2])];
}));
(async()=>{
  const revision=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const report=await runMatrix({runs:args.runs??3,startSeed:args.seed??777,maxActions:args["max-actions"]??100,inputMs:args["input-ms"]??1000,revision});
  report.sourceHashes=Object.fromEntries(["app/grid.js","app/game.js","scripts/lab.js","scripts/run-lab.js"].map(name=>[name,crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname,"..",name))).digest("hex")]));
  const dir=path.resolve(__dirname,"../dist/lab");
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({revision,sourceHashes:report.sourceHashes,config:report.config,groups:report.groups,matchedComparisons:report.matchedComparisons,elapsedMs:report.elapsedMs},null,2));
  if(report.rows.some(x=>x.unreachablePortals>0))throw new Error("Unreachable portal observed");
})().catch(e=>{console.error(e);process.exitCode=1});
