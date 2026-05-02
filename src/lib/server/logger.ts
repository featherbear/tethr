/**
 * logger.ts — server-side pino logger
 *
 * In development:  pretty-prints via pino-pretty (human-readable, coloured)
 * In production:   JSON lines to stdout (structured, ready for log aggregators)
 *
 * Log level is controlled via LOG_LEVEL env var (default: debug in dev, info in prod).
 *
 * Usage:
 *   import { logger, childLogger } from '$lib/server/logger';
 *   const log = childLogger('mymodule');
 *   log.info({ key: 'val' }, 'Something happened');
 */

import pino from 'pino';

const isDev  = process.env.NODE_ENV !== 'production';
const level  = process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

export const logger = pino(
  {
    level,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          messageFormat: '{module} › {msg}',
        },
      })
    : undefined
);

/** Create a child logger bound to a specific module name. */
export function childLogger(module: string) {
  return logger.child({ module });
}
