import { Types } from 'mongoose';
import { Message, type MessageDocument } from '../models/index.js';

export type MessageLean = MessageDocument & { _id: Types.ObjectId };

export interface MessagePage {
  items: MessageLean[];
  /** Cursor for the next page (createdAt of the oldest returned message). */
  nextBefore: string | null;
  hasMore: boolean;
}

export const messageRepository = {
  /** Keyset pagination: newest first, `before` walks backwards in time. */
  async listByRoom(input: { roomId: string | Types.ObjectId; before?: Date | undefined; limit: number }): Promise<MessagePage> {
    const filter: Record<string, unknown> = { roomId: input.roomId };
    if (input.before) filter.createdAt = { $lt: input.before };
    const rows = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(input.limit + 1)
      .lean<MessageLean[]>();
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const oldest = items[items.length - 1];
    return {
      items,
      nextBefore: hasMore && oldest ? new Date(oldest.createdAt).toISOString() : null,
      hasMore,
    };
  },

  async create(input: {
    roomId: Types.ObjectId;
    authorId: Types.ObjectId;
    body: string;
    eventId: string;
  }): Promise<MessageLean> {
    const created = await Message.create(input);
    return created.toObject<MessageLean>();
  },

  async findByEventId(
    roomId: string | Types.ObjectId,
    authorId: string | Types.ObjectId,
    eventId: string,
  ): Promise<MessageLean | null> {
    return Message.findOne({ roomId, authorId, eventId }).lean<MessageLean>();
  },

  async countByRoom(roomId: string | Types.ObjectId): Promise<number> {
    return Message.countDocuments({ roomId });
  },

  async count(): Promise<number> {
    return Message.countDocuments({});
  },
};
