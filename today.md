# today.md — Session Checkpoint

> Update this at the **end of every session**. Read it at the **start of every session** to resume smoothly.

---

## Last Updated

2026-05-01 — Sidecar wiring complete. `.app` is fully self-contained with Node binary + build/.

---

## What Was Done

- Refined AGENTS.md into a lean router (<50 lines)
- Created `docs/architecture.md`, `docs/ccapi-endpoints.md`, `patterns.md`
- Decided on final architecture and build plan (see below)
- Verified Tauri release build: `pnpm check` ✅, `pnpm build` ✅, `pnpm tauri build` ✅
- Fixed: Rust not on PATH → source `~/.cargo/env` (already installed via rustup)
- Fixed: DMG bundling requires `create-dmg` (not installed) → set `targets: ["app"]` in `tauri.conf.json`
- Fixed: unused `use tauri::Manager` import in `lib.rs`
- **Sidecar wiring complete:**
  - Copied Node binary → `src-tauri/binaries/node-server-aarch64-apple-darwin`
  - Added `externalBin` + `resources: {"../build": "build"}` to `tauri.conf.json`
  - Added `shell:allow-execute` + `shell:allow-spawn` to capabilities
  - Rewrote `lib.rs`: spawns sidecar with `build/index.js`, polls `localhost:3000` (40×250ms), then creates WebView window
  - Added `ureq = "2"` to `Cargo.toml` for HTTP health-check
  - Verified: `Contents/MacOS/node-server` (112MB) + `Contents/Resources/build/` both present in `.app`
- **First-launch onboarding modal:**
  - New `OnboardingModal.svelte` — full-screen prompt on first run asking for camera IP/port/protocol
  - Gated by `localStorage.getItem('camera_configured')` — shown only once, dismissed after connect
  - SSE stream deferred until after onboarding completes
- **Bundle ID** changed to `cc.featherbear.tethr`

---

## Architecture (locked)

- **Tauri v2** = thin native shell only; spawns SvelteKit Node server as a sidecar in production
- **SvelteKit server routes** = all camera communication (CCAPI proxy + SSE long-poll loop)
- **Svelte 5 frontend** = pure UI client; uses `EventSource` + `fetch` to its own API routes
- **No FTP mode** for v1
- **No Rust camera code** — Tauri only manages the window and sidecar process

---

## Build Plan

| # | Milestone | Effort | Status |
|---|---|---|---|
| M0 | Scaffold: Tauri v2 + SvelteKit (adapter-node) + sidecar wiring | ½ day | ✅ Done |
| M1 | Mock CCAPI server (`mock/ccapi-server.ts` in Bun) | ½ day | ✅ Done |
| M2 | SvelteKit API routes: CCAPI proxy (contents, thumbnail, fullres, camera IP) | 1 day | ✅ Done |
| M3 | SSE event stream (`/api/events` long-poll loop → EventSource) | ½ day | ✅ Done |
| M4 | Svelte UI: photo grid, PhotoCard (shimmer→thumb→fullres), StatusBar, CameraConfig | 1 day | ✅ Done |
| M5 | Polish: reconnect, error states, Tauri window config, macOS packaging | 1 day | ✅ Done |

---

## Last Updated

2026-05-03 — Logging + connection manager rewrite complete.

## What Was Done (this session)

- Added pino.js logging throughout: `src/lib/server/logger.ts` (server), `src/lib/logger.ts` (browser)
- Three log modes via `LOG_MODE` env var: `pretty` (default dev), `waterfall` (multi-column), `json` (prod)
- Custom waterfall transport: `src/lib/server/transports/waterfall.mjs` — per-module columns, level colours
- Rewrote `monitor.ts`: explicit 3-phase state machine (VERIFY → CONNECT → LIVE), separated from camera.ts
- Rewrote `camera.ts`: clean queue, `cameraFetch()` (queued) vs `cameraFetchDirect()` (stream/probes)
- Added `CCAPI_EVENT_MODE` env var: `monitoring` (default, binary stream) or `polling` (re-poll loop, plain JSON)
- Monitor starts lazily on first SSE client (`/api/events`), not on boot — avoids queue contention
- Fixed default camera IP to `192.168.1.26`
- Fixed `stopExistingSession` to probe `deviceinformation` not the monitoring path itself

## Next Steps

1. **Test with mock** — run `pnpm dev:mock` in `tethr/` and open http://localhost:1420; shots should auto-fire every 5s
2. **Test with real camera** — set `CCAPI_BASE_URL=http://<camera-ip>:8080 pnpm dev` or enter IP in the UI and click Connect
3. **Smoke-test the `.app`** — double-click `src-tauri/target/release/bundle/macos/tethr.app` and verify the window opens and connects to the local Node server
4. **Test with real camera** — set `CCAPI_BASE_URL=http://<camera-ip>:8080 pnpm dev` or enter IP in the UI and click Connect
5. **DMG** — install `create-dmg` via `brew install create-dmg` and change `targets` back to `["app", "dmg"]` when ready to distribute

---

## Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Camera comms location | SvelteKit server routes only | Clean separation; frontend is a pure client |
| Long-poll handling | SSE via `/api/events` server route | Avoids persistent browser connection; clean stream |
| Production packaging | Tauri sidecar (Node binary + build/) | Full native app, not just dev mode |
| FTP mode | Deferred to v2 | Simplify v1 scope |
| Tauri Rust code | Window + sidecar spawn only | All logic in SvelteKit |
