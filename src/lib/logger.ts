/**
 * logger.ts — frontend browser logger
 *
 * Thin wrapper around pino's browser build.
 * Logs go to the browser console.  In production builds the level is raised
 * to 'warn' so debug/info noise is suppressed in the shipped app.
 *
 * Usage:
 *   import { log } from '$lib/logger';
 *   log.info({ photoId: id }, 'Thumbnail loaded');
 */

import pino from 'pino';

const isDev = import.meta.env.DEV;

export const log = pino({
  browser: { asObject: false },
  level: isDev ? 'debug' : 'warn',
  base: undefined,
  timestamp: false,
});

/** Create a child logger bound to a module label. */
export function childLog(module: string) {
  return log.child({ module });
}
