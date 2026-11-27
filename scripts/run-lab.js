"use strict";
const fs=require("node:fs");
const path=require("node:path");
const cp=require("node:child_process");
const {runMatrix}=require("./lab");
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const m=/^--(runs|seed|max-actions|input-ms)=(\d+)$/.exec(arg);
  if(!m)throw new Error("Unknown argument: "+arg);
  return [m[1],Number(m[2])];
}));
(async()=>{
  const revision=process.env.GITHUB_SHA||cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  const report=await runMatrix({runs:args.runs??3,startSeed:args.seed??777,maxActions:args["max-actions"]??100,inputMs:args["input-ms"]??1000,revision});
  const dir=path.resolve(__dirname,"../dist/lab");
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"results.json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({revision,config:report.config,groups:report.groups,elapsedMs:report.elapsedMs},null,2));
  if(report.rows.some(x=>x.unreachablePortals>0))throw new Error("Unreachable portal observed");
})().catch(e=>{console.error(e);process.exitCode=1});
