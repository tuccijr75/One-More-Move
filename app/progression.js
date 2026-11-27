"use strict";

/* Canonical stage transitions, completed-turn accounting and scheduled rewards. */
const OMMProgression = (() => {
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const generation = typeof module !== "undefined" && module.exports ? require("./generation.js") : OMMGeneration;
  const { WALL_MAX, WALL_ADD_EVERY_STAGES, getEffectiveConfig } = config;
  const { buildWalls, enemyCountForStage, spawnEnemy, computeNextPortalTurn, spawnPortalIfNeeded } = generation;

  function advanceStage(gameState, tuning) {
    gameState.stage++;
    gameState.portal = null;
    gameState.nextPortalAtTurn = computeNextPortalTurn(gameState.stage, gameState.turns);
    gameState.enemies = [];
    if (gameState.stage % WALL_ADD_EVERY_STAGES === 0) {
      gameState.wallCount = Math.min(WALL_MAX, gameState.wallCount + 1);
    }
    gameState.walls = buildWalls(gameState, gameState.wallCount);
    const target = enemyCountForStage(gameState.stage);
    for (let index = 0; index < target; index++) spawnEnemy(gameState);
    gameState.nextSpawnTurn = gameState.turns + tuning.initialSpawn;
    if (gameState.stage % 15 === 0 && !gameState.hasExtraLife) gameState.hasExtraLife = true;
  }

  function grantScheduledRewards(gameState) {
    if (gameState.turns > 0 && gameState.turns % 12 === 0) {
      const phase = Math.floor(gameState.turns / 12) % 3;
      if (phase === 0 && gameState.tokens.diag === 0) gameState.tokens.diag = 1;
      if (phase === 1 && gameState.tokens.wall === 0) gameState.tokens.wall = 1;
      if (phase === 2 && gameState.tokens.freeze === 0) gameState.tokens.freeze = 1;
    }
    if (gameState.turns > 0 && gameState.turns % 50 === 0 && gameState.tokens.timeFreeze === 0) {
      gameState.tokens.timeFreeze = 1;
    }
  }

  function finalizeTurn(gameState, tuning, { debugAssertPortal, onBest }) {
    gameState.turns++;
    spawnPortalIfNeeded(gameState, debugAssertPortal);
    grantScheduledRewards(gameState);

    if (gameState.turns > gameState.best) {
      gameState.best = gameState.turns;
      onBest(gameState);
    }

    if (gameState.turns >= gameState.nextSpawnTurn) {
      if (gameState.enemies.length < enemyCountForStage(gameState.stage)) spawnEnemy(gameState);
      const cfg = getEffectiveConfig(gameState.difficulty, gameState.stage, gameState.tuning);
      const interval = Math.max(cfg.spawnFloor, Math.floor(tuning.rampSpeed - gameState.turns / tuning.rampSpeed));
      gameState.nextSpawnTurn += Math.max(1, interval);
    }
  }

  return Object.freeze({ advanceStage, finalizeTurn });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMProgression;
