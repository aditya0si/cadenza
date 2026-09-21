import { Types } from 'mongoose';
import { Room, type RoomDocument } from '../models/index.js';
import { paginate, skipFor, type Paginated } from './pagination.js';

export type RoomLean = RoomDocument & { _id: Types.ObjectId };

export interface RoomListQuery {
  visibility?: 'private' | 'public' | undefined;
  activeSince?: Date | undefined;
  page: number;
  limit: number;
}

const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

export const roomRepository = {
  async list(query: RoomListQuery): Promise<Paginated<RoomLean>> {
    const filter: Record<string, unknown> = {};
    if (query.visibility) filter.visibility = query.visibility;
    if (query.activeSince) filter.lastActivityAt = { $gte: query.activeSince };
    const [items, total] = await Promise.all([
      Room.find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skipFor(query.page, query.limit))
        .limit(query.limit)
        .lean<RoomLean[]>(),
      Room.countDocuments(filter),
    ]);
    return paginate(items, total, query.page, query.limit);
  },

  async findById(id: string | Types.ObjectId): Promise<RoomLean | null> {
    return Room.findById(id).lean<RoomLean>();
  },

  async findBySlug(slug: string): Promise<RoomLean | null> {
    return Room.find({ slug }).limit(1).lean<RoomLean[]>().then((rows) => rows[0] ?? null);
  },

  async create(input: {
    name: string;
    slug: string;
    hostId: Types.ObjectId;
    visibility: 'private' | 'public';
  }): Promise<RoomLean> {
    const created = await Room.create({
      name: input.name,
      slug: input.slug,
      hostId: input.hostId,
      visibility: input.visibility,
      members: [{ userId: input.hostId, role: 'host', joinedAt: new Date(), lastSeenAt: new Date() }],
      queue: [],
      playback: { trackId: null, isPlaying: false, positionMs: 0, serverTs: new Date(), updatedBy: null },
      lastActivityAt: new Date(),
      processedEventIds: [],
    });
    return created.toObject<RoomLean>();
  },

  async isMember(id: string | Types.ObjectId, userId: string | Types.ObjectId): Promise<boolean> {
    const found = await Room.exists({ _id: id, 'members.userId': userId });
    return found !== null;
  },

  async addMember(
    id: string | Types.ObjectId,
    userId: Types.ObjectId,
    role: 'host' | 'member' = 'member',
  ): Promise<RoomLean | null> {
    // $ne guard makes joining twice a no-op instead of a duplicate member row.
    return Room.findOneAndUpdate(
      { _id: id, 'members.userId': { $ne: userId } },
      { $push: { members: { userId, role, joinedAt: new Date(), lastSeenAt: new Date() } }, $set: { lastActivityAt: new Date() } },
      { new: true },
    ).lean<RoomLean>();
  },

  async removeMember(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<RoomLean | null> {
    return Room.findByIdAndUpdate(
      id,
      { $pull: { members: { userId } }, $set: { lastActivityAt: new Date() } },
      { new: true },
    ).lean<RoomLean>();
  },

  async touchMember(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    await Room.updateOne(
      { _id: id, 'members.userId': userId },
      { $set: { 'members.$.lastSeenAt': new Date(), lastActivityAt: new Date() } },
    );
  },

  /**
   * Hands the room over: the new host is written to `hostId` and their member row
   * is upgraded in the same atomic update.
   */
  async transferHost(id: string | Types.ObjectId, userId: Types.ObjectId): Promise<RoomLean | null> {
    return Room.findByIdAndUpdate(
      id,
      { $set: { hostId: userId, 'members.$[member].role': 'host', lastActivityAt: new Date() } },
      { new: true, arrayFilters: [{ 'member.userId': userId }] },
    ).lean<RoomLean>();
  },

  /**
   * Atomically claims a client event id. Returns null when the id was already
   * processed — the primitive behind "a duplicate queue:add never duplicates a
   * track". The stored ring buffer is capped at 200 ids per room.
   */
  async claimEvent(id: string | Types.ObjectId, eventId: string): Promise<RoomLean | null> {
    return Room.findOneAndUpdate(
      { _id: id, processedEventIds: { $ne: eventId } },
      { $push: { processedEventIds: { $each: [eventId], $slice: -200 } } },
      { new: true },
    ).lean<RoomLean>();
  },

  async addToQueue(
    id: string | Types.ObjectId,
    entry: { songId: Types.ObjectId; addedBy: Types.ObjectId; eventId: string },
  ): Promise<RoomLean | null> {
    return Room.findByIdAndUpdate(
      id,
      {
        $push: { queue: { songId: entry.songId, addedBy: entry.addedBy, addedAt: new Date(), eventId: entry.eventId } },
        $set: { lastActivityAt: new Date() },
      },
      { new: true },
    ).lean<RoomLean>();
  },

  async removeFromQueue(id: string | Types.ObjectId, songId: Types.ObjectId): Promise<RoomLean | null> {
    return Room.findByIdAndUpdate(
      id,
      { $pull: { queue: { songId } }, $set: { lastActivityAt: new Date() } },
      { new: true },
    ).lean<RoomLean>();
  },

  async updatePlayback(
    id: string | Types.ObjectId,
    playback: {
      trackId: Types.ObjectId | null;
      isPlaying: boolean;
      positionMs: number;
      serverTs: Date;
      updatedBy: Types.ObjectId | null;
    },
  ): Promise<RoomLean | null> {
    return Room.findByIdAndUpdate(
      id,
      { $set: { playback, lastActivityAt: new Date() } },
      { new: true },
    ).lean<RoomLean>();
  },

  async listActiveWithPlayback(limit: number): Promise<RoomLean[]> {
    return Room.find({
      visibility: 'public',
      lastActivityAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) },
    })
      .sort({ lastActivityAt: -1 })
      .limit(limit)
      .lean<RoomLean[]>();
  },

  async countActive(): Promise<number> {
    return Room.countDocuments({ lastActivityAt: { $gte: new Date(Date.now() - ACTIVE_WINDOW_MS) } });
  },

  async count(): Promise<number> {
    return Room.countDocuments({});
  },

  async deleteById(id: string | Types.ObjectId): Promise<boolean> {
    const result = await Room.deleteOne({ _id: id });
    return result.deletedCount === 1;
  },
};

export const ROOM_ACTIVE_WINDOW_MS = ACTIVE_WINDOW_MS;
