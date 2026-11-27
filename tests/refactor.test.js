"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { runMatrix } = require("../scripts/lab");
const BASELINE = "272661577b40c7654c7138f2fc808439570a6e4f";
const root = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "omm-baseline-"));

async function main() {
  for (const name of ["app/game.js", "scripts/lab.js"]) {
    const dest = path.join(temp, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const bytes = cp.execFileSync("git", ["show", BASELINE + ":" + name], { cwd: root, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(dest, bytes);
  }
  const baseline = require(path.join(temp, "scripts/lab.js"));
  const options = { runs: 10, startSeed: 777, maxActions: 160, inputMs: 1000 };
  const expected = await baseline.runMatrix({ ...options, revision: BASELINE });
  const actual = await runMatrix(options);
  assert.equal(actual.rows.length, 150);
  for (let i = 0; i < expected.rows.length; i++) {
    const row = expected.rows[i];
    assert.deepEqual(actual.rows[i], row, "Behavior drift: " + row.difficulty + "/" + row.strategy + "/" + row.seed);
  }
  assert.deepEqual(actual.groups, expected.groups);
  assert.deepEqual(actual.matchedComparisons, expected.matchedComparisons);
  console.log("Refactor parity PASS: 150 matched runs per engine, 300 simulations; rows, groups and comparisons identical.");
}
main().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
