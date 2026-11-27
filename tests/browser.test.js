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
const gridSource = fs.readFileSync(require.resolve("../app/grid.js"), "utf8");
vm.runInContext(gridSource, context);
vm.runInContext(fs.readFileSync(require.resolve("../app/game.js"), "utf8"), context);

assert.equal(typeof windowObject.__ommGetState, "function", "browser boot must expose state access");
assert.equal(typeof windowObject.__ommMove, "function", "browser boot must expose movement");
assert.equal(typeof windowObject.__ommCommand, "function", "browser boot must expose commands");
assert.equal(windowObject.__ommGetState().seed, 1234, "browser boot must create the initial run");

// Isolate each boot to verify recovery without leaking globals between runs.
const source = fs.readFileSync(require.resolve("../app/game.js"), "utf8");
function bootWithStorage(raw, inaccessible = false) {
  const backing = new Map([["one-more-move-memory-v2", raw]]);
  const browser = {
    ...windowObject,
    localStorage: {
      getItem(key) { if (inaccessible) throw new Error("Storage blocked"); return backing.get(key) ?? null; },
      setItem(key, value) { if (inaccessible) throw new Error("Storage blocked"); backing.set(key, value); },
    },
  };
  const sandbox = vm.createContext({ ...context, window: browser });
  vm.runInContext(gridSource, sandbox);
  vm.runInContext(source, sandbox);
  return { api: browser, state: browser.__ommGetState(), backing };
}
{
  const { api, state } = bootWithStorage(JSON.stringify({
    difficulty: "constructor", settings: [], bestScores: { "standard:RUN": "not-a-score" }, muted: "false"
  }));
  assert.equal(state.difficulty, "standard", "inherited object names are not difficulty profiles");
  assert.equal(state.best, 0, "corrupt best score must fall back to zero");
  assert.equal(api.__ommCommand("difficulty", "toString"), false, "invalid difficulty command rejected");
}
{
  const { state } = bootWithStorage(JSON.stringify({
    difficulty: "hard", settings: {}, bestScores: { "hard:RUN": "42", "hard:NEW": -5 }
  }));
  assert.equal(state.difficulty, "hard");
  assert.equal(state.best, 42, "valid legacy numeric score is preserved");
}
for (const raw of ["{invalid", "null", "[]"]) {
  const { state } = bootWithStorage(raw);
  assert.equal(state.difficulty, "standard");
  assert.equal(state.best, 0);
}
{
  const { state } = bootWithStorage(null, true);
  assert.equal(state.difficulty, "standard", "blocked localStorage must not prevent boot");
}

console.log("One More Move browser smoke test passed.");
