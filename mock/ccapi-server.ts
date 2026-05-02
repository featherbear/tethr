#!/usr/bin/env bun
/**
 * Mock Canon CCAPI server for development.
 * Simulates all endpoints used by Tethr against real R6 Mark II behaviour.
 * Run with: bun run mock/ccapi-server.ts
 */

import { Jimp, JimpMime, loadFont } from 'jimp';

const PORT = 8080;
const SHOT_INTERVAL_MS = 5000; // auto-fire a shot every 5s

let shotCounter = 0;
type StreamController = ReadableStreamDefaultController<Uint8Array>;
const monitorClients: Set<StreamController> = new Set();

// ---------------------------------------------------------------------------
// Frame encoder (matches real camera binary framing)
//
// Real camera frame format (variant B — used for all frames after the first):
//   0xff 0xff 0xff 0x00 0x02  [4-byte BE payload length]  [JSON payload]
//   ←────── 5 magic bytes ──→  ←──── 4 bytes ────────→
// Total header = 9 bytes. extractFrames() in camera.ts detects this by
// checking bytes[1..4] === ff ff 00 02 and reads length from offset 5.
// ---------------------------------------------------------------------------
const FRAME_HEADER = new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x02]);

function makeFrame(json: object): Uint8Array {
  const payload = new TextEncoder().encode(JSON.stringify(json));
  const lenBuf = new Uint8Array(4);
  new DataView(lenBuf.buffer).setUint32(0, payload.length, false); // BE uint32
  // Header: 5 magic bytes + 4 length bytes = 9 bytes total
  const frame = new Uint8Array(FRAME_HEADER.length + 4 + payload.length);
  frame.set(FRAME_HEADER, 0);
  frame.set(lenBuf, FRAME_HEADER.length);
  frame.set(payload, FRAME_HEADER.length + 4);
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
// Image generation
//
// Per-filename images for consistent previews:
//   - Online:  fetch from picsum.photos (seeded by shot number for consistency)
//   - Offline: generate a JPEG locally using a coloured canvas with filename + date text
//
// Thumbnail = 320×213, Display = 1920×1280
// ---------------------------------------------------------------------------

/** Derive a stable numeric seed from a filename string. */
function seedFromFilename(filename: string): number {
  let h = 0;
  for (const c of filename) h = (Math.imul(31, h) + c.charCodeAt(0)) >>> 0;
  return (h % 1000) + 1; // picsum IDs 1–1000
}

/** Try to fetch an image from picsum.photos. Returns null on network failure. */
async function fetchPicsum(seed: number, w: number, h: number): Promise<Buffer | null> {
  try {
    const res = await fetch(`https://picsum.photos/seed/${seed}/${w}/${h}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Generate a fallback JPEG locally using Jimp.
 * Draws a dark background with filename and timestamp centered.
 * Used when picsum.photos is unreachable (no internet).
 */
let _font16: Awaited<ReturnType<typeof loadFont>> | null = null;
let _font32: Awaited<ReturnType<typeof loadFont>> | null = null;

async function getFont(size: 16 | 32) {
  const { createRequire } = await import('module');
  const req = createRequire(import.meta.url);
  const pluginPkg = req.resolve('@jimp/plugin-print/package.json');
  const fontDir = pluginPkg.replace('package.json', `fonts/open-sans/open-sans-${size}-white`);
  return loadFont(`file://${fontDir}/open-sans-${size}-white.fnt`);
}

async function generateFallbackJpeg(label: string, w: number, h: number): Promise<Buffer> {
  try {
    if (!_font16) _font16 = await getFont(16);
    if (!_font32) _font32 = await getFont(32);

    const img = new Jimp({ width: w, height: h, color: 0x1a1a2eff });

    // Draw a subtle grid
    for (let x = 0; x < w; x += 60) {
      for (let y = 0; y < h; y++) img.setPixelColor(0x2a2a4eff, x, y);
    }
    for (let y = 0; y < h; y += 60) {
      for (let x = 0; x < w; x++) img.setPixelColor(0x2a2a4eff, x, y);
    }

    const font = w >= 800 ? _font32 : _font16;
    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

    img.print({ font, x: 0, y: Math.floor(h / 2) - 30, text: { text: label, alignmentX: 1 }, maxWidth: w });
    img.print({ font: _font16, x: 0, y: Math.floor(h / 2) + 10, text: { text: ts, alignmentX: 1 }, maxWidth: w });

    return Buffer.from(await img.getBuffer(JimpMime.jpeg));
  } catch {
    // Ultimate fallback — tiny 1×1 grey JPEG
    return Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U' +
      'HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIA' +
      'AhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAU' +
      'AQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A' +
      'JQAB/9k=',
      'base64'
    );
  }
}

/** Return an image response for a given filename and kind. */
async function imageResponse(filename: string, kind: 'thumbnail' | 'display' | 'original'): Promise<Response> {
  const isThumb = kind === 'thumbnail';
  const w = isThumb ? 320 : 1920;
  const h = isThumb ? 213 : 1280;
  const seed = seedFromFilename(filename);

  const buf = (await fetchPicsum(seed, w, h)) ?? (await generateFallbackJpeg(filename, w, h));
  return new Response(buf, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(buf.length),
    },
  });
}

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
        productname: 'Canon EOS Mock Device',
        manufacturer: 'Canon Inc.',
        modeldescription: 'Canon EOS Mock Device',
        serialnumber: '000123456789',
        firmwareversion: '1.0.0',
        macaddress: 'aa:bb:cc:dd:ee:ff',
      });
    }

    // Legacy device status path (kept for compatibility)
    if (path === '/ccapi/ver100/devicestatus/deviceinfo') {
      return Response.json({
        manufacturer: 'Canon Inc.',
        modeldescription: 'Canon EOS Mock Device',
        serialnumber: '000123456789',
        firmwareversion: '1.0.0',
        macaddress: 'aa:bb:cc:dd:ee:ff',
      });
    }

    // Battery
    // ver100 battery — returns named level ('full'|'high'|'half'|'quarter'|'low'|...)
    if (path === '/ccapi/ver100/devicestatus/battery') {
      return Response.json({
        kind: 'battery',
        name: 'LP-E6NH',
        quality: 'normal',
        level: 'half',
      });
    }

    // ver110 batterylist — returns numeric % level as a string e.g. "50"
    if (path === '/ccapi/ver110/devicestatus/batterylist') {
      return Response.json({
        batterylist: [{ position: 'camera', kind: 'battery', name: 'LP-E6NH', quality: 'normal', level: '50' }],
      });
    }

    // Lens
    if (path === '/ccapi/ver100/devicestatus/lens') {
      return Response.json({
        mount: true,
        name: 'Mock 24-70mm f/2.8',
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
        const filename = path.split('/').pop()!;
        return imageResponse(filename, kind as 'thumbnail' | 'display' | 'original');
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
