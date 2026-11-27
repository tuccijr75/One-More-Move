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
