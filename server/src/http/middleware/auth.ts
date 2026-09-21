import type { RequestHandler } from 'express';
import { AppError } from '../../errors.js';
import type { AppContext } from '../../context.js';
import type { AuthenticatedUser, Role } from '../../auth/types.js';

const BEARER = /^Bearer\s+(.+)$/i;

export const extractBearerToken = (req: { header(name: string): string | undefined }): string | null => {
  const header = req.header('authorization');
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  return match?.[1]?.trim() ?? null;
};

/**
 * Verifies the session token with the injected identity verifier (Clerk in
 * production, the demo-session verifier when AUTH_MODE=demo) and materialises
 * the local user row. Nothing downstream ever sees an unverified identity.
 */
export const createAuthMiddleware = (ctx: AppContext) => {
  const authenticate: RequestHandler = async (req, _res, next) => {
    try {
      const token = extractBearerToken(req);
      if (!token) throw AppError.unauthenticated('Missing bearer token');
      const identity = await ctx.identity.verify(token);
      const user = await ctx.services.users.ensureUser(identity);
      req.auth = { user };
      next();
    } catch (error) {
      next(error);
    }
  };

  const requireAuth: RequestHandler = (req, res, next) => {
    void authenticate(req, res, (error?: unknown) => {
      if (error) next(error);
      else next();
    });
  };

  const optionalAuth: RequestHandler = (req, res, next) => {
    const token = extractBearerToken(req);
    if (!token) {
      next();
      return;
    }
    void authenticate(req, res, (error?: unknown) => {
      if (error) {
        // An invalid token on an optional route is still a rejection: silently
        // downgrading to anonymous would hide auth bugs.
        next(error);
        return;
      }
      next();
    });
  };

  const requireRole = (...roles: Role[]): RequestHandler => (req, _res, next) => {
    const user: AuthenticatedUser | undefined = req.auth?.user;
    if (!user) {
      next(AppError.unauthenticated());
      return;
    }
    if (!roles.some((role) => user.roles.includes(role))) {
      next(AppError.forbidden(`This endpoint requires the ${roles.join(' or ')} role`));
      return;
    }
    next();
  };

  return { requireAuth, optionalAuth, requireRole };
};
