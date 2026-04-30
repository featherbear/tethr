import type { RequestHandler } from './$types';
import { cameraFetch } from '$lib/server/camera';

// ---------------------------------------------------------------------------
// Singleton camera monitor — one connection shared across all SSE clients
// ---------------------------------------------------------------------------

const MONITOR_PATH = '/ccapi/ver100/event/monitoring';
const POLL_PATH    = '/ccapi/ver110/event/polling';
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

type SseEvent = { event: string; data: unknown };
type Subscriber = (e: SseEvent) => void;

const subscribers = new Set<Subscriber>();
let monitorRunning = false;

/**
 * Binary frame format from ver100/event/monitoring:
 * [ff ffff 00 02 00 00 00] [4-byte BE length] [JSON bytes]
 */
const FRAME_MAGIC = Buffer.from([0xff, 0xff, 0xff, 0x00, 0x02, 0x00, 0x00, 0x00]);

function indexOfSequence(buf: Buffer, seq: Buffer): number {
  outer: for (let i = 0; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function extractJsonChunks(buf: Buffer): { chunks: string[]; remainder: Buffer } {
  const chunks: string[] = [];
  while (true) {
    const headerIdx = indexOfSequence(buf, FRAME_MAGIC);
    if (headerIdx === -1) break;
    const headerEnd = headerIdx + FRAME_MAGIC.length + 4;
    if (buf.length < headerEnd) break;
    const payloadLen = buf.readUInt32BE(headerIdx + FRAME_MAGIC.length);
    const payloadEnd = headerEnd + payloadLen;
    if (buf.length < payloadEnd) break;
    chunks.push(buf.subarray(headerEnd, payloadEnd).toString('utf8'));
    buf = buf.subarray(payloadEnd);
  }
  return { chunks, remainder: buf };
}

function broadcast(event: string, data: unknown) {
  const e: SseEvent = { event, data };
  for (const sub of subscribers) sub(e);
}

async function resetSession(): Promise<void> {
  await Promise.allSettled([
    cameraFetch(MONITOR_PATH, { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
    cameraFetch(POLL_PATH,    { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
  ]);
}

/** Start the singleton monitor loop. No-op if already running. */
async function ensureMonitorRunning() {
  if (monitorRunning) return;
  monitorRunning = true;

  // Reset once on startup to clear any leftover session
  await resetSession();

  let backoff = MIN_BACKOFF_MS;
  let sentLive = false;

  while (subscribers.size > 0) {
    try {
      const res = await cameraFetch(MONITOR_PATH, {
        signal: AbortSignal.timeout(90_000),
      });

      // 503 means a session is already active — reset and retry
      if (res.status === 503) {
        await resetSession();
        continue;
      }

      if (!res.ok) throw new Error(`Camera responded with ${res.status}`);
      if (!res.body) throw new Error('No response body');

      if (!sentLive) {
        broadcast('status', { status: 'live' });
        sentLive = true;
      }

      backoff = MIN_BACKOFF_MS;

      let remainder = Buffer.alloc(0);
      const reader = res.body.getReader();

      while (subscribers.size > 0) {
        const { done, value } = await reader.read();
        if (done) break;

        remainder = Buffer.concat([remainder, Buffer.from(value)]);
        const { chunks, remainder: newRemainder } = extractJsonChunks(remainder);
        remainder = newRemainder;

        for (const json of chunks) {
          try {
            const data = JSON.parse(json);

            // New photo(s) added to card
            if (data.addedcontents && Array.isArray(data.addedcontents)) {
              for (const path of data.addedcontents as string[]) {
                const parts = path.split('/');
                const filename = parts.pop()!;
                const dirname = parts.join('/');
                broadcast('shot', { dirname, filename });
              }
            }

            // Camera info fields — push relevant updates to clients
            const infoUpdate: Record<string, unknown> = {};
            if (data.battery)    infoUpdate.battery  = data.battery;
            if (data.recordable) infoUpdate.recordable = data.recordable;
            if (Object.keys(infoUpdate).length > 0) {
              broadcast('info-update', infoUpdate);
            }

          } catch { /* malformed frame — skip */ }
        }
      }

      reader.releaseLock();

    } catch (e) {
      sentLive = false;
      broadcast('status', { status: 'reconnecting', error: String(e) });
      await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      // Don't reset here — 503 handling inside the loop covers stuck sessions
    }
  }

  // All subscribers gone — clean up
  await resetSession().catch(() => {});
  monitorRunning = false;
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

/** Frontend calls this on disconnect to immediately release the camera session. */
export const DELETE: RequestHandler = async () => {
  await resetSession().catch(() => {});
  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = ({ request }) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sub: Subscriber = ({ event, data }) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      };

      subscribers.add(sub);

      // Send immediate connecting status
      sub({ event: 'status', data: { status: 'connecting' } });

      // If monitor already live, tell this client immediately
      if (monitorRunning) {
        sub({ event: 'status', data: { status: 'live' } });
      }

      // Start monitor loop if not already running
      ensureMonitorRunning().catch(console.error);

      // Clean up when client disconnects
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
