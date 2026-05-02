/**
 * /api/events — Server-Sent Events stream
 *
 * Clients subscribe here to receive camera events in real-time.
 * The camera monitor loop runs on the server independently of this endpoint.
 *
 * Events:
 *   status  { status: 'connecting'|'live'|'reconnecting'|'stopped', error? }
 *   shot    { path: string }
 *   info    { battery?, recordable? }
 */

import type { RequestHandler } from './$types';
import { subscribe, startMonitor, getStatus } from '$lib/server/monitor';

export const GET: RequestHandler = ({ request }) => {
  // Start the monitor lazily on first SSE connection — this ensures the
  // initial device-info / state requests from the frontend complete first,
  // avoiding queue contention that causes the camera to drop the stream.
  const { status } = getStatus();
  if (status === 'stopped') {
    startMonitor();
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const unsub = subscribe(({ type, data }) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch { /* stream closed */ }
      });

      request.signal.addEventListener('abort', () => {
        unsub();
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
