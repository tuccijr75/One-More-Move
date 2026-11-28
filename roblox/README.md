# One More Move — Roblox

This directory contains the Roblox implementation of **One More Move**. It does not depend on Electron, Capacitor, or the platform wrapper directories under `app/`.

## Architecture

- `src/shared/Rng.lua` — Mulberry32 port matching the canonical JavaScript generator.
- `src/shared/Grid.lua` — grid coordinates, BFS reachability, distance, escapes, and wall generation.
- `src/shared/Ai.lua` — kill-first, chase-first enemy planning and collision-safe destination resolution.
- `src/shared/Simulation.lua` — rewards, movement, abilities, portal progression, revival, and run snapshots.
- `src/server/OneMoreMoveServer.server.lua` — authoritative per-player sessions and command validation.
- `src/client/OneMoreMoveClient.client.lua` — responsive board and keyboard, gamepad, and touch controls.
- `tests/TestRunner.server.lua` — deterministic parity and stress tests.

## Build

The project is configured for Rojo 7.6.1.

```powershell
rojo build roblox/default.project.json --output OneMoreMove.rbxlx
```

Open the generated place in Roblox Studio, or run:

```powershell
rojo serve roblox/default.project.json
```

Then connect with the Rojo Studio plugin.

## Test place

```powershell
rojo build roblox/test.project.json --output OneMoreMoveTests.rbxlx
```

Open the test place in Studio and run it. The server output reports each deterministic test and stops on the first failure.

## Authority contract

The client sends commands only. The server owns:

- seed and run identity;
- player, enemy, wall, reward, and portal state;
- turn and stage progression;
- collision and death resolution;
- acceptance or rejection of every move;
- state resynchronization.

Every gameplay command includes the client's expected `runId` and turn. A mismatch causes the server to send a fresh snapshot instead of applying the command.

## Current boundary

This foundation implements a complete solo run loop and cross-platform controls. Persistent Roblox profile data, global daily leaderboards, replay logs, same-seed duels, cosmetics, and a 3D social lobby are intentionally deferred until deterministic parity is accepted.

## Experimental tactical parity contract

The JavaScript v2/v4 candidates remain laboratory-only. Generate the frozen oracle from repository root with `npm run lab:fixtures`. CI artifact `one-more-move-ai-fixtures` contains `ai-fixtures.json` and generated `AiFixtures.lua`. Coordinates are zero-based, enemy array order is authoritative, IDs must not be reindexed, nil represents absent intent/portal fields. The test-only consumer must receive the supplied effective config and tuning, and compare the expected enemies, intent tiles and diagnostic ranks without modifying the current `Ai.plan` or server command path. Existing source differences are tracked in docs/TACTICS.md. Fixture generation alone is not execution of Roblox parity; the isolated port and CLI checks are implemented, while actual Studio verification remains pending.

## Standalone tactical conformance

`roblox/tests/Tactical.lua` is an isolated candidate port of the frozen JavaScript baseline/v2/v4 policies. Generate CLI inputs using `npm run lab:luau` from the repository root, then run `luau dist/lab/luau/TacticalRunner.luau` with official Luau 0.730. The generated copies adapt only module import addressing; the source Grid and live Ai modules are unchanged. The runner asserts all 1,125 expected decisions and repeats them, including all 32 actual changed states. The separate workflow executes CLI planner, command-integration and strict full-state trace checks; it does not run Studio or select the candidate in the playable server. The playable server still uses the existing Ai.plan.

## Studio tactical qualification (test only)

From repository root, with Rojo 7.6.1 installed:

```powershell
npm run lab:studio
```

Alternatively download the [OneMoreMove-Tactical-Tests artifact 15206550198](https://github.com/tuccijr75/One-More-Move/actions/runs/46016150009/artifacts/15206550198) from successful Roblox Validation 46016150009 (tested branch revision `16fc406345f10011c1ee22a46f2691a5b2e9fff7`; expires 2026-12-27). This artifact was built, not executed in Studio. Open OneMoreMoveTactical.rbxlx in Roblox Studio, open the Output panel and select Run (server simulation). Do not publish the place. The test script runs the same 375 fixtures and 1,125 exact decisions plus repeats as the CLI; progress appears periodically. Success is one TACTICAL_PASS JSON receipt and the TacticalStudio script Result attribute PASS. Failure is TACTICAL_FAIL with the exact fixture/field and Result FAIL. Preserve the complete receipt for review. The receipt includes the isolated IntegrationCheck command-routing results through Simulation; it does not run the separate strict full-state CLI trace. INTEGRATION_FAIL also blocks acceptance. The separate playable and existing regression places retain their default planner.

## Simulation qualification interface

Simulation.applyCommand accepts an optional fourth argument, a trusted server-side planner function. Existing server calls omit it and retain Ai.plan. IntegrationCheck.lua injects the candidate only in the isolated qualification harness, comparing fixture-driven movement and ability routing; no client command may select it. CLI output includes INTEGRATION_PASS and Studio TACTICAL_PASS contains an integration receipt. Complete cross-runtime gameplay parity and actual Studio execution remain separate requirements.

## Full-state stage parity

The migration branch aligns stage regeneration with the canonical web runtime: clear outgoing enemies before generating new walls. The old Roblox implementation excluded their positions, causing deterministic divergence. The strict CLI trace gate checks 36 natural command traces and 12 forced stage chains, preserving first-mismatch diagnostics. The existing default AI remains selected in the playable server. No publish or gameplay approval is implied by the parity fix.

[Luau Tactical Parity 46016138485](https://github.com/tuccijr75/One-More-Move/actions/runs/46016138485) at `16fc406345f10011c1ee22a46f2691a5b2e9fff7` (job 140563630150) passed the frozen oracle, exact planner and command checks, strict full-state trace step and parity-input upload. TRACE_PASS: 36/36 natural runs, 721 exact commands, 12/12 forced chains, 279 exact stage transitions; zero divergences in the exported corpus. INTEGRATION_PASS: 375 fixture commands, zero skipped, 32 changed-state commands, 11 ability cases, 1,080 legacy command pairs. Planner receipt: 375 fixtures, 1,125 exact decisions plus repeats; 62/375 existing shipping Roblox enemy-record differences (Standard 18/55, Hard 18/55, Hardcore 26/265; not necessarily position differences). Forced chains align explicit JS portal selection and one RNG draw; these are not naturally survived stages or universal portal-generation parity. Gameplay comparisons exclude visual state, storage and asynchronous presentation; only the existing 1e-6 ms time-conversion tolerance applies. CLI conformance is not actual Studio/device execution, human difficulty acceptance or policy approval. [Parity inputs 15206520214](https://github.com/tuccijr75/One-More-Move/actions/runs/46016138485/artifacts/15206520214) (archive SHA-256 dee1f5b9e4145982d48b745220f4e1f04a17c4b262cc1d33929b0122f7f6cfce).

Run `npm run lab:luau` and `luau dist/lab/luau/TraceRunner.luau` to reproduce the strict trace with official Luau 0.730. Actual Studio receipt remains required. No client planner selection or shipping policy change.
