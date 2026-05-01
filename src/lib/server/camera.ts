/**
 * camera.ts — server-side camera connection layer
 *
 * Single source of truth for all communication with the Canon EOS R6 Mark II
 * over CCAPI (HTTPS, self-signed cert, port 443).
 *
 * All CCAPI interaction happens here. No other file talks to the camera directly.
 */

import { Agent, fetch as undiciFetch } from 'undici';

// ---------------------------------------------------------------------------
// Configuration — mutable at runtime via setCameraConfig()
// ---------------------------------------------------------------------------

interface CameraConfig {
  ip: string;
  port: number;
  https: boolean;
}

let _config: CameraConfig = (() => {
  const raw = process.env.CCAPI_BASE_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      return {
        ip: url.hostname,
        port: Number(url.port) || (url.protocol === 'https:' ? 443 : 8080),
        https: url.protocol === 'https:',
      };
    } catch { /* fall through to default */ }
  }
  return { ip: '192.168.1.2', port: 8080, https: false };
})();

export function getCameraConfig(): Readonly<CameraConfig> { return _config; }

export function getCameraBaseUrl(): string {
  return `${_config.https ? 'https' : 'http'}://${_config.ip}:${_config.port}`;
}

export function setCameraConfig(ip: string, port: number, https: boolean): string {
  _config = { ip, port, https };
  return getCameraBaseUrl();
}

// ---------------------------------------------------------------------------
// HTTP fetch — serialised queue + undici Agent for self-signed TLS cert
//
// CCAPI is single-threaded: concurrent requests cause HTTP 503.
// All camera fetches are queued here server-side so no two overlap.
// Streaming requests (monitoring stream) bypass the queue via cameraFetchRaw.
// ---------------------------------------------------------------------------

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

function rawFetch(url: string, init: RequestInit): Promise<Response> {
  if (_config.https) {
    return undiciFetch(url, { ...(init as object), dispatcher: insecureAgent }) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}

// Server-side serial queue — one CCAPI request at a time
// Uses globalThis so it survives Vite HMR module reloads
const g = globalThis as Record<string, unknown>;
if (!g.__camera_queue) g.__camera_queue = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const prev = g.__camera_queue as Promise<unknown>;
  const next = prev.then(() => fn(), () => fn()); // always continue even if previous failed
  g.__camera_queue = next.then(() => {}, () => {}); // detach to avoid chain growth
  return next as Promise<T>;
}

/**
 * Make a serialised request to the camera.
 * All calls go through a server-side queue — CCAPI is single-threaded.
 */
export function cameraFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${getCameraBaseUrl()}${path}`;
  return enqueue(() => rawFetch(url, init));
}

/**
 * Make a direct (non-queued) request to the camera.
 * Use ONLY for the persistent monitoring stream — it must not block the queue.
 * Pass an optional baseUrl override to probe a different address (e.g. for validation).
 */
export function cameraFetchRaw(path: string, init: RequestInit = {}, baseUrl?: string): Promise<Response> {
  const url = `${baseUrl ?? getCameraBaseUrl()}${path}`;
  return rawFetch(url, init);
}

// ---------------------------------------------------------------------------
// Monitoring stream frame parser
//
// The /ccapi/ver100/event/monitoring endpoint returns a binary-framed stream.
//
// Frame format (two variants observed):
//   First frame:       0xff 0x00 0x02 [4-byte BE length] [JSON]
//   Subsequent frames: 0xff 0xff 0xff 0x00 0x02 [4-byte BE length] [JSON]
//
// Empty frames (length=2, payload="{}") are heartbeats — ignore.
// ---------------------------------------------------------------------------

export interface MonitoringFrame {
  raw: string;        // raw JSON string
  parsed: Record<string, unknown>;
}

/**
 * Extract all complete frames from a buffer.
 * Returns the parsed frames and any remaining incomplete bytes.
 */
export function extractFrames(buf: Buffer): { frames: MonitoringFrame[]; remainder: Buffer } {
  const frames: MonitoringFrame[] = [];

  while (buf.length >= 7) {
    if (buf[0] !== 0xff) {
      // Scan forward for next frame marker
      const next = buf.indexOf(0xff, 1);
      if (next === -1) { buf = Buffer.alloc(0); break; }
      buf = buf.subarray(next);
      continue;
    }

    let headerSize: number;
    let lengthOffset: number;

    if (buf.length >= 9 && buf[1] === 0xff && buf[2] === 0xff && buf[3] === 0x00 && buf[4] === 0x02) {
      // Long header: ff ff ff 00 02 [4-byte len]
      headerSize = 9;
      lengthOffset = 5;
    } else if (buf[1] === 0x00 && buf[2] === 0x02) {
      // Short header: ff 00 02 [4-byte len]
      headerSize = 7;
      lengthOffset = 3;
    } else {
      // Unknown — skip this byte and resync
      buf = buf.subarray(1);
      continue;
    }

    if (buf.length < headerSize) break; // incomplete header

    const payloadLen = buf.readUInt32BE(lengthOffset);
    const frameEnd = headerSize + payloadLen;

    if (buf.length < frameEnd) break; // incomplete payload

    const payload = buf.subarray(headerSize, frameEnd).toString('utf8');
    buf = buf.subarray(frameEnd);

    if (payloadLen <= 2) continue; // heartbeat ("{}") — skip

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      frames.push({ raw: payload, parsed });
    } catch { /* malformed — skip */ }
  }

  return { frames, remainder: buf };
}
