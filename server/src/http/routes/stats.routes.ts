import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createHealthController, createStatsController } from '../controllers/stats.controller.js';
import { statsActiveRoomsQuery, statsPlaysQuery, statsTopTracksQuery } from '../schemas.js';

export const createStatsRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createStatsController(ctx);
  const { requireAuth, requireRole } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);
  const adminOnly = [requireAuth, requireRole('admin')];

  router.get('/stats/overview', ...adminOnly, limiters.read, asyncHandler(controller.overview));
  router.get('/stats/plays', ...adminOnly, limiters.read, validate({ query: statsPlaysQuery }), asyncHandler(controller.plays));
  router.get('/stats/top-tracks', ...adminOnly, limiters.read, validate({ query: statsTopTracksQuery }), asyncHandler(controller.topTracks));
  router.get('/stats/active-rooms', ...adminOnly, limiters.read, validate({ query: statsActiveRoomsQuery }), asyncHandler(controller.activeRooms));

  return router;
};

export const createHealthRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createHealthController(ctx);
  router.get('/health', asyncHandler(controller.live));
  router.get('/health/ready', asyncHandler(controller.ready));
  return router;
};
