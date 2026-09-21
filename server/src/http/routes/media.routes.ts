import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createMediaController } from '../controllers/media.controller.js';
import { coverParams, idParam, streamQuery } from '../schemas.js';

export const createMediaRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createMediaController(ctx);
  const { requireAuth } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);

  // Signed-URL issuance needs a session; the stream endpoint itself is
  // authorized by the signature it carries.
  router.get('/songs/:id/stream-url', requireAuth, limiters.write, validate({ params: idParam }), asyncHandler(controller.issueStreamUrl));
  router.get('/media/stream/:id', validate({ params: idParam, query: streamQuery }), asyncHandler(controller.stream));
  router.get('/media/cover/:kind/:id', limiters.read, validate({ params: coverParams }), asyncHandler(controller.cover));

  return router;
};
