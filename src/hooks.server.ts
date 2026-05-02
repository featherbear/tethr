/**
 * hooks.server.ts — SvelteKit server hooks
 *
 * Starts the camera monitor loop once when the server process starts.
 * The monitor runs independently of any browser clients.
 */

import { logger } from '$lib/server/logger';

logger.info({ node: process.version }, 'Tethr server starting');

// Monitor is started lazily on first SSE client connection (/api/events),
// not on boot — this avoids a race where the monitor floods the serial queue
// before the frontend has finished its initial requests (device info, state).

export const handle = async ({ event, resolve }) => {
  const start = Date.now();
  const response = await resolve(event);
  const ms = Date.now() - start;
  // Only log API routes — static assets are noise
  if (event.url.pathname.startsWith('/api/')) {
    logger.debug(
      { method: event.request.method, path: event.url.pathname, status: response.status, ms },
      'API request'
    );
  }
  return response;
};
