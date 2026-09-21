import { Router } from 'express';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createPlaylistController } from '../controllers/playlist.controller.js';
import {
  addPlaylistSongBody,
  createPlaylistBody,
  idParam,
  listPlaylistsQuery,
  objectId,
  reorderPlaylistBody,
  updatePlaylistBody,
} from '../schemas.js';
import { z } from 'zod';

const playlistSongParam = z.object({ id: objectId, songId: objectId });

export const createPlaylistRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createPlaylistController(ctx);
  const { requireAuth, optionalAuth } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);

  router.get('/playlists', optionalAuth, limiters.read, validate({ query: listPlaylistsQuery }), asyncHandler(controller.list));
  router.post('/playlists', requireAuth, limiters.write, validate({ body: createPlaylistBody }), asyncHandler(controller.create));
  router.get('/playlists/:id', optionalAuth, limiters.read, validate({ params: idParam }), asyncHandler(controller.get));
  router.patch('/playlists/:id', requireAuth, limiters.write, validate({ params: idParam, body: updatePlaylistBody }), asyncHandler(controller.update));
  router.delete('/playlists/:id', requireAuth, limiters.write, validate({ params: idParam }), asyncHandler(controller.remove));

  router.post(
    '/playlists/:id/songs',
    requireAuth,
    limiters.write,
    validate({ params: idParam, body: addPlaylistSongBody }),
    asyncHandler(controller.addSong),
  );
  router.delete(
    '/playlists/:id/songs/:songId',
    requireAuth,
    limiters.write,
    validate({ params: playlistSongParam }),
    asyncHandler(controller.removeSong),
  );
  router.put(
    '/playlists/:id/order',
    requireAuth,
    limiters.write,
    validate({ params: idParam, body: reorderPlaylistBody }),
    asyncHandler(controller.reorder),
  );

  return router;
};
