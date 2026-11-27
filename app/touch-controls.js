"use strict";

(() => {
  const GRID_SIZE = 10;
  const DEADZONE_RATIO = 0.25;
  const DIAGONAL_RATIO = 1.2;
  const canvas = document.getElementById("game");
  const specialContainer = document.querySelector(".touch-special");
  let touchFreezeRun = null;

  const getState = () => typeof window.__ommGetState === "function" ? window.__ommGetState() : null;
  const command = (name, value) => typeof window.__ommCommand === "function" && window.__ommCommand(name, value);

  function finishTouchFreeze() {
    const state = getState();
    const run = touchFreezeRun;
    touchFreezeRun = null;
    if (run !== null && state?.runId === run && state.holdSpace) command("time-end");
  }

  function move(dx, dy) {
    const accepted = typeof window.__ommMove === "function" && window.__ommMove(dx, dy);
    const state = getState();
    if (touchFreezeRun !== null && state?.runId === touchFreezeRun &&
        (state.gameOver || state.holdMovesLeft <= 0)) finishTouchFreeze();
    renderAbilities();
    return accepted;
  }

  function directionFromPointer(event) {
    const state = getState();
    if (!canvas || !state?.player) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const scaleX = rect.width / GRID_SIZE;
    const scaleY = rect.height / GRID_SIZE;
    const dx = (event.clientX - rect.left) / scaleX - state.player.x - 0.5;
    const dy = (event.clientY - rect.top) / scaleY - state.player.y - 0.5;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < DEADZONE_RATIO && ay < DEADZONE_RATIO) return null;
    const diagonalAllowed = state.tokens?.diag > 0 && !state.phaseArmed;
    if (!diagonalAllowed || ax > ay * DIAGONAL_RATIO || ay > ax * DIAGONAL_RATIO) {
      return ax >= ay ? { dx: dx > 0 ? 1 : -1, dy: 0 } : { dx: 0, dy: dy > 0 ? 1 : -1 };
    }
    return { dx: dx > 0 ? 1 : -1, dy: dy > 0 ? 1 : -1 };
  }

  canvas?.addEventListener("pointerdown", (event) => {
    if (event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const direction = directionFromPointer(event);
    if (direction) move(direction.dx, direction.dy);
  });

  document.querySelectorAll("[data-move]").forEach((button) => {
    button.addEventListener("click", () => {
      const [dx, dy] = button.dataset.move.split(",").map(Number);
      move(dx, dy);
    });
  });

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      command(button.dataset.command, button.dataset.value);
      if (getState()?.runId !== touchFreezeRun) touchFreezeRun = null;
      renderAbilities();
    });
  });

  const abilities = [
    { name: "time", label: "Time Freeze", available: s => s?.tokens?.timeFreeze > 0 || s?.holdSpace },
    { name: "freeze", label: "Freeze Turn", available: s => s?.tokens?.freeze > 0 || s?.freezeNext },
    { name: "wall", label: "Wall Ignore", available: s => s?.tokens?.wall > 0 || s?.wallIgnoreArmed },
    { name: "phase", label: "Phase Step", available: s => s && (!s.phaseUsed || s.phaseArmed) },
  ];

  function armed(ability, state) {
    return Boolean(
      (ability.name === "time" && state.holdSpace) ||
      (ability.name === "wall" && state.wallIgnoreArmed) ||
      (ability.name === "freeze" && state.freezeNext) ||
      (ability.name === "phase" && state.phaseArmed)
    );
  }

  function createAbilityButton(ability, state) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "touch-special-btn";
    button.textContent = ability.name === "time" && state.holdSpace
      ? "End Freeze (" + state.holdMovesLeft + ")" : ability.label;
    button.setAttribute("aria-pressed", String(armed(ability, state)));
    if (armed(ability, state)) button.classList.add("armed");
    button.addEventListener("click", () => {
      const current = getState();
      if (!current || current.gameOver) return;
      if (ability.name === "time") {
        if (current.holdSpace) {
          command("time-end");
          touchFreezeRun = null;
        } else if (command("time-start")) {
          touchFreezeRun = getState()?.runId ?? null;
        }
      } else command(ability.name);
      renderAbilities();
    });
    return button;
  }

  function renderAbilities() {
    if (!specialContainer) return;
    const state = getState();
    if (!state || state.runId !== touchFreezeRun || !state.holdSpace) touchFreezeRun = null;
    const visible = state && !state.gameOver ? abilities.filter(ability => ability.available(state)) : [];
    const signature = visible.map(ability => ability.name + ":" + Number(armed(ability, state))).join("|")
      + ":" + (state?.holdSpace ? state.holdMovesLeft : "-");
    if (specialContainer.dataset.signature === signature) return;
    specialContainer.dataset.signature = signature;
    specialContainer.replaceChildren();
    visible.forEach(ability => specialContainer.appendChild(createAbilityButton(ability, state)));
    specialContainer.classList.toggle("is-hidden", visible.length === 0);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      finishTouchFreeze();
      renderAbilities();
    }
  });

  renderAbilities();
  window.setInterval(renderAbilities, 150);
})();
