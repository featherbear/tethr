/**
 * /api/state — initial page load state
 *
 * Returns the current connection status and camera info in one request,
 * so the page can render the correct initial state without waiting for SSE.
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getStatus } from '$lib/server/monitor';
import { cameraFetch, getCameraConfig } from '$lib/server/camera';

export const GET: RequestHandler = async () => {
  const { status, error } = getStatus();
  const config = getCameraConfig();

  let cameraInfo = null;
  if (status === 'live') {
    try {
      const [deviceRes, batteryListRes, batteryRes, lensRes] = await Promise.all([
        cameraFetch('/ccapi/ver100/deviceinformation',          { signal: AbortSignal.timeout(5_000) }),
        cameraFetch('/ccapi/ver110/devicestatus/batterylist',   { signal: AbortSignal.timeout(5_000) }),
        cameraFetch('/ccapi/ver100/devicestatus/battery',       { signal: AbortSignal.timeout(5_000) }),
        cameraFetch('/ccapi/ver100/devicestatus/lens',          { signal: AbortSignal.timeout(5_000) }),
      ]);
      if (deviceRes.ok && (batteryListRes.ok || batteryRes.ok)) {
        const device = await deviceRes.json();
        // Prefer batterylist (ver110) — returns numeric % level. Fall back to ver100 named level.
        type BatteryEntry = { kind: string; name: string; quality: string; level: string };
        const batteryListEntry: BatteryEntry | null = batteryListRes.ok
          ? ((await batteryListRes.json() as { batterylist?: BatteryEntry[] }).batterylist?.[0] ?? null)
          : null;
        const battery: BatteryEntry = batteryListEntry ?? (batteryRes.ok ? await batteryRes.json() : { kind: '', name: '', quality: 'normal', level: 'unknown' });
        const lens = lensRes.ok ? await lensRes.json() : null;
        cameraInfo = {
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
      }
    } catch { /* non-fatal */ }
  }

  return json({ status, error, config, cameraInfo });
};
