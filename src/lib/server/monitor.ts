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

import { cameraFetch, cameraFetchRaw, extractFrames } from './camera';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type MonitorStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface ShootingSettings {
  av:          string | null;  // aperture e.g. "f2.8"
  tv:          string | null;  // shutter speed e.g. "1/125"
  iso:         string | null;  // ISO e.g. "3200"
  mode:        string | null;  // shooting mode dial e.g. "av", "m"
  wb:          string | null;  // white balance e.g. "colortemp", "auto"
  colortemp:   number | null;  // colour temperature in K (when wb=colortemp)
  exposure:    string | null;  // exposure compensation e.g. "+0.0"
  metering:    string | null;  // metering mode e.g. "evaluative", "spot"
  drive:       string | null;  // drive mode e.g. "single", "highspeed"
  afoperation: string | null;  // AF operation e.g. "manual", "oneshot"
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
const _settingsG  = global<ShootingSettings>('__monitor_settings', () => ({ av: null, tv: null, iso: null, mode: null, wb: null, colortemp: null, exposure: null, metering: null, drive: null, afoperation: null }));
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
  // Send current status immediately
  sub({ type: 'status', data: { status: getStatus_(), error: getError_() } });
  // Send current settings once so the client has values without waiting for a dial change
  const s = getSettings_();
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
      // Use cameraFetchRaw — the monitoring stream must NOT go through the serial queue
      // as it is a persistent connection that would block all other camera requests
      const res = await cameraFetchRaw(MONITOR_PATH);

      if (signal.aborted) break;

      if (res.status === 503) {
        await stopExistingSession();
        continue;
      }

      if (!res.ok || !res.body) {
        throw new Error(`Camera responded with ${res.status}`);
      }

      // Fetch all initial shooting settings in one request — store but don't broadcast.
      // Clients get initial settings via GET /api/state on page load.
      // SSE 'settings' events are delta-only (real changes from stream frames).
      try {
        const settingsRes = await cameraFetch('/ccapi/ver100/shooting/settings', { signal: AbortSignal.timeout(5_000) });
        if (settingsRes.ok) {
          const all = await settingsRes.json() as Record<string, { value?: unknown }>;
          const val = (key: string): string | null => {
            const v = all[key]?.value;
            return (v !== null && v !== undefined && v !== '') ? String(v) : null;
          };
          const ctRaw = all['colortemperature']?.value;
          setSettings_({
            av:          val('av'),
            tv:          val('tv'),
            iso:         val('iso'),
            mode:        val('shootingmodedial'),
            wb:          val('wb'),
            colortemp:   (typeof ctRaw === 'number') ? ctRaw : null,
            exposure:    val('exposure'),
            metering:    val('metering'),
            drive:       val('drive'),
            afoperation: val('afoperation'),
          });
        }
      } catch { /* non-fatal — stream will fill in values as dials change */ }

      setStatus('live');
      // Broadcast settings immediately when live — guarantees client gets values
      // even on first boot before any dial change triggers a stream frame
      const liveSettings = getSettings_();
      if (liveSettings.av || liveSettings.tv || liveSettings.iso) {
        broadcast('settings', liveSettings);
      }
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
          const strVal = (f: unknown) => (f as { value: string } | null)?.value ?? null;
          const numVal = (f: unknown) => { const v = (f as { value: unknown } | null)?.value; return typeof v === 'number' ? v : null; };
          if (parsed.av)              { s = { ...s, av:          strVal(parsed.av)              }; settingsChanged = true; }
          if (parsed.tv)              { s = { ...s, tv:          strVal(parsed.tv)              }; settingsChanged = true; }
          if (parsed.iso)             { s = { ...s, iso:         strVal(parsed.iso)             }; settingsChanged = true; }
          if (parsed.shootingmodedial){ s = { ...s, mode:        strVal(parsed.shootingmodedial)}; settingsChanged = true; }
          if (parsed.wb)              { s = { ...s, wb:          strVal(parsed.wb)              }; settingsChanged = true; }
          if (parsed.colortemperature){ s = { ...s, colortemp:   numVal(parsed.colortemperature)}; settingsChanged = true; }
          if (parsed.exposure)        { s = { ...s, exposure:    strVal(parsed.exposure)        }; settingsChanged = true; }
          if (parsed.metering)        { s = { ...s, metering:    strVal(parsed.metering)        }; settingsChanged = true; }
          if (parsed.drive)           { s = { ...s, drive:       strVal(parsed.drive)           }; settingsChanged = true; }
          if (parsed.afoperation)     { s = { ...s, afoperation: strVal(parsed.afoperation)     }; settingsChanged = true; }
          if (settingsChanged) {
            const prev = getSettings_();
            // Only broadcast if any value actually changed
            const changed =
              s.av !== prev.av || s.tv !== prev.tv || s.iso !== prev.iso ||
              s.mode !== prev.mode || s.wb !== prev.wb || s.colortemp !== prev.colortemp ||
              s.exposure !== prev.exposure || s.metering !== prev.metering ||
              s.drive !== prev.drive || s.afoperation !== prev.afoperation;
            setSettings_(s);
            if (changed) broadcast('settings', s);
          }

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
