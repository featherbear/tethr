/**
 * /api/camera — Camera configuration
 *
 * GET  — return current camera config
 * POST — validate + update camera config and reconnect
 *        Returns 422 if the address doesn't respond as a Canon camera
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getCameraConfig, setCameraConfig, cameraFetchDirect } from '$lib/server/camera';
import { startMonitor } from '$lib/server/monitor';
import { childLogger } from '$lib/server/logger';

const log = childLogger('api:camera');

export const GET: RequestHandler = () => {
  return json(getCameraConfig());
};

export const POST: RequestHandler = async ({ request }) => {
  const { ip, port, https } = await request.json();

  // Validate the address is a real Canon camera before saving.
  // Probe /ccapi/ver100/deviceinformation — all CCAPI cameras respond here.
  const baseUrl = `${https ? 'https' : 'http'}://${ip}:${port ?? 8080}`;
  log.info({ ip, port, https, baseUrl }, 'Camera config probe');
  let isCamera = false;
  let productname: string | undefined;
  try {
    const probe = await cameraFetchDirect('/ccapi/ver100/deviceinformation', {
      signal: AbortSignal.timeout(6_000),
    }, baseUrl);
    if (probe.ok) {
      const data = await probe.json() as Record<string, unknown>;
      // Must have a productname field — generic HTTP servers won't have this
      isCamera = typeof data.productname === 'string' && data.productname.length > 0;
      if (isCamera) productname = data.productname as string;
    }
    probe.body?.cancel().catch(() => {});
  } catch (e) {
    log.warn({ err: e, ip, port }, 'Camera probe failed');
  }

  if (!isCamera) {
    log.warn({ ip, port }, 'Camera probe: no Canon camera found');
    return json(
      { error: 'No Canon camera found at that address. Check the IP address and try again.' },
      { status: 422 }
    );
  }

  log.info({ ip, port, productname }, 'Camera verified — applying config');
  setCameraConfig(ip, port ?? 8080, https ?? false);
  // Reconnect with new settings — all SSE clients will receive new status events
  startMonitor();
  return json(getCameraConfig());
};
