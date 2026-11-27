# Mobile acceptance evidence

## Accepted baseline

- Tested revision: `08220b7c33a3f40dc007e7088072592987b97a22`
- Test deployment: https://one-more-move-test-r6gnbi5lu-michaels-projects-8189ed9c.vercel.app
- Automated baseline validation: https://github.com/tuccijr75/One-More-Move/actions/runs/45929084515
- Evidence: owner-reported device acceptance results, received November 26, 2026 (America/New_York).
- Device model, operating-system version, browser version, test duration and seed were not supplied; do not infer them.

| Criterion | Owner result |
|---|---|
| Board fits screen without horizontal scrolling | PASS |
| Tap-to-move responds correctly | PASS |
| Directional buttons work | PASS |
| Diagonal movement works when earned | PASS |
| Phase Step and Wall Ignore work | PASS |
| Freeze Turn works | PASS |
| Time Freeze works with one finger | PASS |
| Restart, difficulty and settings work | PASS |
| Portals and stage transitions work | PASS |

Outcome: 9/9 reported checks pass for this baseline. This is initial physical-device acceptance, not proof of all device/browser combinations or final release approval.

## Subsequent gameplay integrity revision

Revision `1856943dd70389172cd2ecfaf60dac2601fd50c8` changes stun expiration, diagonal cooldown enforcement and unit-direction validation. Core Validation succeeded (https://github.com/tuccijr75/One-More-Move/actions/runs/45929507278). Roblox validation was still in progress when this record was prepared. These changes are not covered by the owner's baseline device report.

## Remaining gates

- Retest changed gameplay on the next candidate, especially diagonal cooldown and Phase Step stun expiry.
- Verify target browsers and iframe embedding; verify the Windows installer.
- Complete gameplay integrity audit and later modernization phases before the final 2.0 release.
- No public upload or main-branch merge authorized by this acceptance record.
