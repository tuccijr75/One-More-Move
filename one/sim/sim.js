const MAX_TURNS = 200;
const DIFFICULTIES = {
  standard: { spawnFloor: 3 },
  hard: { spawnFloor: 3 },
  hardcore: { spawnFloor: 2 },
};

const rows = [];
rows.push("difficulty\tturn\tenemies\tspawned\tnextSpawnTurn\tintervalUsed");

for (const [name, config] of Object.entries(DIFFICULTIES)) {
  let enemies = 2;
  let nextSpawnTurn = 10;
  for (let turn = 0; turn <= MAX_TURNS; turn += 1) {
    let spawned = 0;
    const interval = Math.max(config.spawnFloor, Math.floor(10 - turn / 15));
    if (turn >= nextSpawnTurn) {
      enemies += 1;
      nextSpawnTurn += interval;
      spawned = 1;
    }
    rows.push(`${name}\t${turn}\t${enemies}\t${spawned}\t${nextSpawnTurn}\t${interval}`);
  }
}

console.log(rows.join("\n"));
