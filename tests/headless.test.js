"use strict";
const assert = require("node:assert/strict");
const core = require("../app/game.js");

async function trace() {
  const run = core.createHeadlessRun({ seed: 777, inputMs: 1000 });
  const start = run.snapshot();
  assert.deepEqual(start.player, { x: 5, y: 5 });
  assert.deepEqual(start.walls, ["1,1","1,6","2,7","5,0","5,9","6,0","6,3","6,7","7,8","9,7"]);
  assert.equal(start.turns, 0);
  assert.equal((await run.dispatch({type:"move",dx:2,dy:0})).accepted, false);
  assert.equal(run.snapshot().turns, 0);
  assert.equal((await run.dispatch({type:"wait",ms:30000})).accepted, true);
  assert.equal(run.snapshot().turns, 0);
  const action = {type:"move",dx:1,dy:0};
  const result = await run.dispatch(action);
  assert.equal(result.accepted, true);
  assert.equal(result.state.turns, 1);
  assert.equal(result.state.inputLocked, false);
  const saved = run.snapshot();
  saved.player.x = -1;
  assert.notEqual(run.snapshot().player.x, -1, "snapshot cannot mutate engine");
  return result.state;
}

(async () => {
  assert.deepEqual(await trace(), await trace(), "same seed and action trace must be deterministic");
  const old = core.createHeadlessRun({seed:1});
  const next = core.createHeadlessRun({seed:2,difficulty:"hardcore"});
  assert.throws(()=>old.snapshot(), /no longer active/);
  assert.equal(next.snapshot().difficulty,"hardcore");
  assert.throws(()=>core.createHeadlessRun({seed:-1}), /Invalid seed/);
  console.log("Canonical headless runtime tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
