import type { Request, Response } from 'express';
import { AppError } from '../../errors.js';
import type { AppContext } from '../../context.js';
import { body, query } from '../middleware/validate.js';
import type { CreateRoomBody, ListRoomsQuery, MessagesQuery, QueueMutationBody } from '../schemas.js';

const requireUser = (req: Request) => {
  const user = req.auth?.user;
  if (!user) throw AppError.unauthenticated();
  return user;
};

export const createRoomController = (ctx: AppContext) => ({
  async list(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.rooms.list(query<ListRoomsQuery>(req)));
  },

  async get(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.rooms.snapshot(req.params.id ?? '', requireUser(req)));
  },

  async create(req: Request, res: Response): Promise<void> {
    const room = await ctx.services.rooms.create(requireUser(req), body<CreateRoomBody>(req));
    res.status(201).json({ room });
  },

  async join(req: Request, res: Response): Promise<void> {
    const room = await ctx.services.rooms.join(req.params.id ?? '', requireUser(req));
    res.json({ room });
  },

  async leave(req: Request, res: Response): Promise<void> {
    const result = await ctx.services.rooms.leave(req.params.id ?? '', requireUser(req));
    res.json(result);
  },

  /** REST path for the queue so the feature is usable without a socket. */
  async addToQueue(req: Request, res: Response): Promise<void> {
    const result = await ctx.services.rooms.addToQueue(
      req.params.id ?? '',
      requireUser(req),
      body<QueueMutationBody>(req),
    );
    res.status(result.duplicate ? 200 : 201).json(result);
  },

  async removeFromQueue(req: Request, res: Response): Promise<void> {
    const input = body<QueueMutationBody>(req);
    const result = await ctx.services.rooms.removeFromQueue(req.params.id ?? '', requireUser(req), {
      songId: req.params.songId ?? input.songId,
      eventId: input.eventId,
    });
    res.json(result);
  },

  async messages(req: Request, res: Response): Promise<void> {
    const q = query<MessagesQuery>(req);
    const page = await ctx.services.rooms.history(req.params.id ?? '', requireUser(req), {
      // Already validated and decoded by `messagesQuery`; an unparseable cursor
      // is answered with 400 before it ever reaches the service.
      before: q.before,
      limit: q.limit,
    });
    res.json(page);
  },
});
