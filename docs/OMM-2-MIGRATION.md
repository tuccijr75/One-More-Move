# One More Move 2.0 — approved direction and controlled migration

Baseline: 5319f0ec4e75abce27154f6457192ce4836e1a29. Owner approved modernization recommendations and explicitly replaced native iOS/Android builds with mobile-compatible web play.

## Authority

app/rules.md remains governing gameplay requirements unless explicitly superseded. Preserve the existing game identity: 10×10 grid, deterministic turn-based survival, portal progression, Focus abilities, difficulty profiles and minimalist visual language. Keep vanilla JS/HTML/CSS/Canvas. The owner approved incremental modular architecture as the target; do not replace the canonical engine until behavioral fixtures and evidence gates support the change. No new gameplay rules or release version are locked merely because an exploratory suggestion was approved as a direction. The wall persistence wording conflict (rules §1.2 vs §6.4) remains logged; baseline implements §6.4. Confirm before changing behavior.

## Sequence and acceptance gates

1. Web-first release parity (this branch): direct canonical Electron entry, standalone web distribution with byte-level checks, touch movement and single-finger Time Freeze; retain baseline gameplay. Retire native build path, retain historical source. CI runs full existing regression suite plus new adapter tests; manual Safari/iOS and Chrome/Android, desktop keyboard and installer launch checks remain mandatory.
2. Gameplay integrity: reproduce or dismiss suspected stun expiry, diagonal cooldown, time freeze parity, portal turn accounting, ability-aware escape and storage issues. Fix confirmed defects only; test exact turn/state outcomes and update Roblox parity when appropriate.
3. Simulation laboratory: headless deterministic strategies (random, greedy escape, portal rush, defensive, tactical), report survival/stage distributions, unavoidable death proxy, reward use, portal reachability, coordination and difficulty separation. Start with smaller smoke suites; target 10,000+ runs/configuration only after bounded profiling. Store seed, configuration, strategy, engine revision and reproducible output. No balance changes until baseline exists.
4. Modularize incrementally: simulation/state/movement/abilities/progression/config, AI/pathfinding/coordination, generation/RNG, presentation/input/storage. Keep engine behavior identical on locked seed and command traces; maintain one source for web and desktop. No external runtime dependency unless necessary and approved.
5. Tactical intelligence: evaluate dynamic pursuer/interceptor/flanker/containment assignments with difficulty-specific planning horizons (1/2/3 as candidate defaults), maintain kill priority and chase-first invariants, improve threat/death feedback and Focus readability, measure procedural fairness. Adopt parameters only after simulation and human tests.
6. Retention: preserve existing daily/replay seed functionality; improve shareable challenges, statistics, onboarding, leaderboards, achievements, themes and weekly challenges. Same-seed multiplayer and challenge creation are later work. Backend, privacy, verification, hosting and commercial commitments require separate design gates; do not claim implementation before evidence.

## Definition of done

Each slice: narrow diff, source-owned implementation, deterministic regressions, evidence of test runs, review, and no unapproved changes to gameplay contracts. Final 2.0 release requires all selected features and gates completed, verified web ZIP and Windows package, mobile browser checks, regression of published baseline, and explicit approval before public upload. The migration branch is not a release certification.
