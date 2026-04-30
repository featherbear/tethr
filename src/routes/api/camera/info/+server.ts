import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { cameraFetch } from '$lib/server/camera';

export interface CameraInfo {
  productname: string;
  serialnumber: string;
  firmwareversion: string;
  battery: {
    level: string;   // 'high' | 'half' | 'low' | 'exhausted'
    quality: string; // 'normal' | 'degraded'
    name: string;    // e.g. 'LP-E6NH'
  };
  storage: {
    name: string;
    maxsize: number;
    spacesize: number;
    contentsnumber: number;
  } | null;
}

export const GET: RequestHandler = async () => {
  try {
    const [deviceRes, batteryRes, storageRes] = await Promise.all([
      cameraFetch('/ccapi/ver100/deviceinformation', { signal: AbortSignal.timeout(8_000) }),
      cameraFetch('/ccapi/ver100/devicestatus/battery', { signal: AbortSignal.timeout(8_000) }),
      cameraFetch('/ccapi/ver110/devicestatus/storage', { signal: AbortSignal.timeout(8_000) }),
    ]);

    if (!deviceRes.ok)  error(502, 'Failed to fetch device information');
    if (!batteryRes.ok) error(502, 'Failed to fetch battery status');

    const device  = await deviceRes.json();
    const battery = await batteryRes.json();
    const storage = storageRes.ok ? await storageRes.json() : null;

    const info: CameraInfo = {
      productname:     device.productname  ?? 'Unknown Camera',
      serialnumber:    device.serialnumber ?? '',
      firmwareversion: device.firmwareversion ?? '',
      battery: {
        level:   battery.level   ?? 'unknown',
        quality: battery.quality ?? 'normal',
        name:    battery.name    ?? '',
      },
      storage: storage?.storagelist?.[0] ?? null,
    };

    return json(info);
  } catch (e) {
    error(502, `Could not reach camera: ${e}`);
  }
};
