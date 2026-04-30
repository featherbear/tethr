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

### CCAPI real-time events use ver100/event/monitoring, not ver110/event/polling
- **Symptom:** ver110/event/polling returns immediately with `{}` (not blocking), flooding the SSE stream with `status:live` events. No shot notifications received.
- **Root cause:** `ver110/event/polling` is not the blocking streaming endpoint on the R6 Mark II. `ver100/event/monitoring` is the correct endpoint — it streams a persistent binary-framed chunked response containing all camera events including `addedcontents` on new shots.
- **Fix:** Use `GET /ccapi/ver100/event/monitoring`, stream-read the response body, parse binary frames (magic `ff ffff 00 02 00 00 00` + 4-byte BE length + JSON), and filter for `addedcontents` arrays.
- **Prevention:** Always verify event endpoint behaviour with `curl --max-time` before implementing. The monitoring endpoint streams continuously; the polling endpoint is for one-shot checks only.

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
