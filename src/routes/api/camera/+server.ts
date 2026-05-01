/**
 * /api/camera — Camera configuration
 *
 * GET  — return current camera config
 * POST — validate + update camera config and reconnect
 *        Returns 422 if the address doesn't respond as a Canon camera
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getCameraConfig, setCameraConfig, cameraFetchRaw } from '$lib/server/camera';
import { startMonitor } from '$lib/server/monitor';

export const GET: RequestHandler = () => {
  return json(getCameraConfig());
};

export const POST: RequestHandler = async ({ request }) => {
  const { ip, port, https } = await request.json();

  // Validate the address is a real Canon camera before saving.
  // Probe /ccapi/ver100/deviceinformation — all CCAPI cameras respond here.
  const baseUrl = `${https ? 'https' : 'http'}://${ip}:${port ?? 8080}`;
  let isCamera = false;
  try {
    const probe = await cameraFetchRaw('/ccapi/ver100/deviceinformation', {
      signal: AbortSignal.timeout(6_000),
    }, baseUrl);
    if (probe.ok) {
      const data = await probe.json() as Record<string, unknown>;
      // Must have a productname field — generic HTTP servers won't have this
      isCamera = typeof data.productname === 'string' && data.productname.length > 0;
    }
    probe.body?.cancel().catch(() => {});
  } catch { /* timeout or connection refused — not a camera */ }

  if (!isCamera) {
    return json(
      { error: 'No Canon camera found at that address. Check the IP address and try again.' },
      { status: 422 }
    );
  }

  setCameraConfig(ip, port ?? 8080, https ?? false);
  // Reconnect with new settings — all SSE clients will receive new status events
  startMonitor();
  return json(getCameraConfig());
};
