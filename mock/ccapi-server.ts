#!/usr/bin/env bun
/**
 * Mock Canon CCAPI server for development.
 * Simulates all endpoints used by Tethr.
 * Run with: bun run mock/ccapi-server.ts
 */

const PORT = 8080;
const SHOT_INTERVAL_MS = 5000; // auto-fire a shot event every 5s

// Track polling clients via a simple queue
let pendingPollers: Array<{ resolve: (v: Response) => void }> = [];
let shotCounter = 0;

// Auto-fire shots so dev works without pressing anything
setInterval(() => {
  fireShot();
}, SHOT_INTERVAL_MS);

function fireShot() {
  shotCounter++;
  const filename = `IMG_${String(shotCounter).padStart(4, '0')}.JPG`;
  // ver110 polling returns { path } for shot notifications
  const event = {
    kind: 'shotnotification',
    value: {
      path: `/ccapi/ver120/contents/card1/100MOCK/${filename}`,
    },
  };
  console.log(`[mock] Shot fired: ${filename} (${pendingPollers.length} pollers waiting)`);
  const pollers = pendingPollers.splice(0);
  for (const p of pollers) {
    p.resolve(new Response(JSON.stringify(event), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }
}

// Sample thumbnail — tiny 1x1 red JPEG (base64)
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB' +
  '/8QAIRAAAgIBBAMBAAAAAAAAAAAAAQIDBAUREiExQVH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA' +
  '/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amu69bYpRjGKlJJerFbSWy' +
  'AAAAASUVORK5CYII=';
const thumbnailBuffer = Buffer.from(TINY_JPEG_B64, 'base64');

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    console.log(`[mock] ${req.method} ${path}${url.search}`);

    // CCAPI capabilities
    if (path === '/ccapi') {
      return Response.json({ ver100: [], ver110: [], ver120: [] });
    }

    // List storage root
    if (path === '/ccapi/ver120/contents' || path === '/ccapi/ver120/contents/card1') {
      return Response.json({
        path: ['/ccapi/ver120/contents/card1/100MOCK'],
      });
    }

    // List folder
    if (path === '/ccapi/ver120/contents/card1/100MOCK') {
      const files = Array.from({ length: shotCounter }, (_, i) => {
        const n = String(i + 1).padStart(4, '0');
        return `/ccapi/ver120/contents/card1/100MOCK/IMG_${n}.JPG`;
      });
      return Response.json({ path: files });
    }

    // Thumbnail or original (ver120 file paths)
    if (path.startsWith('/ccapi/ver120/contents/') && (path.endsWith('.JPG') || path.endsWith('.CR3'))) {
      const kind = url.searchParams.get('kind') ?? 'thumbnail';
      if (kind === 'thumbnail' || kind === 'original') {
        return new Response(thumbnailBuffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      }
      return new Response(JSON.stringify({ message: 'invalid kind' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Long-poll event endpoint (ver110) — DELETE only for session reset
    if (path === '/ccapi/ver110/event/polling') {
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    }

    // Event monitoring stream (ver100) — binary-framed chunked JSON
    if (path === '/ccapi/ver100/event/monitoring') {
      if (req.method === 'DELETE') {
        return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
      }

      // Return a ReadableStream that emits binary-framed JSON events as shots fire
      const MAGIC = new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x02, 0x00, 0x00, 0x00]);

      function makeFrame(json: string): Uint8Array {
        const payload = new TextEncoder().encode(json);
        const len = new Uint8Array(4);
        new DataView(len.buffer).setUint32(0, payload.length, false);
        const frame = new Uint8Array(MAGIC.length + 4 + payload.length);
        frame.set(MAGIC, 0);
        frame.set(len, MAGIC.length);
        frame.set(payload, MAGIC.length + 4);
        return frame;
      }

      let streamClosed = false;
      const body = new ReadableStream({
        start(controller) {
          // Send an initial empty frame to signal connection
          controller.enqueue(makeFrame('{}'));

          // Register as a poller — fire shot frames when shots happen
          const resolver = (response: Response) => {
            if (streamClosed) return;
            // Re-resolve means a shot fired; parse and re-enqueue
            response.json().then((data) => {
              if (data.kind === 'shotnotification' && data.value?.path) {
                const frame = makeFrame(JSON.stringify({
                  addedcontents: [data.value.path],
                }));
                controller.enqueue(frame);
              }
              // Re-register for next shot
              if (!streamClosed) pendingPollers.push({ resolve: resolver });
            });
          };
          pendingPollers.push({ resolve: resolver });
        },
        cancel() {
          streamClosed = true;
        },
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[mock] Canon CCAPI mock server running on http://localhost:${PORT}`);
console.log(`[mock] Auto-firing shots every ${SHOT_INTERVAL_MS / 1000}s`);
console.log(`[mock] Press Ctrl+C to stop`);
