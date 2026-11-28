"use strict";

/* Canonical player movement, Focus abilities and escape adjudication. */
const OMMMovement = (() => {
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const { posKey, samePosition, inBounds, getNeighbors, countEscapeOptionsAt } = grid;
  const { GLOBAL_COOLDOWN_MS } = config;

  // Escape adjudication includes held movement rewards; AI/spawn/revival geometry remains unchanged.
  function phaseDestination(gameState, dx, dy, enemyKeys) {
    if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
    const first = { x: gameState.player.x + dx, y: gameState.player.y + dy };
    const second = { x: first.x + dx, y: first.y + dy };
    if (!inBounds(first.x, first.y) || !inBounds(second.x, second.y)) return null;
    if (gameState.walls.has(posKey(first)) || gameState.walls.has(posKey(second))) return null;
    return enemyKeys.has(posKey(second)) ? null : { first, second };
  }

  function hasPhaseDestination(gameState, enemyKeys) {
    return getNeighbors(gameState.player).some(next =>
      phaseDestination(gameState, next.x - gameState.player.x, next.y - gameState.player.y, enemyKeys));
  }

  function hasPlayerEscape(gameState, enemyKeys = new Set(gameState.enemies.map(posKey))) {
    // An armed Phase Step requires a two-cell cardinal move.
    if (gameState.phaseArmed) return hasPhaseDestination(gameState, enemyKeys);
    if (countEscapeOptionsAt(gameState, gameState.player, enemyKeys, true) > 0) return true;
    // Cooldown is wall-clock time: a held reward may become usable without an enemy turn.
    if (gameState.wallIgnoreArmed || gameState.tokens.wall > 0) {
      if (getNeighbors(gameState.player).some(next =>
        inBounds(next.x, next.y) && !enemyKeys.has(posKey(next)) && gameState.walls.has(posKey(next)))) return true;
    }
    if (gameState.wallIgnoreArmed && gameState.tokens.diag > 0) {
      const { x, y } = gameState.player;
      for (const dx of [-1, 1]) {
        for (const dy of [-1, 1]) {
          const destination = { x: x + dx, y: y + dy };
          if (inBounds(destination.x, destination.y) && !enemyKeys.has(posKey(destination)) &&
              !gameState.walls.has(posKey({ x: x + dx, y })) &&
              !gameState.walls.has(posKey({ x, y: y + dy }))) return true;
        }
      }
    }
    return !gameState.phaseUsed && hasPhaseDestination(gameState, enemyKeys);
  }

  function createMovement({ getState, performanceNow, setStatus, updateHud, playMoveSound, handleDeath, advanceStage, queueTurn }) {
    function movePlayer(gameState, destination) {
      gameState.player = destination;
      gameState.playerTrail.unshift(posKey(destination));
      gameState.playerTrail = gameState.playerTrail.slice(0, 2);
    }

    function attemptMove(dx, dy) {
      const gameState = getState();
      if (!gameState || gameState.gameOver || gameState.inputLocked) return false;
      if (gameState.holdSpace && gameState.holdMovesLeft <= 0) return false;
      if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;

      if (gameState.phaseArmed) {
        const destination = phaseDestination(gameState, dx, dy, new Set(gameState.enemies.map(posKey)));
        if (!destination) return false;
        const { first, second } = destination;

        const phasedEnemy = gameState.enemies.find((enemy) => samePosition(enemy, first));
        if (phasedEnemy) phasedEnemy.stunned = Math.max(phasedEnemy.stunned, 1);
        gameState.phaseArmed = false;
        gameState.phaseUsed = true;
        movePlayer(gameState, second);
        playMoveSound();
        return completePlayerMove(gameState);
      }

      const isDiagonal = dx !== 0 && dy !== 0;
      if (isDiagonal && (gameState.tokens.diag <= 0 || !abilityReady(gameState))) return false;
      const destination = { x: gameState.player.x + dx, y: gameState.player.y + dy };
      if (!inBounds(destination.x, destination.y)) return false;

      if (isDiagonal) {
        const horizontal = posKey({ x: destination.x, y: gameState.player.y });
        const vertical = posKey({ x: gameState.player.x, y: destination.y });
        if (gameState.walls.has(horizontal) || gameState.walls.has(vertical)) return false;
      }

      const destinationKey = posKey(destination);
      const usesWallIgnore = gameState.walls.has(destinationKey) && gameState.wallIgnoreArmed;
      if (gameState.walls.has(destinationKey) && !usesWallIgnore) return false;

      if (isDiagonal) {
        gameState.tokens.diag = 0;
        startGlobalCooldown(gameState);
      }
      if (usesWallIgnore) gameState.wallIgnoreArmed = false;

      movePlayer(gameState, destination);
      const steppedEnemy = gameState.enemies.find((enemy) => samePosition(enemy, destination));
      if (steppedEnemy) {
        handleDeath(gameState, "Intercepted.", steppedEnemy);
        return true;
      }

      playMoveSound();
      return completePlayerMove(gameState);
    }

    function completePlayerMove(gameState) {
      if (gameState.portal && samePosition(gameState.player, gameState.portal)) {
        advanceStage(gameState);
        return true;
      }

      if (gameState.holdSpace) {
        gameState.holdMovesLeft--;
        gameState.holdStepsUsed++;
        if (gameState.holdMovesLeft === 0) endTimeFreeze();
        else updateHud();
        return true;
      }

      queueTurn(gameState);
      return true;
    }

    function startGlobalCooldown(gameState) {
      gameState.rewardCooldownUntil = performanceNow() + GLOBAL_COOLDOWN_MS;
    }

    function abilityReady(gameState) {
      if (performanceNow() >= gameState.rewardCooldownUntil) return true;
      const seconds = Math.ceil((gameState.rewardCooldownUntil - performanceNow()) / 1000);
      setStatus(gameState, `ABILITY COOLDOWN ${seconds}s`, 900);
      return false;
    }

    function activateWallIgnore() {
      const gameState = getState();
      if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.tokens.wall <= 0 || gameState.wallIgnoreArmed) return false;
      if (!abilityReady(gameState)) return false;
      gameState.tokens.wall = 0;
      gameState.wallIgnoreArmed = true;
      startGlobalCooldown(gameState);
      updateHud();
      return true;
    }

    function activateFreezeTurn() {
      const gameState = getState();
      if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.tokens.freeze <= 0 || gameState.freezeNext) return false;
      if (!abilityReady(gameState)) return false;
      gameState.tokens.freeze = 0;
      gameState.freezeNext = true;
      startGlobalCooldown(gameState);
      updateHud();
      return true;
    }

    function activatePhaseStep() {
      const gameState = getState();
      if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.phaseUsed || gameState.phaseArmed) return false;
      if (!abilityReady(gameState)) return false;
      if (!hasPhaseDestination(gameState, new Set(gameState.enemies.map(posKey)))) {
        setStatus(gameState, "NO PHASE ROUTE", 900);
        return false;
      }
      gameState.phaseArmed = true;
      startGlobalCooldown(gameState);
      updateHud();
      return true;
    }

    function beginTimeFreeze() {
      const gameState = getState();
      if (!gameState || gameState.gameOver || gameState.inputLocked || gameState.holdSpace || gameState.tokens.timeFreeze <= 0) return false;
      if (!abilityReady(gameState)) return false;
      gameState.tokens.timeFreeze = 0;
      gameState.holdSpace = true;
      gameState.holdMovesLeft = 2;
      gameState.holdStepsUsed = 0;
      startGlobalCooldown(gameState);
      updateHud();
      return true;
    }

    function endTimeFreeze() {
      const gameState = getState();
      if (!gameState || !gameState.holdSpace) return false;
      gameState.holdSpace = false;
      const used = gameState.holdStepsUsed;
      gameState.holdMovesLeft = 2;
      gameState.holdStepsUsed = 0;
      updateHud();
      if (used > 0 && !gameState.gameOver) queueTurn(gameState);
      return true;
    }

    return Object.freeze({ attemptMove, activateWallIgnore, activateFreezeTurn, activatePhaseStep, beginTimeFreeze, endTimeFreeze });
  }

  return Object.freeze({ createMovement, hasPlayerEscape });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMMovement;
