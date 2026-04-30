# today.md — Session Checkpoint

> Update this at the **end of every session**. Read it at the **start of every session** to resume smoothly.

---

## Last Updated

2026-05-01 — All milestones built and verified against live R6 Mark II. Real camera connected over HTTPS.

---

## What Was Done

- Refined AGENTS.md into a lean router (<50 lines)
- Created `docs/architecture.md`, `docs/ccapi-endpoints.md`, `patterns.md`
- Decided on final architecture and build plan (see below)

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

## Next Steps

1. **Test with mock** — run `pnpm dev:mock` in `tethr/` and open http://localhost:1420; shots should auto-fire every 5s
2. **Test with real camera** — set `CCAPI_BASE_URL=http://<camera-ip>:8080 pnpm dev` or enter IP in the UI and click Connect
3. **Tauri production bundle** — `pnpm tauri build` to generate the macOS `.app`; sidecar Node binary still needs to be bundled (see docs/architecture.md)

---

## Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Camera comms location | SvelteKit server routes only | Clean separation; frontend is a pure client |
| Long-poll handling | SSE via `/api/events` server route | Avoids persistent browser connection; clean stream |
| Production packaging | Tauri sidecar (Node binary + build/) | Full native app, not just dev mode |
| FTP mode | Deferred to v2 | Simplify v1 scope |
| Tauri Rust code | Window + sidecar spawn only | All logic in SvelteKit |
