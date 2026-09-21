import type { Request, Response } from 'express';
import { AppError } from '../../errors.js';
import type { AppContext } from '../../context.js';
import { body, query } from '../middleware/validate.js';
import type {
  AddPlaylistSongBody,
  CreatePlaylistBody,
  ListPlaylistsQuery,
  ReorderPlaylistBody,
  UpdatePlaylistBody,
} from '../schemas.js';

const requireUser = (req: Request) => {
  const user = req.auth?.user;
  if (!user) throw AppError.unauthenticated();
  return user;
};

export const createPlaylistController = (ctx: AppContext) => ({
  async list(req: Request, res: Response): Promise<void> {
    const q = query<ListPlaylistsQuery>(req);
    res.json(await ctx.services.playlists.list(q, req.auth?.user ?? null));
  },

  async get(req: Request, res: Response): Promise<void> {
    res.json({ playlist: await ctx.services.playlists.get(req.params.id ?? '', req.auth?.user ?? null) });
  },

  async create(req: Request, res: Response): Promise<void> {
    const playlist = await ctx.services.playlists.create(requireUser(req), body<CreatePlaylistBody>(req));
    res.status(201).json({ playlist });
  },

  async update(req: Request, res: Response): Promise<void> {
    const playlist = await ctx.services.playlists.update(
      req.params.id ?? '',
      requireUser(req),
      body<UpdatePlaylistBody>(req),
    );
    res.json({ playlist });
  },

  async remove(req: Request, res: Response): Promise<void> {
    await ctx.services.playlists.remove(req.params.id ?? '', requireUser(req));
    res.status(204).send();
  },

  async addSong(req: Request, res: Response): Promise<void> {
    const playlist = await ctx.services.playlists.addSong(
      req.params.id ?? '',
      requireUser(req),
      body<AddPlaylistSongBody>(req),
    );
    res.status(201).json({ playlist });
  },

  async removeSong(req: Request, res: Response): Promise<void> {
    const playlist = await ctx.services.playlists.removeSong(
      req.params.id ?? '',
      requireUser(req),
      req.params.songId ?? '',
    );
    res.json({ playlist });
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const playlist = await ctx.services.playlists.reorder(
      req.params.id ?? '',
      requireUser(req),
      body<ReorderPlaylistBody>(req).songIds,
    );
    res.json({ playlist });
  },
});
