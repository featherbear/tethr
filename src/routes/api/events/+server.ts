/**
 * /api/events — Server-Sent Events stream
 *
 * Single camera monitoring loop shared across all browser clients.
 * The camera's /ccapi/ver100/event/monitoring endpoint streams binary-framed
 * JSON events. We parse these and fan-out to all SSE subscribers.
 *
 * Event types emitted to clients:
 *   status  { status: 'connecting'|'live'|'reconnecting', error?: string }
 *   shot    { path: string }          — new photo path on camera card
 *   info    { battery?, recordable? } — camera state updates
 */

import type { RequestHandler } from './$types';
import { cameraFetch, extractFrames } from '$lib/server/camera';

const MONITOR_PATH = '/ccapi/ver100/event/monitoring';

// ---------------------------------------------------------------------------
// Subscriber registry
// ---------------------------------------------------------------------------

type Subscriber = (event: string, data: unknown) => void;
const subscribers = new Set<Subscriber>();

function broadcast(event: string, data: unknown) {
  for (const sub of subscribers) {
    try { sub(event, data); } catch { /* subscriber disconnected */ }
  }
}

// ---------------------------------------------------------------------------
// Camera monitoring loop — singleton
// ---------------------------------------------------------------------------

let loopRunning = false;

async function stopMonitoring() {
  await cameraFetch(MONITOR_PATH, {
    method: 'DELETE',
    signal: AbortSignal.timeout(5_000),
  }).catch(() => {});
}

async function runMonitorLoop() {
  if (loopRunning) return;
  loopRunning = true;

  const MIN_BACKOFF = 1_000;
  const MAX_BACKOFF = 30_000;
  let backoff = MIN_BACKOFF;

  while (subscribers.size > 0) {
    broadcast('status', { status: 'connecting' });

    try {
      // No timeout — this is a persistent streaming connection.
      // The camera pushes frames continuously; we read until done or error.
      const res = await cameraFetch(MONITOR_PATH);

      if (res.status === 503) {
        // Another session is active — stop it and retry
        await stopMonitoring();
        continue;
      }

      if (!res.ok || !res.body) {
        throw new Error(`Camera responded with ${res.status}`);
      }

      broadcast('status', { status: 'live' });
      backoff = MIN_BACKOFF;

      // Stream body — no timeout on reading (camera pushes frames continuously)
      const reader = res.body.getReader();
      let remainder = Buffer.alloc(0);

      while (subscribers.size > 0) {
        const { done, value } = await reader.read();
        if (done) break;

        remainder = Buffer.concat([remainder, Buffer.from(value)]);
        const { frames, remainder: newRemainder } = extractFrames(remainder);
        remainder = newRemainder;

        for (const { parsed } of frames) {
          // New photos added to card
          if (Array.isArray(parsed.addedcontents)) {
            for (const path of parsed.addedcontents as string[]) {
              broadcast('shot', { path });
            }
          }

          // Camera state updates (battery, recordable shots remaining)
          const info: Record<string, unknown> = {};
          if (parsed.battery)    info.battery    = parsed.battery;
          if (parsed.recordable) info.recordable = parsed.recordable;
          if (Object.keys(info).length) broadcast('info', info);
        }
      }

      reader.releaseLock();

    } catch (e) {
      if (subscribers.size === 0) break;
      broadcast('status', { status: 'reconnecting', error: String(e) });
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF);
    }
  }

  await stopMonitoring();
  loopRunning = false;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/** Frontend calls DELETE to cleanly stop monitoring (e.g. on disconnect). */
export const DELETE: RequestHandler = async () => {
  await stopMonitoring();
  return new Response(null, { status: 204 });
};

/** SSE stream — one connection per browser tab, all share the same loop. */
export const GET: RequestHandler = ({ request }) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sub: Subscriber = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      subscribers.add(sub);
      runMonitorLoop().catch(console.error);

      request.signal.addEventListener('abort', () => {
        subscribers.delete(sub);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
