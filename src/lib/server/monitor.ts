/**
 * monitor.ts — camera connection manager
 *
 * Explicit 3-phase state machine:
 *
 *   STOPPED
 *     └─ startMonitor() ──► VERIFY
 *                               │  GET /ccapi/ver100/deviceinformation (direct, 8s timeout)
 *                               ├─ fail ──► wait backoff ──► VERIFY
 *                               └─ ok  ──► CONNECT
 *                                           │  GET /ccapi/ver100/event/monitoring (direct)
 *                                           ├─ 503 ──► DELETE (queued) ──► wait 2s ──► CONNECT
 *                                           ├─ fail ──► wait backoff ──► VERIFY
 *                                           └─ ok  ──► LIVE
 *                                                         │  reader.read() — blocks until frame or close
 *                                                         ├─ done:true ──► wait 1.5s ──► CONNECT
 *                                                         └─ error     ──► wait backoff ──► VERIFY
 *
 * Key invariants:
 *   - cameraFetchDirect()  for monitoring stream and probes (never blocks queue)
 *   - cameraFetch()        for everything else (settings, DELETE, thumbnails)
 *   - setStatus('connecting') fires once on CONNECT entry, not at top of loop
 *   - Clean close → CONNECT (camera known reachable, skip probe)
 *   - Error       → VERIFY  (reachability unknown)
 */

import { cameraFetch, cameraFetchDirect, extractFrames, getCameraBaseUrl } from './camera';
import { childLogger } from './logger';

const log = childLogger('monitor');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MonitorStatus = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface ShootingSettings {
  av:          string | null;
  tv:          string | null;
  iso:         string | null;
  mode:        string | null;
  wb:          string | null;
  colortemp:   number | null;
  exposure:    string | null;
  metering:    string | null;
  drive:       string | null;
  afoperation: string | null;
}

export type Event = { type: string; data: unknown };
export type Subscriber = (event: Event) => void;

// ---------------------------------------------------------------------------
// HMR-safe globals — survive Vite module reload in dev
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

function global<T>(key: string, init: () => T): { get: () => T; set: (v: T) => void } {
  if (!(key in g)) g[key] = init();
  return { get: () => g[key] as T, set: (v: T) => { g[key] = v; } };
}

const _statusG  = global<MonitorStatus>('__monitor_status', () => 'stopped');
const _errorG   = global<string | null>('__monitor_error',  () => null);
const _ctrlG    = global<AbortController | null>('__monitor_ctrl', () => null);
const _settingsG = global<ShootingSettings>('__monitor_settings', () => ({
  av: null, tv: null, iso: null, mode: null, wb: null,
  colortemp: null, exposure: null, metering: null, drive: null, afoperation: null,
}));
const _subsG = global<Set<Subscriber>>('__monitor_subs', () => new Set());

const getStatus_    = () => _statusG.get();
const setStatus_    = (v: MonitorStatus) => _statusG.set(v);
const getError_     = () => _errorG.get();
const setError_     = (v: string | null) => _errorG.set(v);
const getCtrl       = () => _ctrlG.get();
const setCtrl       = (v: AbortController | null) => _ctrlG.set(v);
const getSettings_  = () => _settingsG.get();
const setSettings_  = (v: ShootingSettings) => _settingsG.set(v);
const getSubs       = () => _subsG.get();

export function getSettings(): Readonly<ShootingSettings> { return getSettings_(); }

// ---------------------------------------------------------------------------
// Subscriber fan-out
// ---------------------------------------------------------------------------

export function subscribe(sub: Subscriber): () => void {
  getSubs().add(sub);
  sub({ type: 'status', data: { status: getStatus_(), error: getError_() } });
  const s = getSettings_();
  if (s.av || s.tv || s.iso) sub({ type: 'settings', data: s });
  return () => getSubs().delete(sub);
}

function broadcast(type: string, data: unknown) {
  for (const sub of getSubs()) {
    try { sub({ type, data }); } catch { /* subscriber gone */ }
  }
}

// ---------------------------------------------------------------------------
// Status helper
// ---------------------------------------------------------------------------

function setStatus(status: MonitorStatus, error?: string) {
  setStatus_(status);
  setError_(error ?? null);
  broadcast('status', { status, error: error ?? null });
  if (error) {
    log.warn({ status, error }, 'Status →');
  } else {
    log.info({ status }, 'Status →');
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONITOR_PATH  = '/ccapi/ver100/event/monitoring';
const PROBE_PATH    = '/ccapi/ver100/deviceinformation';
const SETTINGS_PATH = '/ccapi/ver100/shooting/settings';

const PROBE_TIMEOUT_MS       = 8_000;
const CLEAN_CLOSE_DELAY_MS   = 1_500;
const SESSION_CLEAR_DELAY_MS = 2_000;
const MIN_BACKOFF_MS         = 1_000;
const MAX_BACKOFF_MS         = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves after `ms` ms, or immediately if `signal` fires. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Summarise an error into a loggable object with type + message. */
function describeError(e: unknown): { errType: string; err: string } {
  if (e instanceof Error) {
    const name = e.name; // 'AbortError', 'TimeoutError', 'TypeError', etc.
    const isAbort   = name === 'AbortError';
    const isTimeout = name === 'TimeoutError';
    return {
      errType: isAbort ? 'abort' : isTimeout ? 'timeout' : name,
      err: e.message,
    };
  }
  return { errType: 'unknown', err: String(e) };
}

/**
 * Verify the camera is reachable by fetching a lightweight endpoint.
 * Uses cameraFetchDirect so it never blocks or is blocked by the serial queue.
 * Returns true if the camera responded with 2xx.
 */
async function verifyCameraReachable(signal: AbortSignal): Promise<boolean> {
  try {
    const res = await cameraFetchDirect(PROBE_PATH, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
    });
    res.body?.cancel().catch(() => {});
    if (!res.ok) log.debug({ status: res.status }, 'Probe response non-OK');
    return res.ok;
  } catch (e) {
    log.debug({ ...describeError(e) }, 'Probe threw');
    return false;
  }
}

/**
 * Clear any stuck event session on the camera.
 * Sends DELETE for the active event path through the serial queue,
 * then waits a fixed delay for the camera firmware to release the slot.
 */
async function clearEventSession(): Promise<void> {
  log.debug({ path: MONITOR_PATH }, 'Clearing stuck monitoring session (DELETE)');
  await cameraFetch(MONITOR_PATH, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
  await new Promise(r => setTimeout(r, SESSION_CLEAR_DELAY_MS));
  log.debug('Event session cleared');
}

/**
 * Fetch and broadcast initial shooting settings after going live.
 * Fire-and-forget — goes through the serial queue at normal priority.
 * Non-fatal: stream frames will fill in values on dial changes anyway.
 */
function fetchInitialSettings(): void {
  cameraFetch(SETTINGS_PATH, { signal: AbortSignal.timeout(8_000) })
    .then(async (res) => {
      if (!res.ok) return;
      const all = await res.json() as Record<string, { value?: unknown }>;
      const strVal = (key: string): string | null => {
        const v = all[key]?.value;
        return (v !== null && v !== undefined && v !== '') ? String(v) : null;
      };
      const ctRaw = all['colortemperature']?.value;
      const s: ShootingSettings = {
        av:          strVal('av'),
        tv:          strVal('tv'),
        iso:         strVal('iso'),
        mode:        strVal('shootingmodedial'),
        wb:          strVal('wb'),
        colortemp:   typeof ctRaw === 'number' ? ctRaw : null,
        exposure:    strVal('exposure'),
        metering:    strVal('metering'),
        drive:       strVal('drive'),
        afoperation: strVal('afoperation'),
      };
      setSettings_(s);
      if (s.av || s.tv || s.iso) broadcast('settings', s);
      log.info({ av: s.av, tv: s.tv, iso: s.iso, mode: s.mode }, 'Initial settings loaded');
    })
    .catch((e) => log.warn({ ...describeError(e) }, 'Initial settings fetch failed (non-fatal)'));
}

/**
 * Merge a monitoring frame's partial settings into current state.
 * Broadcasts only when a value actually changed.
 */
function applySettingsFrame(parsed: Record<string, unknown>): void {
  const strVal = (f: unknown) => (f as { value: string } | null)?.value ?? null;
  const numVal = (f: unknown) => {
    const v = (f as { value: unknown } | null)?.value;
    return typeof v === 'number' ? v : null;
  };

  let s = getSettings_();
  let changed = false;

  const update = <K extends keyof ShootingSettings>(key: K, val: ShootingSettings[K]) => {
    if (val !== null && s[key] !== val) { s = { ...s, [key]: val }; changed = true; }
  };

  if (parsed.av)               update('av',          strVal(parsed.av));
  if (parsed.tv)               update('tv',          strVal(parsed.tv));
  if (parsed.iso)              update('iso',         strVal(parsed.iso));
  if (parsed.shootingmodedial) update('mode',        strVal(parsed.shootingmodedial));
  if (parsed.wb)               update('wb',          strVal(parsed.wb));
  if (parsed.colortemperature) update('colortemp',   numVal(parsed.colortemperature));
  if (parsed.exposure)         update('exposure',    strVal(parsed.exposure));
  if (parsed.metering)         update('metering',    strVal(parsed.metering));
  if (parsed.drive)            update('drive',       strVal(parsed.drive));
  if (parsed.afoperation)      update('afoperation', strVal(parsed.afoperation));

  if (changed) {
    setSettings_(s);
    log.debug({ av: s.av, tv: s.tv, iso: s.iso }, 'Settings updated from frame');
    broadcast('settings', s);
  }
}

// ---------------------------------------------------------------------------
// Main loop — state machine
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LIVE phase — monitoring mode
// Reads binary-framed chunks from the persistent stream until done or error.
// Returns: 'clean' if done:true, 'error' + the thrown value otherwise.
// ---------------------------------------------------------------------------

async function runMonitoringLive(
  res: Response,
  signal: AbortSignal
): Promise<{ result: 'clean' } | { result: 'error'; err: unknown }> {
  const reader = res.body!.getReader();
  let remainder = Buffer.alloc(0);

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        log.info('Monitoring stream ended (done:true) — camera closed cleanly');
        return { result: 'clean' };
      }

      remainder = Buffer.concat([remainder, Buffer.from(value)]);
      const { frames, remainder: newRemainder } = extractFrames(remainder);
      remainder = newRemainder;

      for (const { parsed } of frames) {
        applySettingsFrame(parsed);

        if (Array.isArray(parsed.addedcontents)) {
          for (const path of parsed.addedcontents as string[]) {
            log.info({ path }, 'Shot received');
            broadcast('shot', { path, settings: { ...getSettings_() } });
          }
        }

        const info: Record<string, unknown> = {};
        if (parsed.battery)    info.battery    = parsed.battery;
        if (parsed.recordable) info.recordable = parsed.recordable;
        if (Object.keys(info).length) broadcast('info', info);
      }
    }
    return { result: 'clean' }; // signal aborted
  } catch (e) {
    // If the outer signal fired, the stream termination is intentional — treat as clean abort
    if (signal.aborted) {
      log.debug('Monitoring stream aborted by signal (intentional)');
      return { result: 'clean' };
    }
    return { result: 'error', err: e };
  } finally {
    reader.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Main loop — state machine
// ---------------------------------------------------------------------------

async function runLoop(signal: AbortSignal): Promise<void> {
  let backoff = MIN_BACKOFF_MS;

  type Phase = 'verify' | 'connect' | 'live';
  let phase: Phase = 'verify';

  log.info({ path: MONITOR_PATH }, 'Monitor loop starting');

  while (!signal.aborted) {

    // ── VERIFY ──────────────────────────────────────────────────────────────
    if (phase === 'verify') {
      setStatus('connecting');
      log.info({ baseUrl: getCameraBaseUrl() }, 'Verifying camera reachable');

      const reachable = await verifyCameraReachable(signal);
      if (signal.aborted) break;

      if (!reachable) {
        log.warn({ backoffMs: backoff, baseUrl: getCameraBaseUrl() }, 'Camera unreachable — backing off');
        setStatus('reconnecting');
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        continue;
      }

      log.info('Camera reachable');
      backoff = MIN_BACKOFF_MS;
      phase = 'connect';
      continue;
    }

    // ── CONNECT ─────────────────────────────────────────────────────────────
    if (phase === 'connect') {
      setStatus('connecting');
      log.info({ path: MONITOR_PATH }, 'Connecting to monitoring stream');

      let res: Response;
      try {
        res = await cameraFetchDirect(MONITOR_PATH, {
          headers: { 'Connection': 'close' },
          signal,
        });
      } catch (e) {
        if (signal.aborted) break;
        log.warn({ ...describeError(e) }, 'Monitoring connect threw — back to verify');
        setStatus('reconnecting');
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        phase = 'verify';
        continue;
      }

      if (signal.aborted) break;
      log.info({ status: res.status }, 'Monitoring connect response');

      if (res.status === 503) {
        res.body?.cancel().catch(() => {});
        log.warn('503 on monitoring connect — clearing stuck session');
        await clearEventSession();
        continue; // retry connect
      }

      if (!res.ok || !res.body) {
        log.warn({ status: res.status }, 'Unexpected monitoring response — back to verify');
        res.body?.cancel().catch(() => {});
        setStatus('reconnecting');
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        phase = 'verify';
        continue;
      }

      setStatus('live');
      backoff = MIN_BACKOFF_MS;
      fetchInitialSettings();
      phase = 'live';

      // ── LIVE (monitoring) ────────────────────────────────────────────────
      const liveResult = await runMonitoringLive(res, signal);
      if (signal.aborted) break;

      if (liveResult.result === 'error') {
        log.warn({ ...describeError(liveResult.err), backoffMs: backoff }, 'Monitoring read error — back to verify');
        setStatus('reconnecting');
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        phase = 'verify';
      } else {
        log.info({ delayMs: CLEAN_CLOSE_DELAY_MS }, 'Monitoring clean close — reconnecting');
        setStatus('reconnecting');
        await sleep(CLEAN_CLOSE_DELAY_MS, signal);
        phase = 'connect';
      }
    }

  }

  setStatus('stopped');
  log.info('Monitor loop stopped');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Start (or restart) the monitor loop. Safe to call multiple times. */
export function startMonitor(): void {
  const had = getCtrl() !== null;
  getCtrl()?.abort();
  const ctrl = new AbortController();
  setCtrl(ctrl);
  log.info(had ? 'Restarting monitor' : 'Starting monitor');
  runLoop(ctrl.signal).catch((e) => log.error({ ...describeError(e) }, 'Monitor loop crashed'));
}

/** Stop the monitor loop and set status to stopped. */
export function stopMonitor(): void {
  log.info('Stopping monitor');
  getCtrl()?.abort();
  setCtrl(null);
}

/** Current connection status + error. */
export function getStatus(): { status: MonitorStatus; error: string | null } {
  return { status: getStatus_(), error: getError_() };
}
