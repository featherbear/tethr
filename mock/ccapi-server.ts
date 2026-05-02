#!/usr/bin/env bun
/**
 * Mock Canon CCAPI server for development.
 * Simulates all endpoints used by Tethr against real R6 Mark II behaviour.
 * Run with: bun run mock/ccapi-server.ts
 */

const PORT = 8080;
const SHOT_INTERVAL_MS = 5000; // auto-fire a shot every 5s

let shotCounter = 0;
type StreamController = ReadableStreamDefaultController<Uint8Array>;
const monitorClients: Set<StreamController> = new Set();

// ---------------------------------------------------------------------------
// Frame encoder (matches real camera binary framing)
// ---------------------------------------------------------------------------
const FRAME_MAGIC = new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x02, 0x00, 0x00, 0x00]);

function makeFrame(json: object): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(json));
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, payload.length, false);
  const frame = new Uint8Array(FRAME_MAGIC.length + 4 + payload.length);
  frame.set(FRAME_MAGIC, 0);
  frame.set(lenBuf, FRAME_MAGIC.length);
  frame.set(payload, FRAME_MAGIC.length + 4);
  return frame;
}

function broadcast(json: object) {
  const frame = makeFrame(json);
  for (const ctrl of monitorClients) {
    try { ctrl.enqueue(frame); } catch { monitorClients.delete(ctrl); }
  }
}

// ---------------------------------------------------------------------------
// Auto-fire shots
// ---------------------------------------------------------------------------
// Alternate between RAW+JPG pairs to simulate camera in RAW+JPEG mode
setInterval(() => {
  shotCounter++;
  const n = String(shotCounter).padStart(4, '0');
  const base = `/ccapi/ver120/contents/card1/100MOCK/IMG_${n}`;

  // Fire CR3 first, then JPG 500ms later (mirrors real camera behaviour)
  broadcast({ addedcontents: [`${base}.CR3`] });
  setTimeout(() => broadcast({ addedcontents: [`${base}.JPG`] }), 500);

  console.log(`[mock] Shot ${shotCounter}: IMG_${n}.CR3 + IMG_${n}.JPG`);
}, SHOT_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Dummy JPEG (1×1 red pixel)
// ---------------------------------------------------------------------------
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
  'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN' +
  'DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
  'MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABgUEB' +
  '/8QAIRAAAgIBBAMBAAAAAAAAAAAAAQIDBAUREiExQVH/xAAUAQEAAAAAAAAAAAAAAAAAAAAA' +
  '/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Amu69bYpRjGKlJJerFbSWy' +
  'AAAAASUVORK5CYII=';
const dummyJpeg = Buffer.from(TINY_JPEG_B64, 'base64');
const jpegResponse = () => new Response(dummyJpeg, { headers: { 'Content-Type': 'image/jpeg' } });

// ---------------------------------------------------------------------------
// Shooting settings (mock values)
// ---------------------------------------------------------------------------
// Shooting settings in CCAPI format: { key: { value, ability[] } }
// The app reads all[key]?.value — flat strings won't be parsed
const shootingSettings = {
  av: { value: 'f2.8' },
  tv: { value: '1/125' },
  iso: { value: '800' },
  wb: { value: 'colortemp' },
  colortemperature: { value: 5600 },
  exposure: { value: '+0.0' },
  metering: { value: 'evaluative' },
  drive: { value: 'single' },
  afoperation: { value: 'af' },
  shootingmodedial: { value: 'av' },
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const kind = url.searchParams.get('kind');

    console.log(`[mock] ${req.method} ${path}${url.search}`);

    // CCAPI capabilities
    if (path === '/ccapi') {
      return Response.json({
        ver100: ['/ccapi/ver100/devicestatus', '/ccapi/ver100/shooting', '/ccapi/ver100/event'],
        ver110: ['/ccapi/ver110/event'],
        ver120: ['/ccapi/ver120/contents'],
      });
    }

    // Device info — canonical path used by app for probe + device info
    if (path === '/ccapi/ver100/deviceinformation') {
      return Response.json({
        productname: 'Canon EOS R6 Mark II',
        manufacturer: 'Canon Inc.',
        modeldescription: 'Canon EOS R6m2',
        serialnumber: '000000000000',
        firmwareversion: '1.6.0',
        macaddress: 'aa:bb:cc:dd:ee:ff',
      });
    }

    // Legacy device status path (kept for compatibility)
    if (path === '/ccapi/ver100/devicestatus/deviceinfo') {
      return Response.json({
        manufacturer: 'Canon Inc.',
        modeldescription: 'Canon EOS R6m2',
        serialnumber: '000000000000',
        firmwareversion: '1.6.0',
        macaddress: 'aa:bb:cc:dd:ee:ff',
      });
    }

    // Battery
    if (path === '/ccapi/ver100/devicestatus/battery') {
      return Response.json({
        name: 'battery',
        kind: 'battery',
        value: [{ kind: 'battery', name: 'LP-E6NH', level: 'high', quality: 'normal' }],
      });
    }

    // Battery list (ver110)
    if (path === '/ccapi/ver110/devicestatus/batterylist') {
      return Response.json({
        batterylist: [{ kind: 'battery', name: 'LP-E6NH', level: 'high', quality: 'normal' }],
      });
    }

    // Lens
    if (path === '/ccapi/ver100/devicestatus/lens') {
      return Response.json({
        name: 'lens',
        value: 'Mock 24-70mm f/2.8',
      });
    }

    // Storage info
    if (path === '/ccapi/ver120/contents') {
      return Response.json({
        path: ['/ccapi/ver120/contents/card1'],
        storagelist: [{
          name: 'card1',
          totalsize: 274877906944,
          freesize: 240000000000,
          recordableimage: 9999,
        }],
      });
    }

    // Card root — list folders
    if (path === '/ccapi/ver120/contents/card1') {
      return Response.json({ path: ['/ccapi/ver120/contents/card1/100MOCK'] });
    }

    // Folder contents — list all fired shots (both CR3 and JPG)
    if (path === '/ccapi/ver120/contents/card1/100MOCK') {
      const files: string[] = [];
      for (let i = 1; i <= shotCounter; i++) {
        const n = String(i).padStart(4, '0');
        files.push(`/ccapi/ver120/contents/card1/100MOCK/IMG_${n}.CR3`);
        files.push(`/ccapi/ver120/contents/card1/100MOCK/IMG_${n}.JPG`);
      }
      return Response.json({ path: files });
    }

    // Image files — thumbnail, display, original
    if (path.match(/\/ccapi\/ver120\/contents\/.*\.(JPG|CR3)$/i)) {
      if (kind === 'thumbnail' || kind === 'display' || kind === 'original') {
        return jpegResponse();
      }
      return Response.json({ message: 'invalid kind parameter' }, { status: 400 });
    }

    // Shooting settings — full bundle
    // Returns { key: { value, ability[] } } — app reads all[key]?.value
    if (path === '/ccapi/ver100/shooting/settings') {
      return Response.json(shootingSettings);
    }

    // Shooting settings — individual
    if (path.startsWith('/ccapi/ver100/shooting/settings/')) {
      const key = path.split('/').pop()!;
      const setting = shootingSettings[key as keyof typeof shootingSettings];
      if (setting) return Response.json(setting);
      return Response.json({ message: 'not found' }, { status: 404 });
    }

    // Event monitoring stream — persistent binary-framed connection
    if (path === '/ccapi/ver100/event/monitoring') {
      if (req.method === 'DELETE') {
        return Response.json({});
      }

      const body = new ReadableStream<Uint8Array>({
        start(ctrl) {
          monitorClients.add(ctrl);
          // Send initial settings frame so client gets settings immediately
          ctrl.enqueue(makeFrame({
            av: shootingSettings.av.value,
            tv: shootingSettings.tv.value,
            iso: shootingSettings.iso.value,
            wb: shootingSettings.wb.value,
            colortemperature: shootingSettings.colortemperature.value,
            exposure: shootingSettings.exposure.value,
            metering: shootingSettings.metering.value,
            drive: shootingSettings.drive.value,
            afoperation: shootingSettings.afoperation.value,
          }));
        },
        cancel() {
          // Client disconnected — remove from set
          // Can't easily reference ctrl here, clean up on next broadcast
        },
      });

      return new Response(body, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Transfer-Encoding': 'chunked',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Polling endpoint (ver110) — not used for main flow but exists
    if (path === '/ccapi/ver110/event/polling') {
      return Response.json({});
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`[mock] Canon CCAPI mock server running on http://localhost:${PORT}`);
console.log(`[mock] Auto-firing RAW+JPG pairs every ${SHOT_INTERVAL_MS / 1000}s`);
console.log(`[mock] Press Ctrl+C to stop`);
