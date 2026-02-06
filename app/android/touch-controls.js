const specialContainer = document.querySelector(".touch-special");
const specialButton = document.querySelector("#touch-special-btn");
const canvas = document.querySelector("#game");

const dispatchKey = (type, keyValue) => {
  const event = new KeyboardEvent(type, {
    key: keyValue,
    bubbles: true,
  });
  window.dispatchEvent(event);
};

const GRID_SIZE = 10;
const DEADZONE_RATIO = 0.25;
const DIAGONAL_RATIO = 1.2;

const getState = () => (typeof window.__ommGetState === "function" ? window.__ommGetState() : null);

const getDirectionKey = (dx, dy) => {
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 1 && absY < 1) return null;
  if (absX > absY * DIAGONAL_RATIO) return dx > 0 ? "ArrowRight" : "ArrowLeft";
  if (absY > absX * DIAGONAL_RATIO) return dy > 0 ? "ArrowDown" : "ArrowUp";
  if (dx > 0 && dy < 0) return "e";
  if (dx < 0 && dy < 0) return "q";
  if (dx > 0 && dy > 0) return "c";
  if (dx < 0 && dy > 0) return "z";
  return null;
};

const handleCanvasTap = (event) => {
  if (!canvas) return;
  const state = getState();
  if (!state || !state.player) return;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const cellSize = rect.width / GRID_SIZE;
  const playerCenterX = (state.player.x + 0.5) * cellSize;
  const playerCenterY = (state.player.y + 0.5) * cellSize;
  const dx = x - playerCenterX;
  const dy = y - playerCenterY;
  const deadzone = cellSize * DEADZONE_RATIO;

  if (Math.abs(dx) < deadzone && Math.abs(dy) < deadzone) return;

  const key = getDirectionKey(dx, dy);
  if (!key) return;
  dispatchKey("keydown", key);
};

const SPECIALS = [
  {
    key: " ",
    label: "Time Freeze",
    hold: true,
    isAvailable: (state) => state?.tokens?.timeFreeze > 0,
  },
  {
    key: "b",
    label: "Freeze Turn",
    hold: false,
    isAvailable: (state) => state?.tokens?.freeze > 0,
  },
  {
    key: "v",
    label: "Wall Ignore",
    hold: false,
    isAvailable: (state) => state?.tokens?.wall > 0,
  },
  {
    key: "f",
    label: "Phase Step",
    hold: false,
    isAvailable: (state) =>
      state && !state.phaseUsed && !state.phaseArmed && performance.now() >= state.rewardCooldownUntil,
  },
];

const updateSpecialButton = () => {
  if (!specialContainer || !specialButton) return;
  const state = getState();
  const special = SPECIALS.find((entry) => entry.isAvailable(state));

  if (!special) {
    specialContainer.classList.add("is-hidden");
    return;
  }

  specialContainer.classList.remove("is-hidden");
  specialButton.textContent = special.label;
  specialButton.dataset.key = special.key;
  specialButton.dataset.hold = special.hold ? "true" : "false";
};

const handleSpecialDown = (event) => {
  const keyValue = event.currentTarget.dataset.key;
  if (!keyValue) return;
  dispatchKey("keydown", keyValue);
  if (event.currentTarget.dataset.hold === "true") {
    event.currentTarget.classList.add("is-active");
  }
};

const handleSpecialUp = (event) => {
  const keyValue = event.currentTarget.dataset.key;
  if (!keyValue) return;
  if (event.currentTarget.dataset.hold === "true") {
    dispatchKey("keyup", keyValue);
    event.currentTarget.classList.remove("is-active");
  }
};

if (canvas) {
  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    handleCanvasTap(event);
  });
}

if (specialButton) {
  specialButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleSpecialDown(event);
  });

  specialButton.addEventListener("pointerup", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleSpecialUp(event);
  });

  specialButton.addEventListener("pointerleave", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleSpecialUp(event);
  });
}

const pollSpecials = () => {
  updateSpecialButton();
  requestAnimationFrame(pollSpecials);
};

if (specialContainer) {
  pollSpecials();
}
