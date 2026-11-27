"use strict";

(() => {
  const GRID_SIZE = 10;
  const DEADZONE_RATIO = 0.25;
  const DIAGONAL_RATIO = 1.2;
  const canvas = document.getElementById("game");
  const specialContainer = document.querySelector(".touch-special");

  function getState() {
    return typeof window.__ommGetState === "function" ? window.__ommGetState() : null;
  }

  function command(name, value) {
    return typeof window.__ommCommand === "function" ? window.__ommCommand(name, value) : false;
  }

  function move(dx, dy) {
    return typeof window.__ommMove === "function" ? window.__ommMove(dx, dy) : false;
  }

  function directionFromPointer(event) {
    const state = getState();
    if (!canvas || !state?.player) return null;
    const rect = canvas.getBoundingClientRect();
    const cellSize = rect.width / GRID_SIZE;
    const playerX = (state.player.x + 0.5) * cellSize;
    const playerY = (state.player.y + 0.5) * cellSize;
    const dx = event.clientX - rect.left - playerX;
    const dy = event.clientY - rect.top - playerY;
    const deadzone = cellSize * DEADZONE_RATIO;
    if (Math.abs(dx) < deadzone && Math.abs(dy) < deadzone) return null;
    if (Math.abs(dx) > Math.abs(dy) * DIAGONAL_RATIO) return { dx: dx > 0 ? 1 : -1, dy: 0 };
    if (Math.abs(dy) > Math.abs(dx) * DIAGONAL_RATIO) return { dx: 0, dy: dy > 0 ? 1 : -1 };
    return { dx: dx > 0 ? 1 : -1, dy: dy > 0 ? 1 : -1 };
  }

  canvas?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const direction = directionFromPointer(event);
    if (direction) move(direction.dx, direction.dy);
  });

  document.querySelectorAll("[data-command]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      command(button.dataset.command, button.dataset.value);
    });
  });

  const abilities = [
    { name: "time", label: "Time Freeze", available: (s) => s?.tokens?.timeFreeze > 0 || s?.holdSpace },
    { name: "freeze", label: "Freeze Turn", available: (s) => s?.tokens?.freeze > 0 || s?.freezeNext },
    { name: "wall", label: "Wall Ignore", available: (s) => s?.tokens?.wall > 0 || s?.wallIgnoreArmed },
    { name: "phase", label: "Phase Step", available: (s) => s && (!s.phaseUsed || s.phaseArmed) },
  ];

  function createAbilityButton(ability, state) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "touch-special-btn";
    button.textContent = ability.label;

    if (ability.name === "time") {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        command("time-start");
        button.classList.add("active");
      });
      const release = (event) => {
        event.preventDefault();
        command("time-end");
        button.classList.remove("active");
      };
      button.addEventListener("pointerup", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("pointerleave", release);
    } else {
      button.addEventListener("click", () => command(ability.name));
    }

    if ((ability.name === "wall" && state.wallIgnoreArmed) ||
        (ability.name === "freeze" && state.freezeNext) ||
        (ability.name === "phase" && state.phaseArmed)) {
      button.classList.add("armed");
    }
    return button;
  }

  function renderAbilities() {
    if (!specialContainer) return;
    const state = getState();
    const signature = abilities
      .map((ability) => `${ability.name}:${ability.available(state) ? 1 : 0}`)
      .join("|") + `:${state?.wallIgnoreArmed ? 1 : 0}:${state?.freezeNext ? 1 : 0}:${state?.phaseArmed ? 1 : 0}`;
    if (specialContainer.dataset.signature === signature) return;
    specialContainer.dataset.signature = signature;
    specialContainer.replaceChildren();
    abilities.filter((ability) => ability.available(state)).forEach((ability) => {
      specialContainer.appendChild(createAbilityButton(ability, state));
    });
    specialContainer.classList.toggle("is-hidden", specialContainer.childElementCount === 0);
  }

  renderAbilities();
  window.setInterval(renderAbilities, 150);
})();
