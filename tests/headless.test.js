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
  const untraced = core.createHeadlessRun({seed:777});
  const expected = await untraced.dispatch({type:"move",dx:1,dy:0});
  assert.equal(Object.hasOwn(expected,"enemyTurn"),false);
  const traced = core.createHeadlessRun({seed:777,traceEnemyTurns:true});
  const result = await traced.dispatch({type:"move",dx:1,dy:0});
  assert.deepEqual(result.state,expected.state,"trace must not affect state");
  assert.equal(result.enemyTurn.before.turns,0);
  assert.deepEqual(result.enemyTurn.before.player,{x:6,y:5});
  const before=result.enemyTurn.before;
  const replay=core.planEnemyMovesForState({...before,walls:new Set(before.walls)});
  assert.deepEqual(replay.resolvedMoves,result.enemyTurn.resolvedMoves,"trace captures exact planning input");
  result.enemyTurn.before.player.x=-100;
  result.enemyTurn.resolvedMoves[0].x=-100;
  assert.deepEqual(traced.snapshot(),expected.state,"trace cannot mutate runtime");
  assert.equal((await traced.dispatch({type:"wait",ms:1})).enemyTurn,null,"wait must not repeat previous trace");
  assert.equal((await traced.dispatch({type:"move",dx:2,dy:0})).enemyTurn,null,"rejected move must not repeat trace");
  assert.throws(()=>core.createHeadlessRun({seed:1,traceEnemyTurns:"yes"}),/Invalid enemy trace flag/);
  const old = core.createHeadlessRun({seed:1});
  const next = core.createHeadlessRun({seed:2,difficulty:"hardcore"});
  assert.throws(()=>old.snapshot(), /no longer active/);
  assert.equal(next.snapshot().difficulty,"hardcore");
  assert.throws(()=>core.createHeadlessRun({seed:-1}), /Invalid seed/);
  console.log("Canonical headless runtime tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
