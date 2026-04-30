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

let _status: MonitorStatus = 'stopped';
let _error: string | null = null;
let _abortController: AbortController | null = null;

// ---------------------------------------------------------------------------
// Subscriber fan-out
// ---------------------------------------------------------------------------

export type Event = { type: string; data: unknown };
export type Subscriber = (event: Event) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(sub: Subscriber): () => void {
  subscribers.add(sub);
  // Immediately send current status to new subscriber
  sub({ type: 'status', data: { status: _status, error: _error } });
  return () => subscribers.delete(sub);
}

function broadcast(type: string, data: unknown) {
  const event: Event = { type, data };
  for (const sub of subscribers) {
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
  _status = status;
  _error = error ?? null;
  broadcast('status', { status, error: _error });
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
          if (Array.isArray(parsed.addedcontents)) {
            for (const path of parsed.addedcontents as string[]) {
              broadcast('shot', { path });
            }
          }
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
  _abortController?.abort();
  _abortController = new AbortController();
  runLoop(_abortController.signal).catch(console.error);
}

/** Stop the monitor loop (e.g. on server shutdown). */
export function stopMonitor() {
  _abortController?.abort();
  _abortController = null;
}

/** Current connection status */
export function getStatus(): { status: MonitorStatus; error: string | null } {
  return { status: _status, error: _error };
}
