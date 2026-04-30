/**
 * /api/state — initial page load state
 *
 * Returns the current connection status and camera info in one request,
 * so the page can render the correct initial state without waiting for SSE.
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getStatus, getSettings } from '$lib/server/monitor';
import { cameraFetch, getCameraConfig } from '$lib/server/camera';

export const GET: RequestHandler = async () => {
  const { status, error } = getStatus();
  const config = getCameraConfig();

  let cameraInfo = null;
  if (status === 'live') {
    try {
      const [deviceRes, batteryRes, lensRes] = await Promise.all([
        cameraFetch('/ccapi/ver100/deviceinformation',    { signal: AbortSignal.timeout(5_000) }),
        cameraFetch('/ccapi/ver100/devicestatus/battery', { signal: AbortSignal.timeout(5_000) }),
        cameraFetch('/ccapi/ver100/devicestatus/lens',    { signal: AbortSignal.timeout(5_000) }),
      ]);
      if (deviceRes.ok && batteryRes.ok) {
        const device  = await deviceRes.json();
        const battery = await batteryRes.json();
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

  const settings = getSettings();
  return json({ status, error, config, cameraInfo, settings });
};
