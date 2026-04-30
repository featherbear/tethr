// Shared server-side camera base URL
// All API routes import from here — single source of truth.
let _cameraBaseUrl: string = process.env.CCAPI_BASE_URL ?? 'http://192.168.1.2:8080';

export function getCameraBaseUrl(): string {
  return _cameraBaseUrl;
}

export function setCameraBaseUrl(ip: string, port: number = 8080): string {
  _cameraBaseUrl = `http://${ip}:${port}`;
  return _cameraBaseUrl;
}
