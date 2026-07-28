"use strict";

const assert = require("node:assert/strict");
const core = require("../app/game.js");

function baseState(overrides = {}) {
  return {
    seed: 1,
    difficulty: "standard",
    tuning: { ...core.DEFAULT_TUNING },
    stage: 1,
    player: { x: 5, y: 5 },
    walls: new Set(),
    enemies: [],
    tokens: { diag: 0, wall: 0, freeze: 0, timeFreeze: 0 },
    ...overrides,
  };
}

{
  const a = core.createRng(12345);
  const b = core.createRng(12345);
  const seqA = Array.from({ length: 20 }, () => a());
  const seqB = Array.from({ length: 20 }, () => b());
  assert.deepEqual(seqA, seqB, "same seed must produce the same sequence");
}

{
  const state = baseState({
    player: { x: 5, y: 5 },
    enemies: [
      { id: 0, x: 5, y: 4, stunned: 0, intent: { dx: 1, dy: 0 }, intentLock: 3, phase: 0 },
      { id: 1, x: 4, y: 4, stunned: 0, intent: null, intentLock: 0, phase: 0 },
    ],
  });
  const plan = core.planEnemyMovesForState(state);
  assert.equal(plan.resolvedMoves[0].x, 5, "adjacent enemy must choose the kill tile");
  assert.equal(plan.resolvedMoves[0].y, 5, "intent lock must never override kill priority");
}

{
  const current = [
    { id: 0, x: 0, y: 0, stunned: 0 },
    { id: 1, x: 1, y: 0, stunned: 0 },
    { id: 2, x: 2, y: 0, stunned: 0 },
  ];
  const proposals = [
    { target: { x: 1, y: 0 }, rank: [0], nextEnemy: { ...current[0], x: 1, y: 0 } },
    { target: { x: 2, y: 0 }, rank: [0], nextEnemy: { ...current[1], x: 2, y: 0 } },
    { target: { x: 2, y: 1 }, rank: [0], nextEnemy: { ...current[2], x: 2, y: 1 } },
  ];
  const resolved = core.resolveEnemyDestinations(current, proposals);
  assert.equal(new Set(resolved.map(core.posKey)).size, resolved.length, "resolved enemies must have unique positions");
}

{
  const walls = new Set();
  for (let x = 0; x < 10; x++) walls.add(`${x},0`);
  const state = baseState({
    player: { x: 5, y: 5 },
    walls,
    enemies: [
      { id: 0, x: 5, y: 4, stunned: 0 },
      { id: 1, x: 4, y: 5, stunned: 0 },
    ],
  });
  const tile = core.chooseRevivalTile(state);
  assert.ok(tile, "a safe revival tile should be found");
  const enemyKeys = new Set(state.enemies.map(core.posKey));
  assert.ok(core.countEscapeOptionsAt(state, tile, enemyKeys, false) >= 2, "revival tile must have at least two cardinal escapes");
}

{
  const state = baseState({ rng: core.createRng(777), portal: null, player: { x: 5, y: 5 } });
  const walls = core.buildWalls(state, 30);
  const reachable = core.reachableTilesFrom(state.player, walls);
  assert.ok(reachable.size >= 35, "dense wall layouts must preserve a meaningful reachable region");
}

console.log("One More Move core tests passed.");
