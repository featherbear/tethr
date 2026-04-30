import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { getCameraBaseUrl } from '$lib/server/camera';

export const GET: RequestHandler = async ({ url }) => {
  const base = getCameraBaseUrl();
  const path = url.searchParams.get('path') ?? '/ccapi/ver100/contents/storage1/card1';

  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) error(res.status, `Camera responded with ${res.status}`);
    const data = await res.json();
    return json(data);
  } catch (e) {
    error(502, `Could not reach camera: ${e}`);
  }
};
