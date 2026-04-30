/**
 * /api/camera — Camera configuration
 *
 * GET  — return current camera config
 * POST — update camera config and reconnect
 */

import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getCameraConfig, setCameraConfig } from '$lib/server/camera';
import { startMonitor } from '$lib/server/monitor';

export const GET: RequestHandler = () => {
  return json(getCameraConfig());
};

export const POST: RequestHandler = async ({ request }) => {
  const { ip, port, https } = await request.json();
  setCameraConfig(ip, port ?? 8080, https ?? false);
  // Reconnect with new settings — all SSE clients will receive new status events
  startMonitor();
  return json(getCameraConfig());
};
