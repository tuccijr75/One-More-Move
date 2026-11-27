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

The JavaScript v2/v4 candidates remain laboratory-only. Generate the frozen oracle from repository root with `npm run lab:fixtures`. CI artifact `one-more-move-ai-fixtures` contains `ai-fixtures.json` and generated `AiFixtures.lua`. Coordinates are zero-based, enemy array order is authoritative, IDs must not be reindexed, nil represents absent intent/portal fields. The test-only consumer must receive the supplied effective config and tuning, and compare the expected enemies, intent tiles and diagnostic ranks without modifying the current `Ai.plan` or server command path. Existing source differences are tracked in docs/TACTICS.md. Fixture generation is not execution of Roblox parity; the candidate port and Studio verification remain pending.

## Standalone tactical conformance

`roblox/tests/Tactical.lua` is an isolated candidate port of the frozen JavaScript baseline/v2/v4 policies. Generate CLI inputs using `npm run lab:luau` from the repository root, then run `luau dist/lab/luau/TacticalRunner.luau` with official Luau 0.730. The generated copies adapt only module import addressing; the source Grid and live Ai modules are unchanged. The runner asserts all 1,125 expected decisions and repeats them, including all 32 actual changed states. The separate workflow executes the CLI tests; it does not run Studio or integrate the candidate into Simulation. The playable server still uses the existing Ai.plan.

## Studio tactical qualification (test only)

From repository root, with Rojo 7.6.1 installed:

```powershell
npm run lab:studio
```

Alternatively download the OneMoreMove-Tactical-Tests artifact from the successful Roblox Validation workflow. Open OneMoreMoveTactical.rbxlx in Roblox Studio, open the Output panel and select Run (server simulation). Do not publish the place. The test script runs the same 375 fixtures and 1,125 exact decisions plus repeats as the CLI; progress appears periodically. Success is one TACTICAL_PASS JSON receipt and the TacticalStudio script Result attribute PASS. Failure is TACTICAL_FAIL with the exact fixture/field and Result FAIL. Preserve the complete receipt for review. The separate playable place and existing regression test place are unchanged; this test does not route commands through Simulation.

## Simulation qualification interface

Simulation.applyCommand accepts an optional fourth argument, a trusted server-side planner function. Existing server calls omit it and retain Ai.plan. IntegrationCheck.lua injects the candidate only in the isolated qualification harness, comparing fixture-driven movement and ability routing; no client command may select it. CLI output includes INTEGRATION_PASS and Studio TACTICAL_PASS contains an integration receipt. Complete cross-runtime gameplay parity and actual Studio execution remain separate requirements.
