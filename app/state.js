"use strict";

/* Canonical initial run state; runtime owns active run identity and lifecycle. */
const OMMState = (() => {
  const generation = typeof module !== "undefined" && module.exports ? require("./generation.js") : OMMGeneration;
  const { createRng, buildWalls, spawnEnemy } = generation;

  function initializeState(seed, seedMode, { runId, difficulty, tuning, best }) {
    const gameState = {
      runId,
      seed: seed >>> 0,
      seedMode,
      difficulty,
      tuning: { ...tuning },
      rng: createRng(seed),
      player: { x: 5, y: 5 },
      playerTrail: [],
      walls: new Set(),
      wallCount: tuning.walls,
      enemies: [],
      nextEnemyId: 0,
      turns: 0,
      stage: 1,
      portal: null,
      nextPortalAtTurn: 15,
      nextSpawnTurn: tuning.initialSpawn,
      best,
      gameOver: false,
      inputLocked: false,
      holdSpace: false,
      holdMovesLeft: 2,
      holdStepsUsed: 0,
      rewardCooldownUntil: 0,
      hasExtraLife: false,
      phaseUsed: false,
      phaseArmed: false,
      wallIgnoreArmed: false,
      freezeNext: false,
      tokens: { diag: 0, wall: 0, freeze: 0, timeFreeze: 0 },
      effects: {
        intentTiles: null,
        freezeUntil: 0,
        killer: null,
        statusText: seedMode === "DAILY" ? "DAILY SEED" : "",
        statusUntil: 0,
        stageBannerUntil: 0,
      },
    };

    gameState.walls = buildWalls(gameState, gameState.wallCount);
    for (let index = 0; index < tuning.initialEnemies; index++) spawnEnemy(gameState);
    return gameState;
  }

  return Object.freeze({ initializeState });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMState;
