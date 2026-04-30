# Architecture

> On-demand reference. Read this when working on camera integration, Tauri events, or the overall data flow.

---

## Goal

Native desktop app (macOS) that connects to a **Canon EOS R6 Mark II** over WiFi (CCAPI) and previews photos in real-time as they are taken.

---

## Layered Architecture

```
┌─────────────────────────────────────────────────────┐
│  Tauri v2 (Rust)  — thin native shell only          │
│  • Opens a native window                            │
│  • Spawns SvelteKit Node server as a sidecar        │
│  • Fullscreen toggle via Tauri window API           │
│  • No camera logic whatsoever                       │
└──────────────┬──────────────────────────────────────┘
               │ renders (WebView → localhost)
┌──────────────▼──────────────────────────────────────┐
│  SvelteKit  (adapter-node, runs as local server)    │
│                                                     │
│  SERVER ROUTES (+server.ts) — all camera I/O:      │
│  ┌─────────────────────────────────────────────┐   │
│  │ /api/events          SSE stream             │   │
│  │   └─ holds open CCAPI long-poll loop        │   │
│  │      forwards shots as text/event-stream    │   │
│  │ /api/contents        list photos on card    │   │
│  │ /api/thumbnail/[..path]  proxy thumb bytes  │   │
│  │ /api/fullres/[..path]    proxy fullres bytes│   │
│  │ /api/camera          GET/POST camera IP     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  SVELTE FRONTEND — pure UI client:                  │
│  ┌─────────────────────────────────────────────┐   │
│  │ EventSource('/api/events')  ← shot events   │   │
│  │ fetch('/api/thumbnail/...')  ← images        │   │
│  │ $state stores, animated photo grid          │   │
│  └─────────────────────────────────────────────┘   │
└──────────────┬──────────────────────────────────────┘
               │ HTTP on port 8080 (same WiFi)
┌──────────────▼──────────────────────────────────────┐
│  Canon EOS R6 Mark II  (CCAPI)                      │
└─────────────────────────────────────────────────────┘
```

**Key principle:** The SvelteKit server is the only thing that ever speaks to the camera. The Svelte frontend and Tauri GUI are pure clients of the SvelteKit server.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Native shell | Tauri v2 (Rust) | Window management, sidecar spawn only |
| Server | SvelteKit + `adapter-node` | Runs as a local Node HTTP server |
| Frontend | SvelteKit + Svelte 5 | Runes only (`$state`, `$derived`, `$effect`) |
| Camera API | Canon CCAPI — HTTP on port 8080 | Server-side only |
| Package manager | `pnpm` | Never `npm` or `yarn` |

---

## Production Packaging (Sidecar)

In production, the SvelteKit app is compiled with `adapter-node` to a `build/` directory. Tauri bundles:
1. The `build/` output (SvelteKit server)
2. A Node.js binary as a **Tauri sidecar**
3. `main.rs` spawns the Node sidecar on startup, waits for it to be ready, then opens the window

```
Tauri app launches
  └─ spawn sidecar: node build/index.js (port 3000)
       └─ wait for HTTP 200 on localhost:3000
            └─ open WebView window → http://localhost:3000
```

In dev: `beforeDevCommand: "pnpm dev"` — Vite dev server, no sidecar needed.

---

## Key CCAPI Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /ccapi/ver100/contents/storage1/card1` | List photos on card |
| `GET /ccapi/ver100/contents/.../{file}?kind=thumbnail` | Fetch JPEG thumbnail |
| `GET /ccapi/ver100/contents/.../{file}?kind=original` | Fetch full-res original |
| `GET /ccapi/ver100/event/polling` | Long-poll — blocks until new-shot event fires |

See `docs/ccapi-endpoints.md` for full request/response shapes.

---

## Data Flow: New Shot

```
1. Camera takes photo
2. CCAPI /event/polling unblocks → returns shotnotification JSON
3. SvelteKit /api/events SSE loop reads response
4. Emits Server-Sent Event to browser: data: {dirname, filename}
5. Svelte EventSource handler fires:
   a. Prepends placeholder card to $state photos[]
   b. fetch('/api/thumbnail/...') → streams JPEG bytes
   c. Updates photo card: shimmer → thumbnail
6. Background: fetch('/api/fullres/...') newest-first
   d. Updates photo card: thumbnail → full-res (CSS crossfade)
```

---

## SvelteKit Route Map

```
src/routes/
  +page.svelte                      ← main UI (photo grid)
  api/
    events/+server.ts               ← SSE stream (long-poll loop)
    contents/+server.ts             ← list photos
    thumbnail/[...path]/+server.ts  ← proxy thumbnail bytes
    fullres/[...path]/+server.ts    ← proxy full-res bytes
    camera/+server.ts               ← GET/POST camera IP setting
```

---

## Svelte Component Map

```
src/lib/
  stores/
    photos.svelte.ts      ← $state: Photo[], connection status
    camera.svelte.ts      ← $state: camera IP, settings
  components/
    PhotoGrid.svelte       ← CSS grid, newest-first, entry animation
    PhotoCard.svelte       ← shimmer → thumbnail → full-res states
    StatusBar.svelte       ← idle | connecting | live | error lozenge
    CameraConfig.svelte    ← IP input, connect/disconnect button
```

---

## Tauri Responsibilities (exhaustive list)

| What | How |
|---|---|
| Native window | `tauri.conf.json` window config |
| Spawn SvelteKit server (prod) | `tauri-plugin-shell` sidecar |
| Fullscreen toggle | `@tauri-apps/api/window` |
| macOS title bar / traffic lights | Default Tauri window chrome |

That's it. No Tauri commands, no Rust camera code.

---

## Feature Scope

- **In scope (v1):** Real-time photo preview — thumbnails first, lazy full-res
- **Out of scope (v1):** Remote shutter, camera settings, FTP mode, multi-camera, cloud sync
