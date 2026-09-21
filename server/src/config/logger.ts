import pino, { type Logger } from 'pino';
import type { Env } from './env.js';

/**
 * Structured JSON logging. Request-scoped fields (requestId, userId, method,
 * path, status) are attached by the pino-http middleware; secrets are redacted
 * defensively so an accidental `logger.info(req.body)` cannot leak a token.
 */
export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'cadenza-api', env: env.NODE_ENV, version: env.serviceVersion },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'password',
        'token',
        '*.token',
        '*.password',
        '*.secret',
      ],
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

export type { Logger };
