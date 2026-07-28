"use strict";

const assert = require("node:assert/strict");
const core = require("../app/game.js");

function sampleInt(rng, max) {
  return Math.floor(rng() * max);
}

for (let seed = 1; seed <= 1000; seed++) {
  const rng = core.createRng(seed);
  const state = {
    seed,
    difficulty: ["standard", "hard", "hardcore"][seed % 3],
    tuning: { ...core.DEFAULT_TUNING },
    stage: 1 + (seed % 30),
    player: { x: sampleInt(rng, 10), y: sampleInt(rng, 10) },
    walls: new Set(),
    enemies: [],
    tokens: { diag: seed % 2, wall: 0, freeze: 0, timeFreeze: 0 },
  };
  const occupied = new Set([core.posKey(state.player)]);
  while (state.walls.size < 12) {
    const key = `${sampleInt(rng, 10)},${sampleInt(rng, 10)}`;
    if (!occupied.has(key)) state.walls.add(key);
  }
  for (let index = 0; index < 6; index++) {
    let x;
    let y;
    let key;
    do {
      x = sampleInt(rng, 10);
      y = sampleInt(rng, 10);
      key = `${x},${y}`;
    } while (occupied.has(key) || state.walls.has(key));
    occupied.add(key);
    state.enemies.push({ id: index, x, y, stunned: 0, intent: null, intentLock: 0, phase: 0 });
  }

  const plan = core.planEnemyMovesForState(state);
  assert.equal(
    new Set(plan.resolvedMoves.map(core.posKey)).size,
    plan.resolvedMoves.length,
    `duplicate enemy at seed ${seed}`
  );

  for (const enemy of state.enemies) {
    if (Math.abs(enemy.x - state.player.x) + Math.abs(enemy.y - state.player.y) !== 1) continue;
    const playerKey = core.posKey(state.player);
    assert.ok(
      plan.resolvedMoves.some((moved) => core.posKey(moved) === playerKey),
      `adjacent kill missed at seed ${seed}`
    );
    break;
  }
}

for (let seed = 1; seed <= 1000; seed++) {
  const state = {
    seed,
    rng: core.createRng(seed),
    player: { x: 5, y: 5 },
    portal: null,
    walls: new Set(),
    enemies: [],
    tokens: { diag: 0, wall: 0, freeze: 0, timeFreeze: 0 },
  };
  const count = seed % 31;
  const walls = core.buildWalls(state, count);
  const reachable = core.reachableTilesFrom(state.player, walls);
  const minimum = Math.max(18, Math.floor((100 - count) * 0.5));
  assert.ok(reachable.size >= minimum || walls.size === 0, `weak wall layout at seed ${seed}`);
}

console.log("One More Move stress tests passed.");
