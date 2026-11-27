# Tactical intelligence candidate v1 — evaluation only

Authority: app/rules.md §§2.1, 4.1–4.3 and approved 2.0 migration Phase 5. Modular baseline ba77563e5cbbb0e81d568de4f9403d4c6bcdbd2d passed Core Validation 46004837292 (locked 300-run equivalence) and benchmark 46004838390. The current live browser and Roblox policies remain unchanged. No candidate adoption or release is authorized.

## Diagnosis

Legacy lexicographic ranking makes chase tier and distance dominate coordination; the 1,500-run benchmark recorded identical median observed survival across all three difficulty profiles for every strategy. Intent-lock metadata can differ without movement changing. Preserve kill priority, cardinal movement, BFS pursuit, stun behavior and unique destination resolution. No new AI movement speed or enemy count change.

## Candidate

An explicit Node-only enemyPolicy tactical-v1 selects the candidate within the canonical runtime; default baseline and browser gameplay use the existing policy. The candidate dynamically assigns the nearest active enemy to pursuit, remaining enemies to distinct reachable corridor projections. Forward corridors are prioritized for interception, lateral corridors for flanking, rear corridors for containment. Candidate horizon is 1/2/3 tiles for standard/hard/hardcore. The projection extends a cardinal exit ray until a wall or the configured horizon; it is not a full multi-turn adversarial search. Candidate ranking preserves kill priority and the original first two chase ranks, then considers destination reservation, distance to role target and legacy coordination. Existing collision resolution remains authoritative. No new state fields or RNG draws.

## Evidence and gates

Run npm test, npm run refactor:check, npm run lab:tactical. Candidate invariants: deterministic and nonmutating planner, kill-first, stun expiry, shortest-path pursuit, in-bounds single-cell destinations, no wall overlap or duplicate final positions, distinct corridor assignments. The locked legacy parity gate must still pass. The 900-run paired screening matrix uses 30 seeds x 5 player strategies x 3 difficulty profiles x 2 enemy policies. Both player lookahead and actual enemy turn use the selected planner. Geometry hashes exclude intent metadata and virtual-clock timestamps, but include player/enemy positions, walls, portals and stage/turn counts; they measure full run trajectories, not solely enemy behavior. Compare matched observed survival, censoring, portal entry and geometry changes. Preserve separate baseline/candidate raw rows and source provenance. No new external dependencies. No Roblox port before a candidate is accepted.

## Decision criteria (proposed, not approved gameplay canon)

Advance to a larger held-out seed experiment only if all invariant gates pass and geometry/outcome comparisons demonstrate useful behavior differentiation; do not adopt purely because the candidate changes positions. Examine tactical-player survival and portal progression for a monotonic difficulty gradient without collapsing Standard playability; treat censored observations separately. If separation is weak, revise role targeting or jointly optimize legal closing moves, then remeasure. Full gameplay/device checks, fairness review and owner approval precede promotion. Portal turn accounting, legacy global tuning semantics and the wall-rule wording conflict are outside this experiment.
