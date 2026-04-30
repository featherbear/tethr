# patterns.md — Experience Replay

> When a bug is corrected or a pitfall is discovered, **write it here immediately**.  
> At the start of a debugging session, **search here first**.

---

## Format

```
### [Short title of the problem]
- **Symptom:** What went wrong / what error appeared
- **Root cause:** Why it happened
- **Fix:** What resolved it
- **Prevention:** How to avoid it in the future
```

---

## Patterns

### SvelteKit SSR crash: relative fetch in onDestroy
- **Symptom:** Server crashes on startup with `Cannot call fetch eagerly during server-side rendering with relative URL`
- **Root cause:** `onDestroy` runs during SSR rendering on the server, so any `fetch()` or browser API inside it fires server-side where relative URLs are invalid
- **Fix:** Guard browser-only functions with `import { browser } from '$app/environment'` and `if (!browser) return` at the top
- **Prevention:** Any function using `fetch()`, `EventSource`, `localStorage`, or `URL.createObjectURL` must be browser-guarded if reachable from lifecycle hooks

### CCAPI monitoring stream binary frame format (verified on R6 Mark II)
- **Frame format — two variants interleaved in the same stream:**
  - First frame:       `ff 00 02` + 4-byte BE length + JSON  (7-byte header)
  - Subsequent frames: `ff ff ff 00 02` + 4-byte BE length + JSON  (9-byte header)
- **Empty frames** (`length=2`, payload `{}`) are heartbeats — skip them
- **`addedcontents`** array in a frame = new file paths on the card (shot notification)
- **On connect:** camera immediately delivers all queued shots since last session
- **No timeout** on the fetch — this is a persistent stream; `AbortSignal.timeout()` applies to the entire response including body reads, causing false reconnects
- **Correct parser:** detect header variant by inspecting bytes 1-4; extract length from the right offset; advance buffer by `headerSize + payloadLen`

### CCAPI event endpoints: monitoring vs polling
- **Symptom:** SSE stream floods with `status:live` events; no shot notifications received.
- **Root cause:** `ver110/event/polling` returns `{}` immediately when camera activity causes queued events (e.g. changing a dial). It DOES block until an event when idle. Both endpoints return `addedcontents` on shots. The issue was: the loop was calling polling in a tight loop and sending `status:live` after EVERY response (including non-shot events).
- **ver100/event/monitoring:** Persistent binary-framed stream. Frame format: `ff ffff 00 02 00 00 00` + 4-byte BE length + JSON. Best for continuous monitoring.
- **ver110/event/polling:** Blocks until any event, returns flat JSON, closes. Simpler to parse (no binary framing) but must be re-issued after each response.
- **Fix used:** Switch to monitoring stream; send `status:live` only once on connect; parse binary frames; filter only `addedcontents`.
- **Prevention:** Test endpoints with `curl --max-time` and actually take a shot before concluding they don't work.

### CCAPI 503 "Already started" on event polling
- **Symptom:** `GET /ccapi/ver110/event/polling` returns HTTP 503 with `{"message":"Already started"}`
- **Root cause:** Camera allows only one active polling session at a time. A previous connection that disconnected without cleanup leaves a stuck session.
- **Fix:** Before starting the poll loop, `DELETE /ccapi/ver110/event/polling` AND `DELETE /ccapi/ver100/event/monitoring` to clear any stuck session. Also DELETE on clean disconnect and on reconnect after backoff.
- **Prevention:** Always wrap polling start/stop with `resetPollingSession()` — never assume the camera is in a clean state on connect.

### CCAPI endpoint versions differ from documentation
- **Symptom:** Requests return 404 or incorrect data
- **Root cause:** The R6 Mark II uses `ver110` for event polling and `ver120` for contents — not `ver100` as older docs suggest. Always verify against `GET /ccapi` capabilities response first.
- **Fix:** Query `GET /ccapi` to discover supported versions and paths before assuming any endpoint URL.
- **Prevention:** Add a capabilities check on connect; store supported paths rather than hardcoding versions.

### SvelteKit +server.ts only allows HTTP method exports
- **Symptom:** `Error: Invalid export 'myFunction' in /api/route` at build time
- **Root cause:** SvelteKit enforces that `+server.ts` files only export `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback`, `prerender`, `trailingSlash`, `config`, `entries`, or `_`-prefixed names
- **Fix:** Move any shared logic into `src/lib/server/` and import from there
- **Prevention:** Never export non-HTTP named functions from `+server.ts` files; all reusable server utilities live in `$lib/server/`

### Tauri svelte-ts scaffold defaults to adapter-static + SPA mode
- **Symptom:** Server routes (`+server.ts`) don't work; SSR is disabled
- **Root cause:** `pnpm create tauri-app` uses `adapter-static` with `ssr = false` in `+layout.ts` by default (Tauri docs recommend SPA mode for static builds)
- **Fix:** Replace `adapter-static` with `adapter-node` in `svelte.config.js`; remove `export const ssr = false` from `+layout.ts`; add `@types/node` and `"types": ["node"]` to `tsconfig.json`
- **Prevention:** Do this immediately after scaffolding, before writing any other code
