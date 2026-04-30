import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getCameraBaseUrl, getCameraConfig, setCameraConfig } from '$lib/server/camera';

export const GET: RequestHandler = () => {
  return json({ url: getCameraBaseUrl(), ...getCameraConfig() });
};

export const POST: RequestHandler = async ({ request }) => {
  const { ip, port, https } = await request.json();
  const url = setCameraConfig(ip, port ?? 8080, https ?? false);
  return json({ url, ip, port: port ?? 8080, https: https ?? false });
};
