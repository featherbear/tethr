/**
 * camera.ts — server-side camera connection layer
 *
 * Single source of truth for all communication with the Canon CCAPI.
 *
 * Two fetch modes:
 *   cameraFetch()       — serialised through a server-side queue (CCAPI is single-threaded)
 *   cameraFetchDirect() — bypasses the queue; used ONLY for the monitoring stream and
 *                         lightweight probes that must not block or be blocked by the queue
 *
 * All other files import from here — nothing else speaks to the camera directly.
 */

import { Agent, fetch as undiciFetch } from 'undici';
import { childLogger } from './logger';

const log = childLogger('camera');

// ---------------------------------------------------------------------------
// Configuration — mutable at runtime via setCameraConfig()
// ---------------------------------------------------------------------------

export interface CameraConfig {
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
  return { ip: '192.168.1.26', port: 8080, https: false };
})();

export function getCameraConfig(): Readonly<CameraConfig> { return _config; }

export function getCameraBaseUrl(): string {
  const { ip, port, https } = _config;
  return `${https ? 'https' : 'http'}://${ip}:${port}`;
}

export function setCameraConfig(ip: string, port: number, https: boolean): string {
  _config = { ip, port, https };
  const url = getCameraBaseUrl();
  log.info({ ip, port, https, url }, 'Camera config updated');
  return url;
}

// ---------------------------------------------------------------------------
// Low-level fetch — handles self-signed TLS via undici Agent
// ---------------------------------------------------------------------------

const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

function rawFetch(url: string, init: RequestInit, baseUrl?: string): Promise<Response> {
  const effectiveUrl = baseUrl ? `${baseUrl}${url}` : `${getCameraBaseUrl()}${url}`;
  if (_config.https) {
    return undiciFetch(effectiveUrl, { ...(init as object), dispatcher: insecureAgent }) as unknown as Promise<Response>;
  }
  return fetch(effectiveUrl, init);
}

// ---------------------------------------------------------------------------
// Serial queue — one in-flight CCAPI request at a time
// Stored on globalThis so it survives Vite HMR module reloads in dev.
// ---------------------------------------------------------------------------

const g = globalThis as Record<string, unknown>;
if (!g.__camera_queue) g.__camera_queue = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const tail = g.__camera_queue as Promise<unknown>;
  // Always continue even if the previous request failed
  const result = tail.then(fn, fn) as Promise<T>;
  // Replace the tail with a settled version to avoid unbounded chain growth
  g.__camera_queue = result.then(() => {}, () => {});
  return result;
}

/**
 * Serialised camera fetch — all general CCAPI requests must use this.
 * Ensures no two requests overlap (CCAPI is single-threaded).
 */
export function cameraFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  log.debug({ method, path }, 'Camera fetch (queued)');
  return enqueue(() =>
    rawFetch(path, init).then((res) => {
      if (!res.ok) log.warn({ method, path, status: res.status }, 'Camera fetch non-OK response');
      return res;
    })
  );
}

/**
 * Direct (non-queued) camera fetch.
 * Use ONLY for:
 *   1. The persistent monitoring stream (would block queue forever)
 *   2. Lightweight reachability probes before the queue is in use
 *
 * Optionally accepts a baseUrl override for probing a different address
 * (e.g. validating a new IP before saving config).
 */
export function cameraFetchDirect(path: string, init: RequestInit = {}, baseUrl?: string): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  log.debug({ method, path, direct: true }, 'Camera fetch (direct/unqueued)');
  return rawFetch(path, init, baseUrl);
}

// ---------------------------------------------------------------------------
// Monitoring stream frame parser
//
// The /ccapi/ver100/event/monitoring endpoint returns a binary-framed stream.
//
// Frame format (two variants observed on Canon bodies):
//   First frame:       0xff 0x00 0x02 [4-byte BE length] [JSON]
//   Subsequent frames: 0xff 0xff 0xff 0x00 0x02 [4-byte BE length] [JSON]
//
// Empty frames (length <= 2, payload "{}") are heartbeats — ignore.
// ---------------------------------------------------------------------------

export interface MonitoringFrame {
  raw: string;
  parsed: Record<string, unknown>;
}

export function extractFrames(buf: Buffer): { frames: MonitoringFrame[]; remainder: Buffer } {
  const frames: MonitoringFrame[] = [];

  while (buf.length >= 7) {
    if (buf[0] !== 0xff) {
      const next = buf.indexOf(0xff, 1);
      if (next === -1) { buf = Buffer.alloc(0); break; }
      buf = buf.subarray(next);
      continue;
    }

    let headerSize: number;
    let lengthOffset: number;

    if (buf.length >= 9 && buf[1] === 0xff && buf[2] === 0xff && buf[3] === 0x00 && buf[4] === 0x02) {
      headerSize = 9;
      lengthOffset = 5;
    } else if (buf[1] === 0x00 && buf[2] === 0x02) {
      headerSize = 7;
      lengthOffset = 3;
    } else {
      buf = buf.subarray(1);
      continue;
    }

    if (buf.length < headerSize) break;

    const payloadLen = buf.readUInt32BE(lengthOffset);
    const frameEnd = headerSize + payloadLen;

    if (buf.length < frameEnd) break;

    const payload = buf.subarray(headerSize, frameEnd).toString('utf8');
    buf = buf.subarray(frameEnd);

    if (payloadLen <= 2) continue; // heartbeat

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      frames.push({ raw: payload, parsed });
    } catch { /* malformed — skip */ }
  }

  return { frames, remainder: buf };
}
