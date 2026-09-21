import type { Request, Response } from 'express';
import type { AppContext } from '../../context.js';
import { body, query } from '../middleware/validate.js';
import type {
  ListAlbumsQuery,
  ListArtistsQuery,
  ListSongsQuery,
  RecordPlayBody,
  SearchQuery,
} from '../schemas.js';

export const createCatalogController = (ctx: AppContext) => ({
  async listSongs(req: Request, res: Response): Promise<void> {
    const q = query<ListSongsQuery>(req);
    res.json(await ctx.services.catalog.listSongs(q));
  },

  async getSong(req: Request, res: Response): Promise<void> {
    const songId = req.params.id ?? '';
    res.json({ song: await ctx.services.catalog.getSong(songId) });
  },

  async listArtists(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.catalog.listArtists(query<ListArtistsQuery>(req)));
  },

  async getArtist(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.catalog.getArtist(req.params.id ?? ''));
  },

  async listAlbums(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.catalog.listAlbums(query<ListAlbumsQuery>(req)));
  },

  async getAlbum(req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.catalog.getAlbum(req.params.id ?? ''));
  },

  async search(req: Request, res: Response): Promise<void> {
    const q = query<SearchQuery>(req);
    res.json(await ctx.services.catalog.search(q.q, q.limit));
  },

  async discover(_req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.catalog.discover());
  },

  async recordPlay(req: Request, res: Response): Promise<void> {
    const input = body<RecordPlayBody>(req);
    const songId = req.params.id ?? '';
    const result = await ctx.services.catalog.recordPlay({
      songId,
      userId: req.auth?.user.id ?? null,
      roomId: input.roomId ?? null,
      source: input.source,
    });
    res.status(201).json({ songId, ...result });
  },
});
