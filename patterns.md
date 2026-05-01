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

### CCAPI serial queue must be server-side, not client-side
- **Symptom:** 502/503 errors during burst shooting even with a client-side serial queue
- **Root cause:** Multiple SvelteKit API routes (`/api/thumbnail`, `/api/fullres`, `/api/camera/info`) can be called concurrently by the browser or SSE events. Client-side serialisation only controls client→server requests, not server→camera requests.
- **Fix:** Add a server-side promise-chain queue in `cameraFetch()`. Use `globalThis` to survive Vite HMR reloads. Persistent streams (monitoring) must bypass the queue via a separate `cameraFetchRaw()` — otherwise the stream would block all other requests.
- **Prevention:** Any app talking to a single-threaded API must serialise at the server layer, not the client layer. The client has no visibility into other concurrent server-side requests.

### CCAPI is single-threaded — concurrent requests cause 503
- **Symptom:** Second simultaneous fetch to camera returns HTTP 503
- **Root cause:** CCAPI processes one HTTP request at a time. Concurrent fetches (e.g. thumbnail for CR3 and JPG arriving together) will 503 on the second request.
- **Fix:** Serialise all camera fetches through a queue. Only one in-flight request at a time.
- **Prevention:** Never fire concurrent `cameraFetch()` calls. Use a queue with priority ordering (e.g. JPG before CR3 for thumbnails).

### AbortSignal.timeout() kills streaming body reads, not just TCP connect
- **Symptom:** Persistent SSE/streaming connections disconnect after N seconds with `TimeoutError`
- **Root cause:** `AbortSignal.timeout(N)` starts a timer when the fetch begins. It aborts the entire request — including ongoing body reads — after N ms, even if the connection is healthy.
- **Fix:** Do not use `AbortSignal.timeout()` on persistent streaming connections. Only use it for discrete request/response calls (e.g. DELETE, GET of small JSON).
- **Prevention:** Distinguish between "connect timeout" (discrete requests) and "stream lifetime" (persistent body reads). Never set a timeout on a streaming fetch.

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

### Vite HMR resets module-level state — use globalThis for server singletons
- **Symptom:** Monitor loop restarts on every file save in dev; SSE stream floods with `connecting → live → connecting`
- **Root cause:** Vite HMR re-executes server modules on save, resetting all module-level `let` variables. The monitor loop's AbortController, status, and subscribers are wiped, triggering a restart.
- **Fix:** Store all persistent server state on `globalThis` with an init-once guard: `if (!(key in globalThis)) globalThis[key] = init()`
- **Prevention:** Any server singleton (monitor loop, camera connection, shared state) must use `globalThis` keys, not module-level variables. Also guard `startMonitor()` in `hooks.server.ts` with a status check so HMR re-execution is a no-op.

### SSE duplicate events from subscribe() sending initial state on reconnect
- **Symptom:** Browser DevTools EventStream shows duplicate `settings` events on page load or EventSource reconnect
- **Root cause:** `subscribe()` was sending current state to every new subscriber immediately. Browser `EventSource` auto-reconnects on drop, triggering another subscribe + initial burst.
- **Fix:** Serve initial state via a dedicated REST endpoint (`/api/state`) on page load. `subscribe()` should only send status (needed for immediate render), not settings. SSE events become pure delta updates.
- **Prevention:** Keep SSE as a delta-only channel. Never use `subscribe()` to replay full state — use REST for snapshots, SSE for changes.

### Mutable `$state` written inside `$effect` creates feedback loops that cancel transitions
- **Symptom:** Svelte `in:fade` transition starts but `onintroend` never fires; image swap never completes
- **Root cause:** Writing `$state` inside `$effect` causes the effect to re-run when that state changes. If the re-run modifies the reactive condition governing a `{#if}` or `{#key}` block, Svelte may unmount/remount the transitioning element mid-animation, cancelling the transition.
- **Fix:** Replace mutable `$state` intermediaries with `$derived` values computed directly from the source data. The transition block's key only changes when the underlying data changes, not on every effect re-run.
- **Prevention:** In Svelte 5, avoid writing `$state` from inside `$effect` when that state controls transition blocks. Use `$derived` for values that drive UI transitions.

### `displayProgress` (or similar in-progress flags) must reset to `null` on failure
- **Symptom:** After a failed fetch, the shimmer stays on forever; idle prefetch skips the photo; future fetches are silently blocked
- **Root cause:** Setting `displayProgress = 0` (a number) on failure looks like "in progress" to all consumers. Guards like `if (displayProgress !== null) return` correctly skip re-fetching.
- **Fix:** On any fetch failure or catch, set `displayProgress = null` to return to "idle" state, allowing retries and clearing shimmer indicators.
- **Prevention:** Treat `null` as "not started/idle" and any number (including 0) as "in progress". Always reset to `null` in error/catch paths, never to a number.

### `onintroend` closures capture reactive variables at callback time, not render time
- **Symptom:** `onintroend` updates the wrong state — it uses a value that has changed since the element was mounted
- **Root cause:** `onintroend` is a closure that captures reactive variables by reference. If `photo` or another reactive value changes before the transition ends, the callback reads the new value, not the original.
- **Fix:** Use `{@const capturedUrl = reactiveValue}` inside the template to freeze the value at render time, then reference `capturedUrl` in the callback.
- **Prevention:** Any transition callback (`onintroend`, `onoutroend`) that reads a reactive variable should use a `{@const}` capture inside the `{#key}` or `{#if}` block.

### `const enum` not supported in Svelte `<script>` blocks
- **Symptom:** `svelte-check` error: "TypeScript language features like enums are not natively supported"
- **Root cause:** Svelte's compiler processes `<script>` blocks before TypeScript, so `const enum` (which requires type-level erasure) is not supported without extra preprocessor config.
- **Fix:** Replace `const enum Foo { A = 0, B = 1 }` with `const Foo = { A: 0, B: 1 } as const; type FooValue = typeof Foo[keyof typeof Foo];`
- **Prevention:** Avoid all TypeScript-only features in `.svelte` files (`const enum`, `namespace`, decorators). Move them to `.ts` files if needed, or use `as const` objects.

### Tauri svelte-ts scaffold defaults to adapter-static + SPA mode
- **Symptom:** Server routes (`+server.ts`) don't work; SSR is disabled
- **Root cause:** `pnpm create tauri-app` uses `adapter-static` with `ssr = false` in `+layout.ts` by default (Tauri docs recommend SPA mode for static builds)
- **Fix:** Replace `adapter-static` with `adapter-node` in `svelte.config.js`; remove `export const ssr = false` from `+layout.ts`; add `@types/node` and `"types": ["node"]` to `tsconfig.json`
- **Prevention:** Do this immediately after scaffolding, before writing any other code
