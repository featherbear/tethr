import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { cameraFetch } from '$lib/server/camera';

export const GET: RequestHandler = async ({ url }) => {
  const path = url.searchParams.get('path') ?? '/ccapi/ver120/contents/card1';

  try {
    const res = await cameraFetch(path, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) error(res.status, `Camera responded with ${res.status}`);
    const data = await res.json();
    return json(data);
  } catch (e) {
    error(502, `Could not reach camera: ${e}`);
  }
};
