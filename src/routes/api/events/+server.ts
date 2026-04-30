import type { RequestHandler } from './$types';
import { getCameraBaseUrl } from '$lib/server/camera';

// Backoff settings
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export const GET: RequestHandler = ({ request }) => {
  let closed = false;
  request.signal.addEventListener('abort', () => { closed = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      // Notify client we're connected
      send('status', { status: 'connecting' });

      let backoff = MIN_BACKOFF_MS;

      while (!closed) {
        try {
          const base = getCameraBaseUrl();
          const res = await fetch(`${base}/ccapi/ver100/event/polling`, {
            signal: AbortSignal.timeout(60_000),
          });

          if (!res.ok) {
            throw new Error(`Camera responded with ${res.status}`);
          }

          const data = await res.json();
          backoff = MIN_BACKOFF_MS; // reset on success

          if (closed) break;

          if (data.kind === 'shotnotification') {
            send('shot', data.value);
          }
          // Ignore other event kinds for now

          send('status', { status: 'live' });

        } catch (e) {
          if (closed) break;
          send('status', { status: 'reconnecting', error: String(e) });
          // Exponential backoff
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        }
      }

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
