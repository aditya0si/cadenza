import { Types } from 'mongoose';
import { Playlist, type PlaylistDocument } from '../models/index.js';
import { paginate, skipFor, type Paginated } from './pagination.js';
import { escapeRegex } from './artist.repository.js';

export type PlaylistLean = PlaylistDocument & { _id: Types.ObjectId };

export interface PlaylistListQuery {
  ownerId?: string | undefined;
  visibility?: 'private' | 'public' | undefined;
  /** `$or: [{ ownerId }, { visibility: 'public' }]` — "everything I can see". */
  ownedByOrPublic?: string | undefined;
  search?: string | undefined;
  page: number;
  limit: number;
}

export const playlistRepository = {
  async list(query: PlaylistListQuery): Promise<Paginated<PlaylistLean>> {
    const filter: Record<string, unknown> = {};
    if (query.ownedByOrPublic) {
      filter.$or = [{ ownerId: query.ownedByOrPublic }, { visibility: 'public' }];
    } else {
      if (query.ownerId) filter.ownerId = query.ownerId;
      if (query.visibility) filter.visibility = query.visibility;
    }
    if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: 'i' };
    const [items, total] = await Promise.all([
      Playlist.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<PlaylistLean[]>(),
      Playlist.countDocuments(filter),
    ]);
    return paginate(items, total, query.page, query.limit);
  },

  async findById(id: string | Types.ObjectId): Promise<PlaylistLean | null> {
    return Playlist.findById(id).lean<PlaylistLean>();
  },

  async create(input: {
    name: string;
    description: string;
    ownerId: string | Types.ObjectId;
    visibility: 'private' | 'public';
  }): Promise<PlaylistLean> {
    const created = await Playlist.create({ ...input, songs: [] });
    return created.toObject<PlaylistLean>();
  },

  async update(
    id: string | Types.ObjectId,
    patch: { name?: string; description?: string; visibility?: 'private' | 'public' },
  ): Promise<PlaylistLean | null> {
    return Playlist.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean<PlaylistLean>();
  },

  async deleteById(id: string | Types.ObjectId): Promise<boolean> {
    const result = await Playlist.deleteOne({ _id: id });
    return result.deletedCount === 1;
  },

  async addSong(
    id: string | Types.ObjectId,
    entry: { songId: Types.ObjectId; addedBy: Types.ObjectId | null; position?: number },
  ): Promise<PlaylistLean | null> {
    const push: Record<string, unknown> = {
      songId: entry.songId,
      addedAt: new Date(),
      addedBy: entry.addedBy,
    };
    const update =
      entry.position === undefined
        ? { $push: { songs: push } }
        : { $push: { songs: { $each: [push], $position: entry.position } } };
    return Playlist.findByIdAndUpdate(id, update, { new: true }).lean<PlaylistLean>();
  },

  async removeSong(id: string | Types.ObjectId, songId: Types.ObjectId): Promise<PlaylistLean | null> {
    return Playlist.findByIdAndUpdate(id, { $pull: { songs: { songId } } }, { new: true }).lean<PlaylistLean>();
  },

  /** Full replacement of the track order — the drag-to-reorder endpoint. */
  async reorder(
    id: string | Types.ObjectId,
    songs: { songId: Types.ObjectId; addedAt: Date; addedBy: Types.ObjectId | null }[],
  ): Promise<PlaylistLean | null> {
    return Playlist.findByIdAndUpdate(id, { $set: { songs } }, { new: true }).lean<PlaylistLean>();
  },

  async count(): Promise<number> {
    return Playlist.countDocuments({});
  },

  async countByOwner(ownerId: string | Types.ObjectId): Promise<number> {
    return Playlist.countDocuments({ ownerId });
  },
};
