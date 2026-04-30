import type { RequestHandler } from './$types';
import { cameraFetch } from '$lib/server/camera';

// Backoff settings
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const POLL_PATH     = '/ccapi/ver110/event/polling';
const MONITOR_PATH  = '/ccapi/ver100/event/monitoring';

/** Reset any existing camera polling session before starting a new one. */
async function resetPollingSession(): Promise<void> {
  // The camera allows only one poller at a time; DELETE clears any stuck session.
  // Ignore errors — 503 "Not started" is expected if none is active.
  await Promise.allSettled([
    cameraFetch(POLL_PATH,    { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
    cameraFetch(MONITOR_PATH, { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
  ]);
}

export const GET: RequestHandler = ({ request }) => {
  let closed = false;
  request.signal.addEventListener('abort', () => { closed = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      send('status', { status: 'connecting' });

      // Clear any stuck session from a previous connection
      await resetPollingSession();

      let backoff = MIN_BACKOFF_MS;

      while (!closed) {
        try {
          const res = await cameraFetch(POLL_PATH, {
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            throw new Error(`Camera responded with ${res.status}`);
          }

          const data = await res.json();
          backoff = MIN_BACKOFF_MS; // reset on success

          if (closed) break;

          // Empty {} means "no event, poll again immediately"
          if (!data.kind) {
            send('status', { status: 'live' });
            continue;
          }

          if (data.kind === 'shotnotification') {
            const value = data.value;
            // ver110 returns { path: "/ccapi/ver120/contents/card1/.../file.CR3" }
            // Normalise to { dirname, filename } for the frontend
            if (value.path && !value.filename) {
              const parts = (value.path as string).split('/');
              const filename = parts.pop()!;
              const dirname = parts.join('/');
              send('shot', { dirname, filename });
            } else {
              send('shot', value);
            }
          }

          send('status', { status: 'live' });

        } catch (e) {
          if (closed) break;
          send('status', { status: 'reconnecting', error: String(e) });
          // Exponential backoff before retrying
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          // Reset session on reconnect — camera may have a stuck session
          if (!closed) await resetPollingSession();
        }
      }

      // Clean up: release the camera's polling slot on disconnect
      await resetPollingSession().catch(() => {});

      try { controller.close(); } catch { /* already closed */ }
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
