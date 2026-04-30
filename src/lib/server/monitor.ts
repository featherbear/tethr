/**
 * monitor.ts — singleton camera monitor
 *
 * Runs independently of browser clients. Maintains a persistent connection
 * to the camera and broadcasts events to all SSE subscribers.
 *
 * Lifecycle:
 *   - startMonitor() — called once at server startup (via hooks.server.ts)
 *   - reconnect()    — called when settings change; restarts the loop
 *   - subscribe()    — SSE clients register to receive events
 */

import { cameraFetch, extractFrames } from './camera';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type MonitorStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface ShootingSettings {
  av:   string | null;  // aperture, e.g. "f2.8"
  tv:   string | null;  // shutter speed, e.g. "1/125"
  iso:  string | null;  // ISO, e.g. "3200"
  mode: string | null;  // shooting mode dial, e.g. "av", "m", "tv"
  wb:   string | null;  // white balance, e.g. "auto", "colortemp"
}

// ---------------------------------------------------------------------------
// HMR-safe globals — survive Vite module reload in dev
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

function global<T>(key: string, init: () => T): { get: () => T; set: (v: T) => void } {
  if (!(key in g)) g[key] = init();
  return {
    get: () => g[key] as T,
    set: (v: T) => { g[key] = v; },
  };
}

const _statusG    = global<MonitorStatus>('__monitor_status',    () => 'stopped');
const _errorG     = global<string | null>('__monitor_error',     () => null);
const _controllerG= global<AbortController | null>('__monitor_ctrl', () => null);
const _settingsG  = global<ShootingSettings>('__monitor_settings', () => ({ av: null, tv: null, iso: null, mode: null, wb: null }));
const _subscribersG = global<Set<Subscriber>>('__monitor_subs',  () => new Set());

// Convenience getters/setters
function getStatus_()    { return _statusG.get(); }
function setStatus_(v: MonitorStatus) { _statusG.set(v); }
function getError_()     { return _errorG.get(); }
function setError_(v: string | null) { _errorG.set(v); }
function getController_() { return _controllerG.get(); }
function setController_(v: AbortController | null) { _controllerG.set(v); }
function getSettings_()  { return _settingsG.get(); }
function setSettings_(v: ShootingSettings) { _settingsG.set(v); }
function getSubs()       { return _subscribersG.get(); }

export function getSettings(): Readonly<ShootingSettings> { return getSettings_(); }

// ---------------------------------------------------------------------------
// Subscriber fan-out
// ---------------------------------------------------------------------------

export type Event = { type: string; data: unknown };
export type Subscriber = (event: Event) => void;

export function subscribe(sub: Subscriber): () => void {
  getSubs().add(sub);
  // Immediately send current status and settings to new subscriber
  const s = getSettings_();
  sub({ type: 'status', data: { status: getStatus_(), error: getError_() } });
  if (s.av || s.tv || s.iso) sub({ type: 'settings', data: s });
  return () => getSubs().delete(sub);
}

function broadcast(type: string, data: unknown) {
  const event: Event = { type, data };
  for (const sub of getSubs()) {
    try { sub(event); } catch { /* subscriber gone */ }
  }
}

// ---------------------------------------------------------------------------
// Monitor loop
// ---------------------------------------------------------------------------

const MONITOR_PATH = '/ccapi/ver100/event/monitoring';
const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 30_000;

function setStatus(status: MonitorStatus, error?: string) {
  setStatus_(status);
  setError_(error ?? null);
  broadcast('status', { status, error: error ?? null });
}

async function stopExistingSession() {
  await cameraFetch(MONITOR_PATH, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

async function runLoop(signal: AbortSignal) {
  let backoff = MIN_BACKOFF;

  while (!signal.aborted) {
    setStatus('connecting');

    try {
      const res = await cameraFetch(MONITOR_PATH);

      if (signal.aborted) break;

      if (res.status === 503) {
        await stopExistingSession();
        continue;
      }

      if (!res.ok || !res.body) {
        throw new Error(`Camera responded with ${res.status}`);
      }

      // Fetch initial shooting settings in parallel before entering stream
      try {
        const [avRes, tvRes, isoRes, modeRes, wbRes] = await Promise.all([
          cameraFetch('/ccapi/ver100/shooting/settings/av',               { signal: AbortSignal.timeout(3_000) }),
          cameraFetch('/ccapi/ver100/shooting/settings/tv',               { signal: AbortSignal.timeout(3_000) }),
          cameraFetch('/ccapi/ver100/shooting/settings/iso',              { signal: AbortSignal.timeout(3_000) }),
          cameraFetch('/ccapi/ver100/shooting/settings/shootingmodedial', { signal: AbortSignal.timeout(3_000) }),
          cameraFetch('/ccapi/ver100/shooting/settings/wb',               { signal: AbortSignal.timeout(3_000) }),
        ]);
        const initial: ShootingSettings = {
          av:   avRes.ok   ? ((await avRes.json()  ).value ?? null) : null,
          tv:   tvRes.ok   ? ((await tvRes.json()  ).value ?? null) : null,
          iso:  isoRes.ok  ? ((await isoRes.json() ).value ?? null) : null,
          mode: modeRes.ok ? ((await modeRes.json()).value ?? null) : null,
          wb:   wbRes.ok   ? ((await wbRes.json()  ).value ?? null) : null,
        };
        setSettings_(initial);
        broadcast('settings', initial);
      } catch { /* non-fatal — stream will fill in values as dials change */ }

      setStatus('live');
      backoff = MIN_BACKOFF;

      const reader = res.body.getReader();
      let remainder = Buffer.alloc(0);

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        remainder = Buffer.concat([remainder, Buffer.from(value)]);
        const { frames, remainder: newRemainder } = extractFrames(remainder);
        remainder = newRemainder;

        for (const { parsed } of frames) {
          // Update settings from this frame (partial updates are common)
          let settingsChanged = false;
          let s = getSettings_();
          if (parsed.av)               { s = { ...s, av:   (parsed.av   as { value: string }).value }; settingsChanged = true; }
          if (parsed.tv)               { s = { ...s, tv:   (parsed.tv   as { value: string }).value }; settingsChanged = true; }
          if (parsed.iso)              { s = { ...s, iso:  (parsed.iso  as { value: string }).value }; settingsChanged = true; }
          if (parsed.shootingmodedial) { s = { ...s, mode: (parsed.shootingmodedial as { value: string }).value }; settingsChanged = true; }
          if (parsed.wb)               { s = { ...s, wb:   (parsed.wb   as { value: string }).value }; settingsChanged = true; }
          if (settingsChanged) setSettings_(s);

          if (settingsChanged) broadcast('settings', getSettings_());

          // New photos — attach current settings snapshot to shot event
          if (Array.isArray(parsed.addedcontents)) {
            for (const path of parsed.addedcontents as string[]) {
              broadcast('shot', { path, settings: { ...getSettings_() } });
            }
          }

          // Battery / recordable info updates
          const info: Record<string, unknown> = {};
          if (parsed.battery)    info.battery    = parsed.battery;
          if (parsed.recordable) info.recordable = parsed.recordable;
          if (Object.keys(info).length) broadcast('info', info);
        }
      }

      reader.releaseLock();

    } catch (e) {
      if (signal.aborted) break;
      const msg = String(e);
      setStatus('reconnecting', msg);
      await new Promise<void>(r => {
        const t = setTimeout(r, backoff);
        signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true });
      });
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }

  await stopExistingSession();
  setStatus('stopped');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start (or restart) the monitor loop. Safe to call multiple times. */
export function startMonitor() {
  // Abort any existing loop
  getController_()?.abort();
  const ctrl = new AbortController();
  setController_(ctrl);
  runLoop(ctrl.signal).catch(console.error);
}

/** Stop the monitor loop (e.g. on server shutdown). */
export function stopMonitor() {
  getController_()?.abort();
  setController_(null);
}

/** Current connection status */
export function getStatus(): { status: MonitorStatus; error: string | null } {
  return { status: getStatus_(), error: getError_() };
}
