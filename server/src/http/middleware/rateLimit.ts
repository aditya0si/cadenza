import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { AppError } from '../../errors.js';
import type { Env } from '../../config/env.js';

const MINUTE = 60 * 1000;

/**
 * Three buckets: auth (tight), writes (moderate), reads (generous). Keys are
 * per-IP by default; `RATE_LIMIT_DISABLED=true` turns the buckets off for the
 * e2e smoke script, which hammers the API from one address on purpose.
 */
const bucket = (env: Env, name: string, windowMs: number, max: number): RequestHandler =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.RATE_LIMIT_DISABLED,
    handler: (_req, _res, next) => {
      next(new AppError('RATE_LIMITED', `Rate limit reached for ${name} requests (${max} per ${windowMs / 1000}s)`));
    },
  });

export const createRateLimiters = (env: Env) => ({
  auth: bucket(env, 'auth', MINUTE, env.RATE_LIMIT_AUTH_MAX),
  write: bucket(env, 'write', MINUTE, env.RATE_LIMIT_WRITE_MAX),
  read: bucket(env, 'read', MINUTE, env.RATE_LIMIT_READ_MAX),
});
