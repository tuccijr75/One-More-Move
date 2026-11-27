# Simulation laboratory v0.1

Purpose: compare player strategies and difficulty profiles using the canonical JavaScript engine, without browser, audio or real-time sleeps. This is measurement infrastructure, not an AI rebalance. Each run is isolated and uses the same real command and turn resolution functions as the browser.

## Run

Node 20+, no dependency installation required. Run `npm test` and `npm run lab:smoke`. The default smoke matrix uses 3 shared seeds x 5 strategies x 3 difficulty profiles = 45 runs. Per-run movement cap: 100 accepted movement/wait iterations. The full CLI supports `npm run lab -- --runs=10 --seed=777 --max-actions=160 --input-ms=1000`. A virtual clock advances by configured input pace and actual engine delay; waiting does not move enemies. This controls the 30-second cooldown without assuming it is turn-based. No 10,000-run experiment until profiling and review.

## Policies

Random: uniformly chooses unoccupied cardinal destinations. Greedy: maximizes immediate cardinal exits and clearance. Portal: prioritizes portal distance and exits. Defensive: evaluates the canonical enemy plan one step ahead. Tactical: evaluates the same plan, considers Focus movement routes and uses Freeze/Time Freeze under immediate predicted threat. Policies are intentionally constrained approximations, not optimal human play; non-tactical policies do not activate rewards. Tactical lookahead does not fully model reward effects, revival, spawns, or portal transitions, and its proxy is not a proof of forced death. Rejected policy commands fail the experiment.

## Evidence

`dist/lab/results.json` records engine revision, settings, seed, policy, outcomes, turns/stage distribution, censoring, portal spawns/entries/reachability, ability use, immediate-intercept proxy and adjacent enemy pressure. Per-run rows are retained. Unreachable portal observation and duplicate enemy positions fail the smoke gate. The immediate-risk proxy covers only the candidates examined by the policy; it is not an unavoidable-death rate. Adjacent pressure is a coarse proxy, not proof of coordination. A policy with no move may stop while the engine remains alive; such runs are censored. Do not report censored survival as a death. Quantiles summarize observed turns only, not uncensored survival probabilities. Record runtime separately from deterministic results. Shared seed sets permit matched comparisons; small smoke samples cannot establish difficulty balance or population-level fairness.

Current portal entry scoring is preserved (stage advances without turn increment); portal accounting remains open. No user approval for new gameplay rules or public release is implied. Next: verify browser/headless command trace parity more extensively, profile larger runs, improve ability candidate predictions, add exact coordination instrumentation and confidence intervals, then compare approved baseline configurations.

## Matched benchmark v0.2

Run `npm run lab:benchmark` for 100 seeds per group (1500 runs, seed 777 through 876, maximum 160 action iterations, 1000 ms input pace). A dedicated GitHub Actions benchmark workflow runs on migration-branch pushes changing relevant engine/lab source. It has a 10-minute job limit and no credentials or network deployment. The smaller core smoke gate remains unchanged.

Schema 2 records exact checked-out commit and SHA-256 source digests, per-run structural trajectory digests (ignoring wall-clock and visual effects but including AI intent, positions, rewards and progression), and matched-seed comparisons for all three difficulty pairs. Report observed-turn shorter/equal/longer counts, median and mean observed-turn deltas, stage/outcome differences and trajectory differences. These are descriptive comparisons of capped, possibly censored runs; they are not estimates of uncensored survival or statistical significance. Different trajectory digests do not necessarily imply harder gameplay. The profile affects the virtual clock through engine delays, so cooldown-related decisions may still differ between difficulties. No change to gameplay or policy decision rules in this slice.

## Baseline receipt and refactor gate

Locked baseline: 272661577b40c7654c7138f2fc808439570a6e4f. GitHub benchmark run 46001273122 succeeded: 1,500 simulations, 19.591 seconds of measured execution, 912 generated portals, zero observed unreachable portals. All five median observed-turn values were identical across difficulties (7, 15, 15, 16, 20). Standard vs Hardcore matched tactical survival: 5 shorter, 90 equal, 5 longer; 400 non-tactical pairs all equal. Intent metadata differs even when survival matches; structural trajectory hashes alone do not establish tactical difficulty separation. No balance change authorized by this receipt.

`npm run refactor:check` reconstructs the pinned baseline engine and lab from Git history into an isolated temporary directory, runs 10 matched seeds across all 15 groups (150 runs per engine), and requires identical per-run rows, group metrics, and matched comparisons. CI fetches full history. Engine and policy hashes for subsequent experiments include the extracted grid source. The baseline comparison remains applicable only during behavior-preserving modularization; changing gameplay intentionally requires an approved replacement gate, not silently relaxing the test.

## AI extraction gate

Grid extraction passed Core Validation run 46002173717, including the locked 300-simulation equivalence gate, and benchmark run 46002173809. The next extraction moves enemy ranking, intercept assignment, proposals, conflict resolution and intent generation to `app/ai.js`. Explicit configuration and tuning arguments preserve the previous runtime-selected tuning; no tactical ranking or difficulty parameters are modified. The same locked baseline gate applies, and benchmark provenance now includes ai.js. Do not interpret intent-only differences as difficulty separation.

## Configuration and generation extraction

AI extraction at d424d4f43121c559bd0fee30fabc9d9144bc7e5b passed Core Validation 46002775667, the locked equivalence gate, benchmark 46002775562 and Roblox Validation 46002785873. Extract immutable difficulty profiles, tuning sanitization and configuration into config.js; move the existing RNG, wall and enemy generation, portal generation and revival selection into generation.js. Retain the legacy runtime tuning input and all stage/cooldown accounting until the behavior-preserving gate completes. The portal debug assertion is passed explicitly by the runtime; the RNG sequence and generation algorithms are unchanged. All four module hashes enter future benchmark provenance.

## Movement and progression extraction

Configuration and generation extraction at 94a7b7c4ffa8eaedec493fb83daa8bedc0d1553c passed Core Validation 46003969738 (including locked baseline equivalence) and benchmark 46003969714. Move escape adjudication and player movement/Focus abilities into movement.js, with explicit runtime callbacks for the current state, clock, sound, death, HUD, stage transitions and turn scheduling. Move stage transitions, completed-turn accounting and rewards into progression.js, retaining legacy runtime tuning input, portal-entry behavior and ordering of score persistence versus spawning. Both modules are shared by browser, Electron and the Node laboratory. The locked baseline equivalence gate remains in force; no change to gameplay is authorized by this extraction.

## State, storage and presentation extraction

Movement and progression extraction at 48fba7e92bc1d252481b86587282b270e557a8e6 passed Core Validation 46004331554 (including locked baseline equivalence) and benchmark 46004331307. Initial run state construction moves to state.js, persistent preferences and scores to storage.js, and browser keyboard input, settings, canvas/HUD and audio to presentation.js. Runtime retains active-run ownership, command dispatch, asynchronous turn scheduling, lifecycle and virtual-clock integration. Storage keys, data format, input bindings and renderer effects remain unchanged. The presentation factory uses explicit runtime accessors, with no direct mutable runtime state ownership. All module hashes enter benchmark provenance. Locked equivalence and browser tests remain mandatory before acceptance; no gameplay rule change in this slice.

## Phase 5 controlled experiments

Modularization at ba77563e5cbbb0e81d568de4f9403d4c6bcdbd2d passed the locked equivalence gate and 1,500-run benchmark. See TACTICS.md for the Node-only tactical-v1 candidate and paired screening contract. Default baseline rows remain unchanged; the legacy equivalence gate continues to protect shipping behavior. No tactical parameters are promoted merely by a passing experiment.

## Tactical v2 screening

V1 failed the difficulty-gradient criterion (see TACTICS.md). V2 replaces sequential candidate reservation with bounded joint assignment and leaves Standard as the baseline control. Re-run the same 900-run screen; the policy identifier is tactical-v2. V1 is retained in Git history, not as an additional runtime policy. The legacy parity gate continues to apply.

## Held-out tactical evaluation

V2 screening passed technical gates but did not establish monotonic difficulty. Run npm run lab:heldout for the predeclared independent seed set 10001–10100. The comparative artifact is dist/lab/held-out.json; it includes source provenance, all baseline and candidate rows, paired comparisons and finite-sample censoring bounds. The original screening artifact remains distinct. Default engine and legacy parity output are unchanged. See TACTICS.md for interpretation and promotion constraints.

## Containment comparison

The held-out v2 receipt confirms meaningful Hard differentiation but weak Hardcore separation. Run npm run lab:containment for a new 3,000-run v2/v3 comparison on seeds 20001–20100. Report referencePolicy/candidatePolicy explicitly (the legacy report field baseline refers to v2 in this experiment). The result is dist/lab/containment.json. Standard and Hard are unchanged controls. The existing v2 screening and held-out runs remain reproducible; browser and legacy parity checks are unchanged. V3 is evaluation only.

## Planner profiling

npm run lab:profile writes dist/lab/profile.json. Separate CI workflow AI Planner Profile isolates computational and mechanism evidence from the survival experiment. The 120 synthetic fixtures and 720 timed planner invocations compare v2 and v3 under identical input, including the six-enemy upper bound. See TACTICS.md for limitations and interpretation.

## Adversarial screen

V3 did not pass the difficulty-gradient criterion. npm run lab:adversarial compares v2 with v4 on 40001–40030 and writes dist/lab/adversarial.json. The expanded profile includes contested layouts and all three candidate versions, reports bounded response search cost, and retains earlier experiments in Git history and CI artifacts. Legacy gameplay and baseline equivalence remain unchanged.
