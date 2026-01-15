# One More Move

A deterministic, turn-based grid survival prototype built with vanilla Canvas and packaged in Electron.

## Setup

```bash
npm install
```

## Run (Desktop)

```bash
npm run dev
```

## Spawn Pacing Simulator

```bash
npm run sim
```

## Build

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

### Windows Installer Output

- `npm run build:win` produces an NSIS installer (`.exe`) under `dist/`.
- The installer bundles all runtime dependencies; no separate Node/Electron install is required.

## Controls

- Move: Arrow keys or WASD
- Threat forecast overlay: Hold Space
- Restart: R

## Steam Packaging Note

- Set the launch executable correctly in Steamworks (point to the built app executable).
- Test a fresh install using a Steam branch to confirm packaging behavior.

## Manual Acceptance Checklist

- Invalid move does not advance turns or spawns
- Overlay matches enemy intended tiles
- Enemies never stack
- Spawns never adjacent to player
- Best persists across relaunch
