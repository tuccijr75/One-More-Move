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
