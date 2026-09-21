import type { Types } from 'mongoose';
import { Artist, type ArtistDocument } from '../models/index.js';
import { paginate, skipFor, type Paginated } from './pagination.js';

export type ArtistLean = ArtistDocument & { _id: Types.ObjectId };

export interface ArtistListQuery {
  search?: string | undefined;
  page: number;
  limit: number;
}

export const artistRepository = {
  async list(query: ArtistListQuery): Promise<Paginated<ArtistLean>> {
    const filter = query.search ? { name: { $regex: escapeRegex(query.search), $options: 'i' } } : {};
    const [items, total] = await Promise.all([
      Artist.find(filter)
        .sort({ name: 1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<ArtistLean[]>(),
      Artist.countDocuments(filter),
    ]);
    return paginate(items, total, query.page, query.limit);
  },

  /** Ranked full-text search against the `artist_text` index. */
  async search(text: string, limit: number): Promise<ArtistLean[]> {
    return Artist.find({ $text: { $search: text } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(limit)
      .lean<ArtistLean[]>();
  },

  async findById(id: string | Types.ObjectId): Promise<ArtistLean | null> {
    return Artist.findById(id).lean<ArtistLean>();
  },

  async findByIds(ids: (string | Types.ObjectId)[]): Promise<ArtistLean[]> {
    if (ids.length === 0) return [];
    return Artist.find({ _id: { $in: ids } }).lean<ArtistLean[]>();
  },

  async incrementMonthlyListeners(id: string | Types.ObjectId, delta = 1): Promise<void> {
    await Artist.updateOne({ _id: id }, { $inc: { monthlyListeners: delta } });
  },

  async count(): Promise<number> {
    return Artist.countDocuments({});
  },
};

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
