/**
 * hooks.server.ts — SvelteKit server hooks
 *
 * Starts the camera monitor loop once when the server process starts.
 * The monitor runs independently of any browser clients.
 */

import { startMonitor, getStatus } from '$lib/server/monitor';

// Start monitoring on server boot.
// Guard against HMR re-execution: only start if not already running.
const { status } = getStatus();
if (status === 'stopped') {
  startMonitor();
}

export const handle = async ({ event, resolve }) => resolve(event);
