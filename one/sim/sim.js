const MAX_TURNS = 200;
let turns = 0;
let enemies = 2;
let nextSpawnTurn = 10;

const rows = [];
rows.push("turn\tenemies\tspawned?\tnextSpawnTurn\tnextInterval");

for (let turn = 0; turn <= MAX_TURNS; turn += 1) {
  turns = turn;
  let spawned = "no";
  const interval = Math.max(3, Math.floor(10 - turns / 15));
  if (turns >= nextSpawnTurn) {
    enemies += 1;
    nextSpawnTurn += interval;
    spawned = "yes";
  }
  rows.push(`${turn}\t${enemies}\t${spawned}\t${nextSpawnTurn}\t${interval}`);
}

console.log(rows.join("\n"));
