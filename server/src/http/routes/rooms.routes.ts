import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context.js';
import { asyncHandler } from '../asyncHandler.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createRateLimiters } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { createRoomController } from '../controllers/room.controller.js';
import { createRoomBody, idParam, listRoomsQuery, messagesQuery, objectId, queueMutationBody } from '../schemas.js';

const roomSongParam = z.object({ id: objectId, songId: objectId });

export const createRoomRouter = (ctx: AppContext): Router => {
  const router = Router();
  const controller = createRoomController(ctx);
  const { requireAuth, optionalAuth } = createAuthMiddleware(ctx);
  const limiters = createRateLimiters(ctx.env);

  router.get('/rooms', optionalAuth, limiters.read, validate({ query: listRoomsQuery }), asyncHandler(controller.list));
  router.post('/rooms', requireAuth, limiters.write, validate({ body: createRoomBody }), asyncHandler(controller.create));
  router.get('/rooms/:id', requireAuth, limiters.read, validate({ params: idParam }), asyncHandler(controller.get));
  router.post('/rooms/:id/join', requireAuth, limiters.write, validate({ params: idParam }), asyncHandler(controller.join));
  router.post('/rooms/:id/leave', requireAuth, limiters.write, validate({ params: idParam }), asyncHandler(controller.leave));
  router.post(
    '/rooms/:id/queue',
    requireAuth,
    limiters.write,
    validate({ params: idParam, body: queueMutationBody }),
    asyncHandler(controller.addToQueue),
  );
  router.delete(
    '/rooms/:id/queue/:songId',
    requireAuth,
    limiters.write,
    validate({ params: roomSongParam, body: queueMutationBody }),
    asyncHandler(controller.removeFromQueue),
  );
  router.get(
    '/rooms/:id/messages',
    requireAuth,
    limiters.read,
    validate({ params: idParam, query: messagesQuery }),
    asyncHandler(controller.messages),
  );

  return router;
};
