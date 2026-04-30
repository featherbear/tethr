import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getCameraBaseUrl, setCameraBaseUrl } from '$lib/server/camera';

export const GET: RequestHandler = () => {
  return json({ url: getCameraBaseUrl() });
};

export const POST: RequestHandler = async ({ request }) => {
  const { ip, port } = await request.json();
  const url = setCameraBaseUrl(ip, port ?? 8080);
  return json({ url });
};
