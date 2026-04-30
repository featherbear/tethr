import type { RequestHandler } from './$types';
import { cameraFetch } from '$lib/server/camera';

// Backoff settings
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const MONITOR_PATH = '/ccapi/ver100/event/monitoring';
const POLL_PATH    = '/ccapi/ver110/event/polling';

/**
 * The monitoring endpoint streams chunked binary-framed JSON.
 * Frame format: ff ffff 00 02 00 00 00 [4-byte BE length] [JSON bytes] ...
 * Separator between frames is the ff ffff prefix of the next frame.
 *
 * We parse by scanning the buffer for the magic byte sequence and extracting
 * JSON slices between consecutive frame headers.
 */
const FRAME_MAGIC = Buffer.from([0xff, 0xff, 0xff, 0x00, 0x02, 0x00, 0x00, 0x00]);

function extractJsonChunks(buf: Buffer): { chunks: string[]; remainder: Buffer } {
  const chunks: string[] = [];

  while (true) {
    // Find the start of a frame header
    const headerIdx = indexOfSequence(buf, FRAME_MAGIC);
    if (headerIdx === -1) break;

    // Header is 8 bytes (magic) + 4 bytes (BE length) = 12 bytes total
    const headerEnd = headerIdx + FRAME_MAGIC.length + 4;
    if (buf.length < headerEnd) break;

    const payloadLen = buf.readUInt32BE(headerIdx + FRAME_MAGIC.length);
    const payloadEnd = headerEnd + payloadLen;

    if (buf.length < payloadEnd) break;

    const json = buf.subarray(headerEnd, payloadEnd).toString('utf8');
    chunks.push(json);

    // Advance past this frame
    buf = buf.subarray(payloadEnd);
  }

  return { chunks, remainder: buf };
}

function indexOfSequence(buf: Buffer, seq: Buffer): number {
  outer: for (let i = 0; i <= buf.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Release any active monitoring or polling session. */
async function resetSession(): Promise<void> {
  await Promise.allSettled([
    cameraFetch(MONITOR_PATH, { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
    cameraFetch(POLL_PATH,    { method: 'DELETE', signal: AbortSignal.timeout(5_000) }),
  ]);
}

/** Called by the frontend on disconnect to immediately release the camera session. */
export const DELETE: RequestHandler = async () => {
  await resetSession().catch(() => {});
  return new Response(null, { status: 204 });
};

export const GET: RequestHandler = ({ request }) => {
  let closed = false;
  request.signal.addEventListener('abort', () => { closed = true; });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(event: string, data: unknown) {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream may be closed */ }
      }

      send('status', { status: 'connecting' });

      // Clear any stuck session before starting
      await resetSession();

      let backoff = MIN_BACKOFF_MS;
      let sentLive = false;

      while (!closed) {
        try {
          const res = await cameraFetch(MONITOR_PATH, {
            signal: AbortSignal.timeout(90_000),
          });

          if (!res.ok) {
            throw new Error(`Camera responded with ${res.status}`);
          }

          if (!res.body) {
            throw new Error('No response body from camera monitoring endpoint');
          }

          // Signal live on first successful connection
          if (!sentLive) {
            send('status', { status: 'live' });
            sentLive = true;
          }

          backoff = MIN_BACKOFF_MS;

          // Read the streaming chunked response
          let remainder = Buffer.alloc(0);
          const reader = res.body.getReader();

          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;

            // Accumulate incoming bytes
            remainder = Buffer.concat([remainder, Buffer.from(value)]);

            // Extract complete JSON frames
            const { chunks, remainder: newRemainder } = extractJsonChunks(remainder);
            remainder = newRemainder;

            for (const json of chunks) {
              if (closed) break;
              try {
                const data = JSON.parse(json);
                // Only care about new content notifications
                if (data.addedcontents && Array.isArray(data.addedcontents)) {
                  for (const path of data.addedcontents as string[]) {
                    const parts = path.split('/');
                    const filename = parts.pop()!;
                    const dirname = parts.join('/');
                    send('shot', { dirname, filename });
                  }
                }
              } catch {
                // Malformed JSON frame — skip
              }
            }
          }

          reader.releaseLock();

        } catch (e) {
          if (closed) break;
          sentLive = false;
          send('status', { status: 'reconnecting', error: String(e) });
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          if (!closed) await resetSession();
        }
      }

      // Release camera session on clean close
      await resetSession().catch(() => {});
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
