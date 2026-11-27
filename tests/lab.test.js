"use strict";
const assert=require("node:assert/strict");
const {simulate,runMatrix}=require("../scripts/lab");
(async()=>{
  const a=await simulate({seed:777,difficulty:"standard",strategy:"tactical",maxActions:25});
  const b=await simulate({seed:777,difficulty:"standard",strategy:"tactical",maxActions:25});
  assert.deepEqual(a,b,"simulation policy must be reproducible");
  const r=await runMatrix({runs:1,maxActions:20,revision:"test"});
  assert.equal(r.rows.length,15);
  assert.equal(r.groups.length,15);
  assert.equal(r.matchedComparisons.length,15);
  assert.ok(r.matchedComparisons.every(x=>x.pairs===1 && x.shorter+x.equal+x.longer===x.pairs));
  assert.ok(r.rows.every(x=>/^[a-f0-9]{64}$/.test(x.trajectorySha256)));
  assert.ok(r.rows.every(x=>x.actions<=20 && x.unreachablePortals===0));
  assert.ok(r.groups.every(x=>x.deaths+x.censored===x.runs));
  console.log("Laboratory reproducibility tests passed.");
})().catch(e=>{console.error(e);process.exitCode=1});
