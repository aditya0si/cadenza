import type { Types } from 'mongoose';
import { Album, type AlbumDocument } from '../models/index.js';
import { paginate, skipFor, type Paginated } from './pagination.js';
import { escapeRegex } from './artist.repository.js';

export type AlbumLean = AlbumDocument & { _id: Types.ObjectId };

export interface AlbumListQuery {
  search?: string | undefined;
  artistId?: string | undefined;
  page: number;
  limit: number;
}

export const albumRepository = {
  async list(query: AlbumListQuery): Promise<Paginated<AlbumLean>> {
    const filter: Record<string, unknown> = {};
    if (query.search) filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    if (query.artistId) filter.artistId = query.artistId;
    const [items, total] = await Promise.all([
      Album.find(filter)
        .sort({ releaseYear: -1, title: 1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<AlbumLean[]>(),
      Album.countDocuments(filter),
    ]);
    return paginate(items, total, query.page, query.limit);
  },

  async search(text: string, limit: number): Promise<AlbumLean[]> {
    return Album.find({ $text: { $search: text } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean<AlbumLean[]>();
  },

  async findById(id: string | Types.ObjectId): Promise<AlbumLean | null> {
    return Album.findById(id).lean<AlbumLean>();
  },

  async findByIds(ids: (string | Types.ObjectId)[]): Promise<AlbumLean[]> {
    if (ids.length === 0) return [];
    return Album.find({ _id: { $in: ids } }).lean<AlbumLean[]>();
  },

  async findByArtist(artistId: string | Types.ObjectId): Promise<AlbumLean[]> {
    return Album.find({ artistId }).sort({ releaseYear: -1 }).lean<AlbumLean[]>();
  },

  /** Albums that actually have at least one play, for the Discover "featured" rail. */
  async featured(limit: number): Promise<AlbumLean[]> {
    return Album.find({ songCount: { $gt: 0 } }).sort({ createdAt: 1 }).limit(limit).lean<AlbumLean[]>();
  },

  async count(): Promise<number> {
    return Album.countDocuments({});
  },
};
