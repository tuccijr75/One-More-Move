# Phase 5 acceptance — proposed, not approved

Candidate: web/desktop canonical baseline Standard, joint v2 Hard, adversarial v4 Hardcore. Roblox isolated port. No shipping changes authorized by this document.

## Evidence and remaining gates
- Independent benchmark 46008991880, stage qualification 46009381883 and integration 46013229990 passed.
- Roblox build 46013238013 passed. Download OneMoreMove-Tactical-Tests artifact 15205150754, extract, open OneMoreMoveTactical.rbxlx in Studio and Run. Record full TACTICAL_PASS or failure. Do not publish.
- Full-state diagnostic: review TRACE_AUDIT and TRACE_DIFF from current CI. Reconcile measured differences against app/rules.md and approved migration, with owner decision if behavior changes. Re-run strict gates.
- Hard late-tail survival exceeds Standard in the held-out sample; human difficulty acceptance is required. v4 high-stage performance and effectiveness not certified.
- Portal accounting: existing zero-turn transition retained; owner decision required before changing.
- Candidate playtest build must be isolated, opt-in, visibly marked non-competitive; not a live deployment. Owner approval before customer-visible hosting or adoption.

## Human acceptance procedure (proposed)
Use the same candidate revision on desktop browser, iOS Safari, Android Chrome, and Electron Windows. Record device/OS/browser/build/seed/difficulty, outcomes and failure reproduction. Test keyboard, tap, direction buttons, diagonal, Phase stun, Wall Ignore, Freeze, single-finger Time Freeze, cooldown, restart/settings, portrait/landscape, no clipping/scroll, portal/stage transition and extra life. Include 50 reachable portal checks across seeds per governing rules, kill priority, corridor pursuit, coordination, stage 1/10/25 and recovery. Use staged diagnostic scenarios for late stages; distinguish them from naturally reached stages. Measure planning p50/p95/max on actual devices separately from intentional animation delay; proposed p95 <= 50ms on target mobile, no long-task-induced input loss, subject to approval. Compare Standard/Hard/Hardcore using fixed seeds and paired human sessions; record perceived difficulty and fairness rather than relying on simulated survival alone. Failure blocks promotion until reviewed.

## Owner decision
Review evidence and unresolved discrepancies. Approve or reject exact policy mapping, parity changes, portal accounting (separate decision), candidate test hosting and later production release separately. No main merge, publication, secret storage, or new mobile-native build.
