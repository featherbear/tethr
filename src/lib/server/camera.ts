import { Agent, fetch as undiciFetch } from 'undici';

interface CameraConfig {
  ip: string;
  port: number;
  https: boolean;
}

let _config: CameraConfig = (() => {
  const raw = process.env.CCAPI_BASE_URL;
  if (raw) {
    const url = new URL(raw);
    return {
      ip: url.hostname,
      port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 8080),
      https: url.protocol === 'https:',
    };
  }
  return { ip: '192.168.1.2', port: 8080, https: false };
})();

// Reusable agent that skips TLS verification — safe for local LAN use
// with the camera's self-signed certificate.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

export function getCameraConfig(): Readonly<CameraConfig> {
  return _config;
}

export function getCameraBaseUrl(): string {
  const proto = _config.https ? 'https' : 'http';
  return `${proto}://${_config.ip}:${_config.port}`;
}

export function setCameraConfig(ip: string, port: number, https: boolean): string {
  _config = { ip, port, https };
  return getCameraBaseUrl();
}

/**
 * fetch() wrapper that automatically applies the insecure TLS agent when
 * communicating with the camera over HTTPS (self-signed cert).
 * Use this everywhere instead of bare fetch() when calling the camera.
 */
export function cameraFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${getCameraBaseUrl()}${path}`;
  if (_config.https) {
    // undici fetch accepts a dispatcher option for the custom agent
    return undiciFetch(url, { ...(init as object), dispatcher: insecureAgent }) as unknown as Promise<Response>;
  }
  return fetch(url, init);
}
