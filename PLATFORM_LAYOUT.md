# Platform Layout

- `app/web` — desktop/web build used by Electron (`main.js` loads `app/web/index.html`).
- `app/ios` — iOS build source used by Capacitor (`capacitor.config.json` points `webDir` here).
- `app/android` — Android build source (currently copied from web baseline; can diverge later).

Notes:
- iOS now uses a non-obfuscated `game.js` at `app/ios/game.js`.
- Shared assets are currently duplicated per platform folder for isolation.
