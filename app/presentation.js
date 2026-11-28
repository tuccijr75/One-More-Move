"use strict";

/* Browser presentation, keyboard input, settings, canvas rendering and audio. */
const OMMPresentation = (() => {
  const grid = typeof module !== "undefined" && module.exports ? require("./grid.js") : OMMGrid;
  const config = typeof module !== "undefined" && module.exports ? require("./config.js") : OMMConfig;
  const { manhattan } = grid;
  const { SETTINGS_VERSION, DEFAULT_TUNING, getEffectiveConfig } = config;
  const CELL_SIZE = 60;

  function createPresentation({ hasDOM, getState, getDifficulty, getTuning, getMuted, saveTuning, performanceNow, runCommand, attemptMove }) {
    let ui = null;
    let audioContext = null;
    let animationRunning = false;

    function cacheUI() {
      ui = {
        canvas: document.getElementById("game"),
        ctx: document.getElementById("game")?.getContext("2d") || null,
        turns: document.getElementById("turns"),
        best: document.getElementById("best"),
        stage: document.getElementById("stage"),
        difficulty: document.getElementById("difficulty"),
        seed: document.getElementById("seed"),
        mode: document.getElementById("mode"),
        focus: document.getElementById("focus"),
        hud: document.getElementById("hud"),
        overlay: document.getElementById("overlay"),
        finalTurns: document.getElementById("final-turns"),
        deathCause: document.getElementById("death-cause"),
        finalSeed: document.getElementById("final-seed"),
        finalMode: document.getElementById("final-mode"),
        stageBanner: document.getElementById("stage-banner"),
        status: document.getElementById("status"),
        settings: document.getElementById("settings"),
        settingsBack: document.getElementById("settings-back"),
        settingsSave: document.getElementById("settings-save"),
        settingsReset: document.getElementById("settings-reset"),
        settingsProfile: document.getElementById("settings-profile"),
        controls: {
          walls: document.getElementById("set-wallCount"),
          wallsNum: document.getElementById("set-wallCountNum"),
          enemies: document.getElementById("set-initialEnemies"),
          enemiesNum: document.getElementById("set-initialEnemiesNum"),
          spawn: document.getElementById("set-initialSpawn"),
          spawnNum: document.getElementById("set-initialSpawnNum"),
          ramp: document.getElementById("set-rampSpeed"),
          rampNum: document.getElementById("set-rampSpeedNum"),
          escape: document.getElementById("set-escapePenalty"),
          escapeNum: document.getElementById("set-escapePenaltyNum"),
          gap: document.getElementById("set-gapFill"),
          gapNum: document.getElementById("set-gapFillNum"),
        },
      };
    }

    function bindRangePair(range, number) {
      if (!range || !number) return;
      range.addEventListener("input", () => { number.value = range.value; });
      number.addEventListener("input", () => { range.value = number.value; });
    }

    function bindUI() {
      const controls = ui.controls;
      bindRangePair(controls.walls, controls.wallsNum);
      bindRangePair(controls.enemies, controls.enemiesNum);
      bindRangePair(controls.spawn, controls.spawnNum);
      bindRangePair(controls.ramp, controls.rampNum);
      bindRangePair(controls.escape, controls.escapeNum);
      bindRangePair(controls.gap, controls.gapNum);
      ui.settingsBack?.addEventListener("click", closeSettings);
      ui.settingsSave?.addEventListener("click", persistSettingsFromUI);
      ui.settingsReset?.addEventListener("click", resetSettings);
      ui.canvas?.addEventListener("click", () => ui.canvas.focus());
      window.addEventListener("keydown", handleKeyDown);
      window.addEventListener("keyup", handleKeyUp);
    }

    function handleKeyDown(event) {
      const key = event.key.toLowerCase();
      const blocked = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " ", "escape"];
      if (blocked.includes(key)) event.preventDefault();

      if (key === "escape" && ui.settings && !ui.settings.classList.contains("hidden")) return closeSettings();
      if (key === "r") return runCommand("restart");
      if (key === "n") return runCommand("new");
      if (key === "y") return runCommand("daily");
      if (key === "m") return runCommand("manual");
      if (key === "x") return runCommand("settings");
      if (key === "1") return runCommand("difficulty", "standard");
      if (key === "2") return runCommand("difficulty", "hard");
      if (key === "3") return runCommand("difficulty", "hardcore");
      if (key === "v") return runCommand("wall");
      if (key === "b") return runCommand("freeze");
      if (key === "f") return runCommand("phase");
      if (event.key === " " && !event.repeat) return runCommand("time-start");

      if (key === "w" || key === "arrowup") return attemptMove(0, -1);
      if (key === "s" || key === "arrowdown") return attemptMove(0, 1);
      if (key === "a" || key === "arrowleft") return attemptMove(-1, 0);
      if (key === "d" || key === "arrowright") return attemptMove(1, 0);
      if (key === "q") return attemptMove(-1, -1);
      if (key === "e") return attemptMove(1, -1);
      if (key === "z") return attemptMove(-1, 1);
      if (key === "c") return attemptMove(1, 1);
      return false;
    }

    function handleKeyUp(event) {
      if (event.key === " ") runCommand("time-end");
    }

    function openSettings() {
      const state = getState();
      const difficulty = getDifficulty();
      const tuning = getTuning();
      if (!ui?.settings) return;
      if (state && !state.gameOver) {
        setStatus(state, "SETTINGS AVAILABLE AFTER RUN", 1200);
        return;
      }
      const controls = ui.controls;
      controls.walls.value = controls.wallsNum.value = tuning.walls;
      controls.enemies.value = controls.enemiesNum.value = tuning.initialEnemies;
      controls.spawn.value = controls.spawnNum.value = tuning.initialSpawn;
      controls.ramp.value = controls.rampNum.value = tuning.rampSpeed;
      controls.escape.value = controls.escapeNum.value = tuning.escapePenalty;
      controls.gap.value = controls.gapNum.value = tuning.gapFillBonus;
      if (ui.settingsProfile) ui.settingsProfile.textContent = difficulty.toUpperCase();
      ui.settings.classList.remove("hidden");
      ui.settings.setAttribute("aria-hidden", "false");
    }

    function closeSettings() {
      if (!ui?.settings) return;
      ui.settings.classList.add("hidden");
      ui.settings.setAttribute("aria-hidden", "true");
    }

    function persistSettingsFromUI() {
      const controls = ui.controls;
      saveTuning({
        version: SETTINGS_VERSION,
        walls: controls.wallsNum.value,
        initialEnemies: controls.enemiesNum.value,
        initialSpawn: controls.spawnNum.value,
        rampSpeed: controls.rampNum.value,
        escapePenalty: controls.escapeNum.value,
        gapFillBonus: controls.gapNum.value,
      });
      closeSettings();
    }

    function resetSettings() {
      saveTuning({ ...DEFAULT_TUNING });
      openSettings();
    }

    function updateHud() {
      const state = getState();
      const difficulty = getDifficulty();
      if (!ui || !state) return;
      ui.turns.textContent = String(state.turns);
      ui.best.textContent = String(state.best);
      ui.stage.textContent = String(state.stage);
      ui.difficulty.textContent = difficulty.toUpperCase();
      ui.seed.textContent = `Seed ${state.seed}`;
      ui.mode.textContent = String(state.seedMode).toUpperCase();
      if (ui.focus) {
        ui.focus.innerHTML = [
          `<span>D ${state.tokens.diag}</span>`,
          `<span>W ${state.tokens.wall}</span>`,
          `<span>F ${state.phaseUsed ? 0 : 1}</span>`,
          `<span>B ${state.tokens.freeze}</span>`,
          `<span>TF ${state.holdSpace ? state.holdMovesLeft : state.tokens.timeFreeze ? 2 : 0}</span>`,
          `<span>L ${state.hasExtraLife ? 1 : 0}</span>`,
        ].join("");
      }
    }

    function setStatus(gameState, text, duration) {
      gameState.effects.statusText = text;
      gameState.effects.statusUntil = performanceNow() + duration;
      if (ui?.status) {
        ui.status.textContent = text;
        ui.status.classList.remove("hidden");
      }
    }

    function showStageBanner(stage) {
      if (!ui?.stageBanner) return;
      ui.stageBanner.textContent = `STAGE ${stage}`;
      ui.stageBanner.classList.remove("hidden");
    }

    function showOverlay(cause) {
      const state = getState();
      if (!ui || !state) return;
      ui.finalTurns.textContent = `Turns Survived: ${state.turns}`;
      ui.deathCause.textContent = cause;
      ui.finalSeed.textContent = `Seed: ${state.seed}`;
      ui.finalMode.textContent = `Mode: ${state.seedMode}`;
      ui.overlay.classList.remove("hidden");
    }

    function hideOverlay() {
      ui?.overlay?.classList.add("hidden");
    }

    function drawTile(x, y, color) {
      const padding = 4;
      ui.ctx.fillStyle = color;
      ui.ctx.fillRect(x * CELL_SIZE + padding, y * CELL_SIZE + padding, CELL_SIZE - padding * 2, CELL_SIZE - padding * 2);
      ui.ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ui.ctx.strokeRect(x * CELL_SIZE + padding + 0.5, y * CELL_SIZE + padding + 0.5, CELL_SIZE - padding * 2 - 1, CELL_SIZE - padding * 2 - 1);
    }

    function render() {
      const state = getState();
      if (!ui?.ctx || !state) return;
      const ctx = ui.ctx;
      ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, ui.canvas.width, ui.canvas.height);

      for (const key of state.walls) {
        const [x, y] = key.split(",").map(Number);
        drawTile(x, y, "#5a5a5a");
      }

      if (state.portal) {
        ctx.save();
        ctx.shadowColor = "rgba(255,255,255,0.9)";
        ctx.shadowBlur = 16;
        drawTile(state.portal.x, state.portal.y, "#050505");
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.strokeRect(state.portal.x * CELL_SIZE + 6, state.portal.y * CELL_SIZE + 6, CELL_SIZE - 12, CELL_SIZE - 12);
        ctx.restore();
      }

      if (state.effects.intentTiles) {
        ctx.fillStyle = "rgba(255,90,90,0.25)";
        for (const key of state.effects.intentTiles) {
          const [x, y] = key.split(",").map(Number);
          ctx.fillRect(x * CELL_SIZE + 4, y * CELL_SIZE + 4, CELL_SIZE - 8, CELL_SIZE - 8);
        }
      }

      state.enemies.forEach((enemy) => {
        ctx.save();
        const pulse = (Math.sin(performanceNow() * 0.008 + enemy.phase) + 1) / 2;
        ctx.globalAlpha = enemy.stunned > 0 ? 0.55 : 1;
        ctx.shadowColor = "rgba(255,80,80,0.75)";
        ctx.shadowBlur = 4 + pulse * 12;
        drawTile(enemy.x, enemy.y, enemy.stunned > 0 ? "#6aaeff" : "#c43636");
        ctx.restore();
      });

      ctx.save();
      ctx.shadowColor = "rgba(74,168,255,0.85)";
      ctx.shadowBlur = 12;
      drawTile(state.player.x, state.player.y, "#3a7bd5");
      ctx.restore();

      if (state.effects.freezeUntil > performanceNow() && state.effects.killer) {
        ctx.fillStyle = "rgba(255,107,107,0.75)";
        ctx.fillRect(state.effects.killer.x * CELL_SIZE + 2, state.effects.killer.y * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
      }

      if (state.effects.stageBannerUntil && performanceNow() > state.effects.stageBannerUntil) {
        ui.stageBanner?.classList.add("hidden");
        state.effects.stageBannerUntil = 0;
      }
      if (state.effects.statusUntil && performanceNow() > state.effects.statusUntil) {
        ui.status?.classList.add("hidden");
        state.effects.statusUntil = 0;
      }

      const danger = state.enemies.some((enemy) => manhattan(enemy, state.player) <= 2);
      const cfg = getEffectiveConfig(state.difficulty, state.stage, state.tuning);
      ui.hud?.classList.toggle("danger", cfg.dangerFeedback && danger);
    }

    function startAnimationLoop() {
      if (animationRunning || !hasDOM) return;
      animationRunning = true;
      const frame = () => {
        render();
        window.requestAnimationFrame(frame);
      };
      window.requestAnimationFrame(frame);
    }

    function ensureAudio() {
      if (!hasDOM || audioContext || getMuted()) return;
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch {
        audioContext = null;
      }
    }

    function playTone(frequency, duration, type, gain) {
      ensureAudio();
      if (!audioContext || getMuted()) return;
      const oscillator = audioContext.createOscillator();
      const volume = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      volume.gain.value = gain;
      oscillator.connect(volume);
      volume.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    }

    function playMoveSound() { playTone(480, 0.05, "triangle", 0.06); }
    function playEnemySound() { playTone(140, 0.08, "sine", 0.08); }
    function playDeathSound() { playTone(80, 0.18, "sawtooth", 0.1); }

    function focusCanvas() { ui.canvas?.focus(); }

    return Object.freeze({ cacheUI, bindUI, openSettings, updateHud, setStatus, showStageBanner, showOverlay, hideOverlay, render, startAnimationLoop, playMoveSound, playEnemySound, playDeathSound, focusCanvas });
  }

  return Object.freeze({ createPresentation });
})();

if (typeof module !== "undefined" && module.exports) module.exports = OMMPresentation;
