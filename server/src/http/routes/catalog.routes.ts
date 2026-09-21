import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createCatalogController } from '../controllers/catalog.controller.js';
import { idParam, listAlbumsQuery, listArtistsQuery, listSongsQuery, recordPlayBody, searchQuery } from '../schemas.js';

export const createCatalogRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createCatalogController(ctx);
  const { requireAuth } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);

  router.get('/discover', limiters.read, asyncHandler(controller.discover));
  router.get('/search', limiters.read, validate({ query: searchQuery }), asyncHandler(controller.search));

  router.get('/songs', limiters.read, validate({ query: listSongsQuery }), asyncHandler(controller.listSongs));
  router.get('/songs/:id', limiters.read, validate({ params: idParam }), asyncHandler(controller.getSong));
  router.post(
    '/songs/:id/play',
    requireAuth,
    limiters.write,
    validate({ params: idParam, body: recordPlayBody }),
    asyncHandler(controller.recordPlay),
  );

  router.get('/artists', limiters.read, validate({ query: listArtistsQuery }), asyncHandler(controller.listArtists));
  router.get('/artists/:id', limiters.read, validate({ params: idParam }), asyncHandler(controller.getArtist));

  router.get('/albums', limiters.read, validate({ query: listAlbumsQuery }), asyncHandler(controller.listAlbums));
  router.get('/albums/:id', limiters.read, validate({ params: idParam }), asyncHandler(controller.getAlbum));

  return router;
};
