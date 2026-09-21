import { Types } from 'mongoose';
import { Message, type MessageDocument } from '../models/index.js';

export type MessageLean = MessageDocument & { _id: Types.ObjectId };

export interface MessagePage {
  items: MessageLean[];
  /** Opaque cursor for the next page: `createdAt` and `_id` of the oldest item. */
  nextBefore: string | null;
  hasMore: boolean;
}

/**
 * Chat history is read newest-first by `createdAt` — that is the order a reader
 * expects. `createdAt` is not unique, though: two messages sent in the same
 * millisecond tie, and Mongo is then free to return them in *any* order. That
 * order is not stable across platforms or across a collection scan and an index
 * scan, so a suite that passes on one machine can fail on another, and a page
 * boundary that falls inside a tie group silently skips rows.
 *
 * `_id` breaks the tie: it is unique, and ObjectIds minted by one process
 * increase with insertion order (timestamp, then a per-process value, then a
 * counter). Sorting on the pair `(createdAt, _id)` is therefore a total order,
 * and a keyset cursor over a total order can never skip or repeat a row.
 *
 * The cursor stays opaque to clients — it is one URL-encoded query value, so
 * packing both keys into it (`<ISO createdAt>|<message id>`) needs no change on
 * the wire.
 */
export interface MessageCursor {
  createdAt: Date;
  id: Types.ObjectId;
}

const CURSOR_SEPARATOR = '|';
/** Exactly what `Date.prototype.toISOString()` emits, so round-trips are exact. */
const ISO_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const HEX_OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const encodeMessageCursor = (message: { createdAt: Date | string; _id: Types.ObjectId }): string =>
  `${new Date(message.createdAt).toISOString()}${CURSOR_SEPARATOR}${String(message._id)}`;

/**
 * `null` for anything this repository did not mint. The HTTP layer rejects that
 * with 400 before a query is built, so an unparseable cursor can never be
 * silently downgraded to "first page".
 */
export function decodeMessageCursor(raw: string): MessageCursor | null {
  const separator = raw.indexOf(CURSOR_SEPARATOR);
  if (separator === -1) return null;
  const timestamp = raw.slice(0, separator);
  const id = raw.slice(separator + 1);
  if (!ISO_UTC_MILLIS.test(timestamp) || !HEX_OBJECT_ID.test(id)) return null;
  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id: new Types.ObjectId(id) };
}

export const messageRepository = {
  /** Keyset pagination: newest first, `before` walks backwards in `(createdAt, _id)` order. */
  async listByRoom(input: {
    roomId: string | Types.ObjectId;
    before?: MessageCursor | undefined;
    limit: number;
  }): Promise<MessagePage> {
    const filter: Record<string, unknown> = { roomId: input.roomId };
    if (input.before) {
      // Everything strictly older, plus the remainder of the group that shares
      // the cursor's millisecond. A bare `createdAt: { $lt: before }` would drop
      // that group — every message in it is skipped the moment a page boundary
      // lands inside it.
      filter.$or = [
        { createdAt: { $lt: input.before.createdAt } },
        { createdAt: input.before.createdAt, _id: { $lt: input.before.id } },
      ];
    }
    const rows = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(input.limit + 1)
      .lean<MessageLean[]>();
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const oldest = items[items.length - 1];
    return {
      items,
      nextBefore: hasMore && oldest ? encodeMessageCursor(oldest) : null,
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
