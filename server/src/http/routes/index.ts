import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { createAuthRouter } from './auth.routes.js';
import { createCatalogRouter } from './catalog.routes.js';
import { createMediaRouter } from './media.routes.js';
import { createPlaylistRouter } from './playlists.routes.js';
import { createRoomRouter } from './rooms.routes.js';
import { createHealthRouter, createStatsRouter } from './stats.routes.js';

/** Everything under /api. Routers stay thin: validate → controller → service. */
export const createApiRouter = (ctx: AppContext): Router => {
  const router = Router();
  router.use(createHealthRouter(ctx));
  router.use(createAuthRouter(ctx));
  router.use(createCatalogRouter(ctx));
  router.use(createMediaRouter(ctx));
  router.use(createPlaylistRouter(ctx));
  router.use(createRoomRouter(ctx));
  router.use(createStatsRouter(ctx));
  return router;
};
