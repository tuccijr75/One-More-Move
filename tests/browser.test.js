"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createClassList() {
  const values = new Set(["hidden"]);
  return {
    add: (...names) => names.forEach((name) => values.add(name)),
    remove: (...names) => names.forEach((name) => values.delete(name)),
    contains: (name) => values.has(name),
    toggle: (name, force) => {
      if (force === true) values.add(name);
      else if (force === false) values.delete(name);
      else if (values.has(name)) values.delete(name);
      else values.add(name);
    },
  };
}

function createElement(id) {
  return {
    id,
    value: "0",
    textContent: "",
    innerHTML: "",
    classList: createClassList(),
    addEventListener() {},
    setAttribute() {},
    focus() {},
  };
}

const context2d = {
  clearRect() {},
  fillRect() {},
  strokeRect() {},
  save() {},
  restore() {},
  set fillStyle(value) {},
  set strokeStyle(value) {},
  set shadowColor(value) {},
  set shadowBlur(value) {},
  set globalAlpha(value) {},
};

const ids = [
  "game", "turns", "best", "stage", "difficulty", "seed", "mode", "focus", "hud",
  "overlay", "final-turns", "death-cause", "final-seed", "final-mode", "stage-banner", "status",
  "settings", "settings-back", "settings-save", "settings-reset", "settings-profile",
  "set-wallCount", "set-wallCountNum", "set-initialEnemies", "set-initialEnemiesNum",
  "set-initialSpawn", "set-initialSpawnNum", "set-rampSpeed", "set-rampSpeedNum",
  "set-escapePenalty", "set-escapePenaltyNum", "set-gapFill", "set-gapFillNum",
];
const elements = new Map(ids.map((id) => [id, createElement(id)]));
elements.get("game").width = 600;
elements.get("game").height = 600;
elements.get("game").getContext = () => context2d;

const storage = new Map();
const windowObject = {
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  },
  addEventListener() {},
  requestAnimationFrame() {},
  prompt() { return null; },
  alert() {},
};
const documentObject = {
  getElementById: (id) => elements.get(id) || null,
};

const context = {
  window: windowObject,
  document: documentObject,
  crypto: {
    getRandomValues(values) {
      values[0] = 1234;
      return values;
    },
  },
  performance: { now: () => 1000 },
  console,
  Date,
  Math,
  Promise,
  Set,
  Map,
  Object,
  Array,
  Number,
  String,
  Boolean,
  Uint32Array,
  setTimeout,
  clearTimeout,
};

vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve("../app/game.js"), "utf8"), context);

assert.equal(typeof windowObject.__ommGetState, "function", "browser boot must expose state access");
assert.equal(typeof windowObject.__ommMove, "function", "browser boot must expose movement");
assert.equal(typeof windowObject.__ommCommand, "function", "browser boot must expose commands");
assert.equal(windowObject.__ommGetState().seed, 1234, "browser boot must create the initial run");

console.log("One More Move browser smoke test passed.");
