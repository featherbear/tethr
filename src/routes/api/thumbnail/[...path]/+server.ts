import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getCameraBaseUrl } from '$lib/server/camera';

export const GET: RequestHandler = async ({ params }) => {
  const base = getCameraBaseUrl();
  const camPath = `/${params.path}`;

  try {
    const res = await fetch(`${base}${camPath}?kind=thumbnail`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) error(res.status, `Camera responded with ${res.status}`);

    const buffer = await res.arrayBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  } catch (e) {
    error(502, `Could not fetch thumbnail: ${e}`);
  }
};
