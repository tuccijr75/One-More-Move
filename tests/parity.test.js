"use strict";

const assert = require("node:assert/strict");
const core = require("../app/game.js");

const expectedWalls = [
  { x: 5, y: 0 },
  { x: 6, y: 0 },
  { x: 1, y: 1 },
  { x: 6, y: 3 },
  { x: 1, y: 6 },
  { x: 2, y: 7 },
  { x: 6, y: 7 },
  { x: 9, y: 7 },
  { x: 7, y: 8 },
  { x: 5, y: 9 },
];

const expectedEnemies = [
  { x: 9, y: 9 },
  { x: 3, y: 0 },
];

const state = core.initializeState(777, "PARITY");
const walls = [...state.walls]
  .map((key) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  })
  .sort((left, right) => left.y - right.y || left.x - right.x);
const enemies = state.enemies.map(({ x, y }) => ({ x, y }));

assert.deepEqual(walls, expectedWalls, "canonical seed 777 wall fixture changed");
assert.deepEqual(enemies, expectedEnemies, "canonical seed 777 enemy fixture changed");

console.log("One More Move JavaScript seed parity fixture passed.");
