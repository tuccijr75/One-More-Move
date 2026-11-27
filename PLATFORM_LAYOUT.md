# Platform Layout — Web-first migration

Owner-approved target: one responsive browser game, used on desktop, phones and tablets. No separate iOS or Android product, Capacitor pipeline or native mobile release. The existing native copies are historical source only; do not edit, sync or package them. The separate Roblox implementation remains outside this migration and requires parity checks against any later gameplay revisions.

## Active source and outputs

- `app/game.js`: canonical gameplay engine; unchanged in the first migration slice.
- `app/index.html`, `app/style.css`, `app/touch-controls.js`, `app/assets/`: canonical browser presentation.
- `dist/web/`: generated, checked standalone HTML5 release directory; zip its contents with index.html at root for itch.io.
- Electron `main.js`: loads the same canonical app/index.html for Game Jolt desktop packaging; no platform-copy engine.
- `dist/desktop/`: desktop packaging output.

Run `npm run check` before release. Run `npm run build:web` and `npm run check:web` for web output; run `npm run build` for desktop packaging with dependencies installed. No publish is automated.

Legacy `app/web`, `app/ios`, `app/android`, Capacitor config and old iOS notes are retained for historical reference and excluded from active packaging. The old iOS workflow is archived outside .github/workflows. Do not use these copies for new releases.
