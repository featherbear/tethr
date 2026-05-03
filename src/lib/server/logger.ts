/**
 * logger.ts — server-side pino logger
 *
 * Emits newline-delimited JSON to stdout in all environments.
 * Log level is controlled via LOG_LEVEL env var (default: debug in dev, info in prod).
 *
 * Usage:
 *   import { logger, childLogger } from '$lib/server/logger';
 *   const log = childLogger('mymodule');
 *   log.info({ key: 'val' }, 'Something happened');
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Create a child logger bound to a specific module name. */
export function childLogger(module: string) {
  return logger.child({ module });
}
