import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { cameraFetch } from '$lib/server/camera';

export interface CameraInfo {
  productname: string;
  serialnumber: string;
  firmwareversion: string;
  battery: {
    level: string;   // numeric % string e.g. "14" (from batterylist) or named: 'full'|'high'|'half'|'quarter'|'low'|'exhausted'|'charge'|'chargestop'|'chargecomp'|'none'|'unknown'
    quality: string; // 'normal' | 'degraded'
    name: string;    // e.g. 'LP-E6NH'
  };
  lens: string | null;  // e.g. "TAMRON SP 24-70mm F/2.8 Di VC USD G2 A032"
}

export const GET: RequestHandler = async () => {
  try {
    const [deviceRes, batteryListRes, batteryRes, lensRes] = await Promise.all([
      cameraFetch('/ccapi/ver100/deviceinformation',          { signal: AbortSignal.timeout(8_000) }),
      cameraFetch('/ccapi/ver110/devicestatus/batterylist',   { signal: AbortSignal.timeout(8_000) }),
      cameraFetch('/ccapi/ver100/devicestatus/battery',       { signal: AbortSignal.timeout(8_000) }),
      cameraFetch('/ccapi/ver100/devicestatus/lens',          { signal: AbortSignal.timeout(8_000) }),
    ]);

    if (!deviceRes.ok)  error(502, 'Failed to fetch device information');
    if (!batteryRes.ok) error(502, 'Failed to fetch battery status');

    const device  = await deviceRes.json();

    // Prefer batterylist (ver110) which returns numeric % level (e.g. "14").
    // Fall back to battery (ver100) which returns named levels (e.g. "low").
    type BatteryEntry = { kind: string; name: string; quality: string; level: string };
    const batteryListEntry: BatteryEntry | null = batteryListRes.ok
      ? ((await batteryListRes.json() as { batterylist?: BatteryEntry[] }).batterylist?.[0] ?? null)
      : null;
    const battery: BatteryEntry = batteryListEntry ?? await batteryRes.json();

    const lens    = lensRes.ok ? await lensRes.json() : null;

    const info: CameraInfo = {
      productname:     device.productname     ?? 'Unknown Camera',
      serialnumber:    device.serialnumber    ?? '',
      firmwareversion: device.firmwareversion ?? '',
      battery: {
        level:   battery.level   ?? 'unknown',
        quality: battery.quality ?? 'normal',
        name:    battery.name    ?? '',
      },
      lens: lens?.mount ? (lens.name ?? null) : null,
    };

    return json(info);
  } catch (e) {
    error(502, `Could not reach camera: ${e}`);
  }
};
