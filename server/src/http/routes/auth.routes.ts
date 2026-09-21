import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { demoSessionBody } from '../schemas.js';

export const createAuthRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createAuthController(ctx);
  const { requireAuth } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);

  router.post('/auth/demo-session', limiters.auth, validate({ body: demoSessionBody }), asyncHandler(controller.demoSession));
  router.get('/auth/me', requireAuth, asyncHandler(controller.me));
  // Clerk's webhook endpoint: signature verified before any write happens.
  router.post('/webhooks/clerk', limiters.auth, asyncHandler(controller.clerkWebhook));

  return router;
};
