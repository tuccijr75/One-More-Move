# One More Move — Repository agent contract

Owner authorized installation of this contract. Keep it as a small routing layer, not a duplicate gameplay specification. The five project source files may live outside the checkout; fetch or request them if required.

## Read first

- `app/rules.md` — gameplay authority; flag §1.2 vs §6.4, preserve current reroll.
- `docs/OMM-2-MIGRATION.md` — approved architecture/sequence and release gates.
- `PLATFORM_LAYOUT.md` — active sources vs historical native copies.
- `docs/TACTICS.md`, `docs/LAB.md`, `docs/ACCEPTANCE.md`, `docs/MOBILE-ACCEPTANCE.md`, `docs/NEOCITIES.md` — evidence, proposals, acceptance and deployment limits.
- `package.json` and relevant code/test files at exact checked-out revision. Latest pack snapshot `16fc406345f10011c1ee22a46f2691a5b2e9fff7`; verify current HEAD, main and draft PR #12 before edits.

## Working rules

Work only on authorized `feat/omm-2-web-first` tasks. No force push, main merge, public release, account change, security-boundary expansion, secret storage or deployment without explicit owner approval. Never use or request GitHub API keys or Actions secrets. Neocities `/omm/` only, owner-local key if specifically authorized; no root/AICS changes or deletes. Existing connector authorization is not permission to publish.

Source-only root-cause edits, minimal single-intent commits, no runtime shims, duplicated engines, native-mobile revival, new dependencies or generated-output edits. Keep module order, immutable config, shared BFS, deterministic RNG, kill/chase-first, unique enemy destinations and ability/portal invariants. Preserve baseline and all current regression gates. No approved policy switch: browser baseline and Roblox Ai.plan remain defaults; v2/v4 isolated qualification only. Client cannot select trusted planner. Portal zero-turn legacy and wall conflict require owner decisions. Do not silently correct rules or loosen fixtures.

## Validation and delivery

Run `npm run check` and `npm run refactor:check` (full Git history), targeted lab scripts, Luau fixture/integration/trace runners for Roblox changes; see docs/LAB.md and exact package commands. `npm run lab:luau`, `luau dist/lab/luau/TacticalRunner.luau`, `luau dist/lab/luau/TraceRunner.luau` use official Luau 0.730. Rojo 7.6.1 builds are not Studio execution. No claim of actual device test without receipt. Test-only candidate port in `roblox/tests/Tactical.lua`; trusted optional planner in Simulation is not a shipping switch. Record exact commit, commands, tests, failures, raw provenance, risk and next step. A passing CI run from a different revision is not proof. Preserve owner approvals in handoff; no automatic canon promotion.

Current next slice: record strict trace pass from 46016138485 (36/721,12/279), refresh stale acceptance references, then owner-assisted isolated candidate/Studio/device acceptance before approval. Do not build a fifth AI variant by default. If only manual or approval gates remain, state blocker and exact action rather than keep adding code.
