const MAX_TURNS = 200;

const PRESETS = {
  standard: {
    spawnFloor: 3,
    initialEnemies: 2,
    initialSpawn: 10,
    rampSpeed: 15,
    earlyBias: 0,
  },
  hard: {
    spawnFloor: 3,
    initialEnemies: 3,
    initialSpawn: 9,
    rampSpeed: 15,
    earlyBias: 1,
  },
  hardcore: {
    spawnFloor: 2,
    initialEnemies: 4,
    initialSpawn: 8,
    rampSpeed: 15,
    earlyBias: 2,
  },
};

const rows = [];
rows.push("difficulty\tturn\tenemies\tspawned\tnextSpawnTurn\tintervalUsed");

for (const [name, cfg] of Object.entries(PRESETS)) {
  let enemies = cfg.initialEnemies;
  let nextSpawnTurn = cfg.initialSpawn;

  for (let turn = 0; turn <= MAX_TURNS; turn += 1) {
    let spawned = 0;

    const intervalRaw = Math.floor(cfg.initialSpawn - turn / cfg.rampSpeed) - cfg.earlyBias;
    const interval = Math.max(cfg.spawnFloor, intervalRaw);

    if (turn >= nextSpawnTurn) {
      enemies += 1;
      nextSpawnTurn += interval;
      spawned = 1;
    }

    rows.push(`${name}\t${turn}\t${enemies}\t${spawned}\t${nextSpawnTurn}\t${interval}`);
  }
}

console.log(rows.join("\n"));
