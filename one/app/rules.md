# rules.md — One More Move (Professional-Grade Upgrade Ruleset)
Version: 1.0  
Owner: Michael  
Assistant Role: Jarvis (game designer + architect + auditor + implementer; human-in-the-loop)

This document is the **single source of truth** for how we will plan, edit, test, and ship changes to *One More Move*.  
You will upload this file before prompts; I will treat it as binding requirements.

---

## 0) Non-Negotiables (Project Contract)

### 0.1 Prime directives
1) **No bloat.** Every line must justify itself in gameplay value, stability, or maintainability.  
2) **No patches.** If we touch a subsystem, we fix root cause (architecture-level), not symptom-level hacks.  
3) **Current architecture preserved unless explicitly required.** We keep the single-file `game.js` structure, but we may add internal “modules” as clearly labeled sections.  
4) **Professional-grade behavior.** Deterministic where it matters, debuggable, testable, cohesive.

### 0.2 Change discipline
- **Minimal surface-area diffs:** Prefer local changes and helper functions over widespread rewrites.
- **One intent per change:** Each commit/diff should do one thing (e.g., “BFS utilities,” “AI lexicographic policy,” “Portal stage progression”).
- **No behavior changes during Phase 0.** Only audit + invariants + debug scaffolding.

### 0.3 “Authenticated” output standard (how we prevent regressions)
When I propose edits, I must:
- Identify precisely **what** changes, **why**, and **where** (function names/sections).
- Provide a **pre-flight checklist** and a **post-change test matrix**.
- Ensure code passes:
  - syntax correctness
  - runtime safety (no state corruption)
  - invariants (below)
  - difficulty separation rules (below)

---

## 1) Locked Gameplay Requirements (Approved Decisions)

### 1.1 Portal timing
- **First portal appears after 15 turns** (exact requirement).
- After that, portal timing is stage-scaled (defined later), but must remain fair and predictable.

### 1.2 Walls persist with stage thresholds
- Walls **persist across stages**, but at certain **stage thresholds** a wall policy adjustment occurs (e.g., add/remove/refresh/rebalance).
- Default: walls persist unchanged until thresholds are designed and approved.

### 1.3 Extra life cadence
- Extra life logic is **non-cumulative** (max 1 stored).
- Extra life awarded at **Stage 15**, then **every 15 stages** thereafter (Stage 30, 45, …) **only if** the player currently has no extra life stored.

### 1.4 HUD requirement
- Add a **Stage indicator** in the HUD (must match existing style; no clutter).

---

## 2) Core Invariants (Must Always Hold)

### 2.1 AI invariants
1) **Kill priority:** If an enemy has a legal move that lands on the player, that kill move **must win**.
2) **Chase-first policy:** If no kill is available, enemies must **reduce shortest-path distance** to the player unless doing so loses a meaningful trap advantage (defined lexicographically below).
3) **Coordination:** Enemies must **work in tandem** to block exits *while pursuing*, not instead of pursuing.
4) **No “hesitation”:** The AI must not prefer “positioning” that increases shortest-path distance unless it achieves a clearly defined trap objective that is higher priority for that difficulty.

### 2.2 Portal invariants
1) Portal must spawn on a tile that is:
   - empty (not wall, not enemy, not player)
   - **reachable from player** (path exists through passable tiles)
2) Portal must **never** spawn in an unreachable pocket behind impassable blocks.
3) Portal visuals: **black tile with soft white halo glow**, consistent with existing glow rendering.

### 2.3 Progression invariants
1) Stage advancement must **not mutate difficulty configuration unexpectedly**.
2) Settings/Tuning changes must not “bleed” into difficulty profiles.
3) Stage progression must continue indefinitely until death.

### 2.4 Extra life invariants
1) Extra life is never cumulative.
2) If extra life triggers on death:
   - death is prevented
   - life is consumed
   - player relocates to a valid safe tile (reachable + >=2 escape options + maximized distance from enemies)
   - run continues without soft-locks or freezes

### 2.5 Reward ownership & cooldown invariant

- The player may hold **at most one** of each reward type at any time.
- Rewards cannot be activated more than once every **30 seconds (global cooldown)**.
- Cooldown applies across all reward types.
- This invariant exists to preserve turn economy stability and prevent debt exploits.


## 3) Architecture Rules (How We Structure the Code)

### 3.1 Single-file modules (allowed, required for cleanliness)
Inside `game.js`, we will create clearly labeled sections:
- `/* GRID UTILS */`
- `/* AI POLICY */`
- `/* STAGES & PORTAL */`
- `/* DEBUG / ASSERTS */`

No external JS dependencies. No bundlers.

### 3.2 Settings vs Difficulty separation (hard rule)
**Difficulty** is player-selected gameplay profile: `standard | hard | hardcore`.

**Tuning/Settings** is a separate “mode” that can adjust multipliers without rewriting difficulty identity.

Rules:
- `BASE_DIFFICULTY_CONFIG` is immutable (never mutated at runtime).
- `TUNING` is loaded from storage and applied via composition.
- `getEffectiveConfig(difficulty, stage, tuning)` computes final values.

Storage keys must be separate:
- `one-more-move-tuning-v${SETTINGS_VERSION}` (single key, not per difficulty)
- `one-more-move-difficulty` (player preference)

No per-difficulty settings keys.

- Tuning is **global across difficulties by design**.
- Difficulty identity is preserved via immutable BASE_DIFFICULTY_CONFIG.
- Global tuning modifies difficulty behavior proportionally, not structurally.

### 3.3 State ownership
- All transient gameplay state lives in `state`.
- No hidden global mutation of difficulty config objects.
- No new global variables unless strictly necessary (prefer `state.*`).

---

## 4) AI Design Rules (Enemy Aggression Policy)

### 4.1 Lexicographic priorities (mandatory)
Enemy decision-making must follow **priority tiers**, not just weights:

**Priority 0 — Kill**
- If `tile == player`, that move dominates.

**Priority 1 — Get closer right now**
- Prefer moves that reduce **shortest-path distance** (BFS distance), not Manhattan.

**Priority 2 — Coordinate traps while pursuing**
- While still closing distance, coordinate to:
  - occupy/interdict player neighbor tiles
  - reduce escape options (prefer pushing escapes to 1 and then 0)
  - avoid redundant stacking that wastes coverage unless it produces a kill

### 4.2 Coordination requirement (minimal but effective)
- Compute intercept targets = player’s 4 neighbors (valid tiles).
- Assign enemies to distinct intercept targets greedily based on BFS distance.
- Add bonus for moves that reduce distance to assigned intercept target **without overriding chase-first**.

### 4.3 Difficulty differentiation (must be obvious)
Each difficulty must differ in behavior, not just speed.

Config must include explicit AI knobs:
- `chaseWeight`
- `interceptWeight`
- `trapWeight`
- `commitLockTurns` (intent persistence)
- optional: `squeezeBonus` thresholds

Profiles:
- **standard:** chase strong, intercept mild, trap moderate
- **hard:** intercept stronger, trap stronger
- **hardcore:** intercept almost always, strong squeeze pressure at low escapes

---

## 5) Grid Utility Requirements (Shared by AI + Portal)

### 5.1 Required helpers (must be implemented and reused)
- `buildBlockedSet({ excludeEnemyIdx?, includeEnemies? })`
- `reachableTilesFrom(start, blockedSet)` (BFS flood fill)
- `shortestPathDist(from, to, blockedSet)` (BFS distance; Infinity if no path)
- `shortestPathDistToAny(from, targets, blockedSet)`

### 5.2 Reuse rule
- Portal reachability uses the same BFS utilities as AI chase logic.
- No duplicate path logic in multiple places.

---

## 6) Stages & Portal Progression Rules

### 6.1 Stage state additions
`state` must include:
- `stage` (starts at 1)
- `portal` (null or `{x,y,active}` or `{x,y}` with separate `portalActive`)
- `nextPortalAtTurn`
- `hasExtraLife` (boolean)

### 6.2 Portal spawn rules
- First portal at **turn 15**.
- Subsequent portal timing is computed by a function:
  - `computeNextPortalTurn(stage, currentTurn)`
- Spawn selection:
  - reachable from player (BFS)
  - not behind walls
  - not occupied (player/enemy/wall)
  - optional fairness: avoid spawning adjacent to enemy if it makes it unwinnable (must be discussed before adding)

### 6.3 Stage advance rules
When player reaches portal:
- stage++
- portal deactivates
- nextPortalAtTurn recomputed
- effective config updated via `getEffectiveConfig()`
- optional minimal stage banner (400–600ms max) (must not lock input improperly)

### 6.4 Walls reroll at stage transitions (approved)

- Walls are **fully regenerated on each stage advance**.
- Wall count persists and may increase at configured stage thresholds.
- Each wall layout must satisfy:
  - Player reachability (BFS-valid)
  - No overlap with player, enemies, or portal
- Wall reroll is considered part of **stage identity**, not moment-to-moment randomness.

## 7) Debug / Assert Rules (Must Exist, Off by Default)

### 7.1 Debug toggle
- A single boolean constant:
  - `const DEBUG = false;`
- No console spam when `DEBUG === false`.

### 7.2 Required debug checks
When DEBUG is on:
- portal tile reachability assertion
- effective config dump (difficulty, stage, tuning)
- optional AI trace for one enemy per turn (bounded, not spammy)

---

## 8) Testing Rules (Manual + Lightweight Automated)

### 8.1 Required manual test matrix (per release)
1) Portal spawns reachable 50 times (different seeds).
2) Enemy kill priority works (adjacent kill always taken).
3) Chase uses shortest-path around walls (construct corridor test).
4) Coordination: 2+ enemies take distinct intercept roles when possible.
5) Stage progression: stage 1 vs 10 vs 25 feel appropriately scaled.
6) Extra life triggers at stage 15, not cumulative, rescues exactly once.
7) No freezes/soft-locks from input locks, debt, or stage transitions.

### 8.2 Regression guard
Any time we touch:
- `resolveTurnAsync`, `payTurnDebtAsync`, `attemptMove`, or `planEnemyMoves`
we must re-run the full matrix.

---

## 9) UI Rules (HUD + Visual Consistency)

### 9.1 HUD Stage indicator
- Add stage indicator in HUD meta area, matching:
  - font sizes
  - spacing
  - existing `hud-meta` style
- Must not exceed max width or cause overflow.

### 9.2 Portal rendering style
- Canvas render only (no DOM overlays).
- Black tile + soft white halo, consistent with enemy/player glow logic.
- Must be readable on the black board background.

---

## 10) Delivery Rules (How Jarvis Responds)

### 10.1 Output structure for code work
For any implementation response, Jarvis must deliver:
1) **What changes** (high-level)
2) **Why** (ties to invariants and rules)
3) **Exact edit plan** (file/section/function)
4) **Patch/diff or full updated file** (only when requested)
5) **Test checklist** (copy/paste runnable steps)

### 10.2 No guessing
- If any behavior is uncertain, Jarvis must propose a default and label it clearly.

---

## 11) Phase Plan (Locked Roadmap)

### Phase 0 — Audit + invariants (no behavior changes)
- Define invariants (Section 2)
- Add DEBUG switch + bounded debug checks (Section 7)

### Phase 1 — Grid utilities
- Implement BFS helpers and reuse them (Section 5)

### Phase 2 — Decouple Settings/Tuning from Difficulty
- Separate storage keys
- Immutable base difficulty config
- `getEffectiveConfig()` composition

### Phase 3 — AI aggression redesign
- Lexicographic priorities (kill > chase > coordinate trap)
- Intercept assignment + trap synergy
- Clear difficulty differences

### Phase 4 — Stages + Portal progression
- Portal spawn at turn 15, reachable only
- Stage scaling curve
- Walls persist; thresholds to be defined
- Extra life at stage 15, every 15 thereafter (non-cumulative)

### Phase 5 — Test and polish
- Full manual matrix
- UI stage indicator
- Remove dead code, ensure cohesion, confirm no bloat

---

## 12) Appendix — Definitions

- **Reachable:** There exists a path from player to tile through in-bounds tiles not blocked by walls (and optionally ignoring enemies only if explicitly stated).
- **Shortest-path distance:** BFS distance on the grid using passable tiles.
- **Intercept target:** Any of the player’s valid neighbor tiles (up/down/left/right) that are not walls.
- **Trap improvement:** A measurable reduction in player escape options or forced funneling *without* increasing shortest-path distance unless difficulty explicitly allows it.

---
End of rules.md
