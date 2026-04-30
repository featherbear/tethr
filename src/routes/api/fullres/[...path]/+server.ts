import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { cameraFetch } from '$lib/server/camera';

export const GET: RequestHandler = async ({ params }) => {
  const camPath = `/${params.path}`;

  try {
    const res = await cameraFetch(`${camPath}?kind=original`, {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) error(res.status, `Camera responded with ${res.status}`);

    // Stream the response body directly — full-res can be large
    return new Response(res.body, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
        'Content-Length': res.headers.get('Content-Length') ?? '',
      },
    });
  } catch (e) {
    error(502, `Could not fetch full-res image: ${e}`);
  }
};
