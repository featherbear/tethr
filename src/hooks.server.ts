/**
 * hooks.server.ts — SvelteKit server hooks
 *
 * Starts the camera monitor loop once when the server process starts.
 * The monitor runs independently of any browser clients.
 */

import { startMonitor } from '$lib/server/monitor';

// Start monitoring immediately on server boot
startMonitor();

export const handle = async ({ event, resolve }) => resolve(event);
