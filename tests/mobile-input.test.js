"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function element() {
  const listeners = {};
  return {
    listeners, dataset: {}, children: [], classList: { add() {}, toggle() {} },
    addEventListener(name, fn) { listeners[name] = fn; },
    setAttribute() {},
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 300 }; }
  };
}
const canvas = element(), container = element(), left = element();
left.dataset.move = "-1,0";
const commands = [], moves = [];
let state = { runId: 1, player: { x: 5, y: 5 }, tokens: { diag: 0, timeFreeze: 1 }, phaseUsed: false, holdSpace: false, holdMovesLeft: 2 };
const document = {
  getElementById: () => canvas,
  querySelector: () => container,
  querySelectorAll: selector => selector === "[data-move]" ? [left] : [],
  createElement: element,
  addEventListener() {}
};
const window = {
  __ommGetState: () => state,
  __ommMove(dx, dy) {
    moves.push([dx, dy]);
    if (state.holdSpace) state.holdMovesLeft--;
    return true;
  },
  __ommCommand(name) {
    commands.push(name);
    if (name === "time-start") { state.holdSpace = true; state.tokens.timeFreeze = 0; state.holdMovesLeft = 2; }
    if (name === "time-end") { state.holdSpace = false; state.holdMovesLeft = 2; }
    return true;
  },
  setInterval() {}
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app/touch-controls.js"), "utf8"), { document, window });
function tap(x, y, extra = {}) {
  canvas.listeners.pointerdown({ clientX: x, clientY: y, pointerType: "touch", isPrimary: true, preventDefault() {}, ...extra });
}
tap(165,165); assert.equal(moves.length, 0, "deadzone");
tap(195,195); assert.deepEqual(moves.pop(), [1,0], "cardinal fallback");
state.tokens.diag = 1;
tap(195,195); assert.deepEqual(moves.pop(), [1,1], "diagonal reward");
state.phaseArmed = true;
tap(195,195); assert.deepEqual(moves.pop(), [1,0], "phase cardinal");
state.phaseArmed = false;
tap(195,195,{isPrimary:false}); assert.equal(moves.length,0,"ignore secondary pointer");
left.listeners.click(); assert.deepEqual(moves.pop(),[-1,0],"direction button");
container.children.find(b => b.textContent === "Time Freeze").listeners.click();
assert.equal(state.holdSpace,true,"single-touch activation");
left.listeners.click(); assert.equal(state.holdSpace,true,"one move remains");
left.listeners.click(); assert.equal(state.holdSpace,false,"auto finalize after two moves");
assert.deepEqual(commands,["time-start","time-end"]);
console.log("Mobile input adapter regression checks passed.");
