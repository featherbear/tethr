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

### Blocking camera fetch before setStatus('live') causes stuck 'connecting' state
- **Symptom:** UI stays on "Connecting" indefinitely even though camera is reachable (e.g. `/api/camera/info` returns data)
- **Root cause:** The monitor loop fetched initial shooting settings via `cameraFetch()` (serial queue) *before* calling `setStatus('live')`. If the queue was busy or the settings endpoint was slow/404, `setStatus('live')` was never reached and the UI stayed in `'connecting'`.
- **Fix:** Call `setStatus('live')` immediately after the monitoring stream opens. Settings (av, tv, iso, etc.) arrive naturally from the first monitoring stream frames — no separate fetch needed.
- **Prevention:** Never `await` non-critical camera requests between "stream is open" and `setStatus('live')`. Never add a camera fetch without first probing the endpoint with `curl` to confirm it exists.

### R50 monitoring session stays stuck after disconnect (503 "Already started" loop)
- **Symptom:** App loops between "Connecting" and "live". Camera returns 503 "Already started" even after DELETE succeeds (200 `{}`). `/api/camera/info` called repeatedly.
- **Root cause:** Camera holds monitoring slot until TCP connection is fully closed. Leftover Node keep-alive connections keep it open. After the process dies, camera firmware still needs time to GC the slot internally. DELETE returns 200 but slot isn't immediately free.
- **Fix:** `stopExistingSession()` now polls `cameraFetchRaw(MONITOR_PATH)` + immediate abort every 1s after DELETE, confirming the camera returns non-503 before the outer loop retries. Up to 4 attempts (~4s).
- **Diagnosis:** `lsof -i @<camera-ip>` shows leftover ESTABLISHED connections from stale node processes. Kill them with `kill -9 $(lsof -ti @<camera-ip>)`.
- **Prevention:** Always kill dev server cleanly; `Connection: close` header on the monitoring stream helps but isn't sufficient on its own.
- **Note:** `/ccapi/ver100/shooting/settings` **does exist** on both the R6 Mark II and EOS R50 — returns all shooting settings as `{ key: { value, ability[] } }`. The 404 was a transient error. Always probe with `curl` before concluding an endpoint doesn't exist.

### PhotoCard must render `displayUrl`, not just `fullresUrl`
- **Symptom:** Thumbnail never upgrades to HD on the main grid; badge stays "Preview" forever even after idle prefetch completes
- **Root cause:** The fetch pipeline calls `photosStore.setDisplay()` → sets `displayUrl`. But `PhotoCard` only checked `photo.fullresUrl` for the HD image layer. `displayUrl` was fetched and stored but never rendered.
- **Fix:** Add an `img--display` layer in the card that shows `photo.displayUrl` when `fullresUrl` is absent. Hide the thumbnail when either `displayUrl` or `fullresUrl` is set.
- **Prevention:** When adding a new URL field to the photo store, always trace through to the rendering layer and confirm it's actually displayed.

### Tauri DMG bundling requires `create-dmg` to be installed
- **Symptom:** `pnpm tauri build` succeeds through Rust compile and `.app` bundling, then fails at DMG with `failed to run bundle_dmg.sh`
- **Root cause:** Tauri's DMG bundler delegates to `create-dmg` (a Homebrew tool). If it's not installed, the script exits with "Not enough arguments".
- **Fix:** Either install `create-dmg` via `brew install create-dmg`, or set `"targets": ["app"]` in `tauri.conf.json` to skip DMG generation.
- **Prevention:** On a fresh machine, run `brew install create-dmg` before attempting `tauri build` with DMG targets.

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

### macOS TCC "Downloads folder" prompt from inherited CWD
- **Symptom:** `"tethr" would like to access files in your Downloads folder` — appears when launching the .app from ~/Downloads/. If denied, the window shows a white screen.
- **Root cause:** The Tauri process inherits CWD from the launch location. Any relative path access (ureq health check, temp files) resolves relative to CWD (~/Downloads/), triggering macOS TCC.
- **Fix:** Call `std::env::set_current_dir(&resource_dir).ok()` immediately after resolving `resource_dir` in `setup()`. This moves the process CWD safely inside the .app bundle.
- **Prevention:** Always set CWD explicitly in Tauri apps. Never rely on the inherited CWD being a safe location.

### Tauri sidecar must set current_dir to build/ directory
- **Symptom:** Tauri app starts, server spawns, but GET / returns 500. Server starts fine when run directly from the terminal.
- **Root cause:** std::process::Command inherits the app launcher's CWD (usually / or MacOS/). SvelteKit adapter-node output (index.js) loads chunks via relative paths — these fail when CWD isn't the build/ directory.
- **Fix:** Add `.current_dir(resource_dir.join("build"))` to the Command builder in lib.rs.
- **Prevention:** Always set current_dir explicitly when spawning a Node.js server as a sidecar. Never rely on CWD being correct.

### Tauri sidecar must set NODE_ENV=production explicitly
- **Symptom:** Tauri app starts, terminal shows `500 GET /`, page never loads
- **Root cause:** `std::process::Command` spawning the Node sidecar does not inherit `NODE_ENV`. Without it, `process.env.NODE_ENV` is `undefined`, so `isDev = true` in logger.ts — pino tries to load pino-pretty as a worker thread but it's a devDependency not present in the production bundle.
- **Fix:** Add `.env("NODE_ENV", "production")` to the sidecar spawn in `lib.rs`.
- **Prevention:** Always explicitly set `NODE_ENV` (and any other required env vars) in the Tauri sidecar spawn — it does not inherit the shell environment.

### ReadableStream throws TypeError: 'terminated' on AbortController abort — treat as clean
- **Symptom:** `WARN monitor › Monitoring read error — back to verify errType=TypeError err="terminated"` after config change or HMR reload
- **Root cause:** When the outer `AbortController` fires (e.g. `startMonitor()` called again), Node cancels the fetch body, causing `reader.read()` to throw `TypeError: terminated`. This is intentional cleanup, not a real error.
- **Fix:** In the `catch` block of any `reader.read()` loop, check `signal.aborted` first — if true, return `{ result: 'clean' }` instead of `{ result: 'error' }`.
- **Prevention:** Always check `signal.aborted` in stream read catch blocks before classifying as an error. Abort-triggered throws are not network failures.

### Monitor state machine: verify → connect → live phases must be explicit
- **Symptom:** App cycles live→connecting→live repeatedly; or stays stuck in connecting; or never reaches live consistently
- **Root cause:** A flat `while(true)` reconnect loop that calls `setStatus('connecting')` at the top of every iteration blurs the difference between "camera unreachable" and "stream dropped". One status transition triggers another before any I/O completes.
- **Fix:** Explicit local phase variable (`verify | connect | live`) inside the loop. `setStatus('connecting')` only fires on CONNECT phase entry. Clean stream close (done:true) → CONNECT (skip probe, camera known reachable). Error during read → VERIFY (reachability unknown). 503 → DELETE + fixed delay → retry CONNECT.
- **Prevention:** Any reconnect loop managing a persistent connection needs at least two distinct phases: "is the server reachable?" and "open the stream". Conflating them causes spurious status transitions and split-brain between the probe and the stream.

### Monitoring stream closed gracefully (done: true) causes live→connecting flicker
- **Symptom:** UI briefly shows `live` then immediately `connecting` with no `reconnecting` in between; repeats every few seconds
- **Root cause:** When the camera closes the monitoring stream gracefully, `reader.read()` resolves `{ done: true }`. The inner read loop exits normally (no exception), so the `catch` block is skipped — no backoff is applied, and the outer `while` loop immediately calls `setStatus('connecting')` again.
- **Fix:** After `reader.releaseLock()`, check `!signal.aborted` and apply a fixed short delay (1500ms) + `setStatus('reconnecting')` before looping. Use a **fixed** delay, not the exponential error backoff — clean closes are normal camera behaviour and shouldn't penalise reconnect speed over time.
- **Prevention:** Always handle the normal exit path of a streaming loop separately from the error path. `catch` only runs on throws; a graceful `done: true` is a different code path that needs its own backoff.

### pino-abstract-transport parse:'lines' gives raw strings, not parsed objects
- **Symptom:** Transport receives records where `typeof record === 'string'` and keys are `'0','1','2'...` (character indices)
- **Root cause:** `build(..., { parse: 'lines' })` from `pino-abstract-transport` passes the raw JSON line string to the async iterator, not a parsed object
- **Fix:** In the transport's `for await` loop, always check `typeof line === 'string'` and `JSON.parse(line)` before using as a record object
- **Prevention:** Never assume `pino-abstract-transport` with `parse:'lines'` gives you a parsed object — always parse manually

### Pino logging: server uses pino-pretty in dev, JSON in prod; browser uses pino browser build
- **Pattern:** `src/lib/server/logger.ts` exports a shared pino logger + `childLogger(module)` for per-file child loggers. In dev (NODE_ENV !== 'production'), pino-pretty is wired as a transport for human-readable output. In prod, plain JSON lines go to stdout.
- **Frontend:** `src/lib/logger.ts` exports a pino browser logger (`asObject: false`) — logs go to `console.*`. Level is `debug` in dev, `warn` in prod to suppress noise in the bundled app.
- **Log levels used:** `debug` for per-request/per-frame noise; `info` for lifecycle events (connect, shot, thumbnail loaded); `warn` for recoverable errors and retries; `error` for crashes.
- **Prevention:** Never import `$lib/server/logger` from a `.svelte` file or client-only module — it pulls in Node-only APIs. Use `$lib/logger` (browser) in Svelte components.

### Tauri svelte-ts scaffold defaults to adapter-static + SPA mode
- **Symptom:** Server routes (`+server.ts`) don't work; SSR is disabled
- **Root cause:** `pnpm create tauri-app` uses `adapter-static` with `ssr = false` in `+layout.ts` by default (Tauri docs recommend SPA mode for static builds)
- **Fix:** Replace `adapter-static` with `adapter-node` in `svelte.config.js`; remove `export const ssr = false` from `+layout.ts`; add `@types/node` and `"types": ["node"]` to `tsconfig.json`
- **Prevention:** Do this immediately after scaffolding, before writing any other code
