"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createClassList(initial = []) {
  const values = new Set(initial);
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
    classList: createClassList(["hidden"]),
    addEventListener() {},
    setAttribute() {},
    focus() {},
  };
}

function createBrowser() {
  const context2d = {
    clearRect() {}, fillRect() {}, strokeRect() {}, save() {}, restore() {},
    set fillStyle(value) {}, set strokeStyle(value) {}, set shadowColor(value) {},
    set shadowBlur(value) {}, set globalAlpha(value) {},
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
  let seed = 1000;
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
  const sandbox = {
    window: windowObject,
    document: { getElementById: (id) => elements.get(id) || null },
    crypto: {
      getRandomValues(values) {
        values[0] = seed++;
        return values;
      },
    },
    performance: { now: () => Date.now() },
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
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve("../app/grid.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(require.resolve("../app/ai.js"), "utf8"), sandbox);
  vm.runInContext(fs.readFileSync(require.resolve("../app/game.js"), "utf8"), sandbox);
  return { window: windowObject };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const browser = createBrowser();
  const api = browser.window;

  {
    const oldState = api.__ommGetState();
    oldState.walls.clear();
    oldState.player = { x: 5, y: 5 };
    oldState.enemies = [{ id: 0, x: 0, y: 0, phase: 0, stunned: 0, intent: null, intentLock: 0 }];
    assert.equal(api.__ommMove(1, 0), true);
    assert.equal(api.__ommCommand("new"), true);
    const newState = api.__ommGetState();
    await wait(260);
    assert.equal(api.__ommGetState(), newState, "restart must retain the new run object");
    assert.equal(newState.turns, 0, "stale enemy turn must not advance the restarted run");
    assert.equal(newState.inputLocked, false, "restarted run must remain unlocked");
  }

  {
    const state = api.__ommGetState();
    state.walls.clear();
    state.player = { x: 5, y: 5 };
    state.enemies = [{ id: 0, x: 0, y: 0, phase: 0, stunned: 0, intent: null, intentLock: 0 }];
    state.tokens.freeze = 1;
    state.rewardCooldownUntil = 0;
    assert.equal(api.__ommCommand("freeze"), true, "Freeze Turn should activate");
    assert.equal(state.freezeNext, true);
    assert.equal(api.__ommMove(1, 0), true);
    await wait(0);
    assert.equal(state.turns, 1, "Freeze Turn must still finalize the turn");
    assert.equal(state.enemies[0].x, 0, "Freeze Turn must prevent enemy movement");
    assert.equal(state.inputLocked, false, "Freeze Turn must release input");
  }

  {
    const state = api.__ommGetState();
    state.walls.clear();
    state.player = { x: 0, y: 0 };
    state.tokens.diag = 1;
    state.rewardCooldownUntil = 0;
    assert.equal(api.__ommMove(-1, -1), false, "invalid diagonal must be rejected");
    assert.equal(state.tokens.diag, 1, "invalid diagonal must not consume its reward");
    assert.equal(state.rewardCooldownUntil, 0, "invalid diagonal must not start cooldown");
  }

  {
    const state = api.__ommGetState();
    state.walls.clear();
    state.player = { x: 5, y: 5 };
    state.enemies = [{ id: 0, x: 6, y: 4, phase: 0, stunned: 0, intent: null, intentLock: 0 }];
    state.hasExtraLife = true;
    state.gameOver = false;
    state.inputLocked = false;
    assert.equal(api.__ommMove(1, 0), true);
    await wait(320);
    assert.equal(state.gameOver, false, "extra life must prevent game over");
    assert.equal(state.hasExtraLife, false, "extra life must be consumed once");
    assert.equal(state.inputLocked, false, "revival must not leave input locked");
    assert.notDeepEqual(state.player, { x: 6, y: 5 }, "revival must move the player away from the killer");
  }

  {
    const state = api.__ommGetState();
    state.walls.clear();
    state.enemies = [];
    state.player = { x: 5, y: 5 };
    state.portal = { x: 6, y: 5 };
    state.turns = 20;
    state.stage = 1;
    state.inputLocked = false;
    assert.equal(api.__ommMove(1, 0), true);
    assert.equal(state.stage, 2, "entering a portal must advance the stage");
    assert.ok(state.nextSpawnTurn > state.turns, "stage spawn pacing must reset relative to current turns");
    assert.equal(state.portal, null, "portal must clear on stage advance");
  }

  {
    api.__ommCommand("new");
    const state = api.__ommGetState();
    state.player = { x: 5, y: 5 };
    state.walls.clear();
    state.enemies = [];
    state.tokens.diag = 1;
    state.rewardCooldownUntil = Date.now() + 30000;
    const cooldown = state.rewardCooldownUntil;
    assert.equal(api.__ommMove(1, 1), false, "global cooldown must block diagonal reward");
    assert.equal(state.tokens.diag, 1, "blocked diagonal must preserve reward");
    assert.equal(state.rewardCooldownUntil, cooldown, "blocked diagonal must preserve cooldown");
    assert.equal(api.__ommMove(2, 0), false, "multi-tile input must not bypass movement rules");
    assert.equal(state.player.x, 5);
    assert.equal(state.player.y, 5);
    state.rewardCooldownUntil = 0;
    assert.equal(api.__ommMove(1, 1), true, "diagonal must work when cooldown has expired");
    assert.equal(state.tokens.diag, 0);
    await wait(260);
  }

  {
    api.__ommCommand("new");
    const state = api.__ommGetState();
    state.player = { x: 5, y: 5 };
    state.walls.clear();
    state.enemies = [];
    state.tokens.timeFreeze = 1;
    assert.equal(api.__ommCommand("time-start"), true);
    assert.equal(api.__ommCommand("time-end"), true);
    assert.equal(state.turns, 0, "ending Time Freeze before movement must not advance enemies");
    state.tokens.timeFreeze = 1;
    state.rewardCooldownUntil = 0;
    assert.equal(api.__ommCommand("time-start"), true);
    assert.equal(api.__ommMove(1, 0), true);
    assert.equal(state.holdMovesLeft, 1);
    assert.equal(api.__ommMove(1, 0), true);
    assert.equal(state.holdSpace, false, "engine must end Time Freeze after two accepted moves");
    assert.equal(api.__ommCommand("time-end"), false, "late release must not double-resolve");
    await wait(320);
    assert.equal(state.turns, 1, "two frozen moves must finalize one enemy turn");
    assert.equal(state.inputLocked, false);
  }

  {
    api.__ommCommand("new");
    const state = api.__ommGetState();
    state.player = { x: 5, y: 5 };
    state.walls = new Set(["5,5", "7,5", "6,4", "6,6"]);
    state.enemies = [];
    state.phaseUsed = true;
    state.tokens.wall = 1;
    assert.equal(api.__ommMove(1, 0), true);
    await wait(320);
    assert.equal(state.gameOver, false, "Wall Ignore can rescue an otherwise enclosed player");
    assert.equal(state.turns, 1);
    assert.equal(api.__ommCommand("wall"), true);
    assert.equal(api.__ommMove(1, 0), true);
    await wait(320);
    assert.equal(state.wallIgnoreArmed, false);
  }

  {
    api.__ommCommand("new");
    const state = api.__ommGetState();
    state.player = { x: 0, y: 0 };
    state.walls = new Set(["2,0", "0,2"]);
    state.enemies = [];
    assert.equal(api.__ommCommand("phase"), false, "must not arm Phase Step with no legal destination");
    assert.equal(state.phaseArmed, false);
    assert.equal(state.rewardCooldownUntil, 0, "rejected arming must not consume cooldown");
    assert.equal(api.__ommMove(1, 0), true, "ordinary movement remains possible");
    await wait(320);
  }

  console.log("One More Move asynchronous runtime tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
