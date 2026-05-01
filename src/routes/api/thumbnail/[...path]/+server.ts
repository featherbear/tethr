import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { cameraFetch } from '$lib/server/camera';

export const GET: RequestHandler = async ({ params }) => {
  // params.path is e.g. "card1/100EOSR6/4E5A7113.CR3" — prepend the CCAPI contents prefix
  const camPath = `/ccapi/ver120/contents/${params.path}`;

  try {
    const res = await cameraFetch(`${camPath}?kind=thumbnail`, {
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
