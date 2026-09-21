import type { Types } from 'mongoose';
import { Song, type SongDocument } from '../models/index.js';
import { paginate, skipFor, type Paginated } from './pagination.js';
import { escapeRegex } from './artist.repository.js';

export type SongLean = SongDocument & { _id: Types.ObjectId };

export type SongSort = 'title' | '-playCount' | 'albumOrder' | '-createdAt';

export interface SongListQuery {
  search?: string | undefined;
  albumId?: string | undefined;
  artistId?: string | undefined;
  page: number;
  limit: number;
  sort: SongSort;
}

const SORT_SPEC: Record<SongSort, Record<string, 1 | -1>> = {
  title: { title: 1 },
  '-playCount': { playCount: -1, title: 1 },
  albumOrder: { albumId: 1, trackNumber: 1 },
  '-createdAt': { createdAt: -1 },
};

export const songRepository = {
  async list(query: SongListQuery): Promise<Paginated<SongLean>> {
    const filter: Record<string, unknown> = {};
    if (query.search) filter.title = { $regex: escapeRegex(query.search), $options: 'i' };
    if (query.albumId) filter.albumId = query.albumId;
    if (query.artistId) filter.artistId = query.artistId;
    const [items, total] = await Promise.all([
      Song.find(filter)
        .sort(SORT_SPEC[query.sort])
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<SongLean[]>(),
      Song.countDocuments(filter),
    ]);
    return paginate(items, total, query.page, query.limit);
  },

  /** Ranked full-text search against the `song_text` index (title + genres). */
  async search(text: string, limit: number): Promise<SongLean[]> {
    return Song.find({ $text: { $search: text } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean<SongLean[]>();
  },

  async findById(id: string | Types.ObjectId): Promise<SongLean | null> {
    return Song.findById(id).lean<SongLean>();
  },

  async findByIds(ids: (string | Types.ObjectId)[]): Promise<SongLean[]> {
    if (ids.length === 0) return [];
    return Song.find({ _id: { $in: ids } }).lean<SongLean[]>();
  },

  async listByAlbum(albumId: string | Types.ObjectId): Promise<SongLean[]> {
    return Song.find({ albumId }).sort({ trackNumber: 1 }).lean<SongLean[]>();
  },

  async topByPlayCount(limit: number): Promise<SongLean[]> {
    return Song.find({ playCount: { $gt: 0 } }).sort({ playCount: -1 }).limit(limit).lean<SongLean[]>();
  },

  async incrementPlayCount(id: string | Types.ObjectId, delta = 1): Promise<void> {
    await Song.updateOne({ _id: id }, { $inc: { playCount: delta } });
  },

  async count(): Promise<number> {
    return Song.countDocuments({});
  },
};
