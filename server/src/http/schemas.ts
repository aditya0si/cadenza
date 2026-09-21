import { z } from 'zod';
import { decodeMessageCursor, type MessageCursor } from '../repositories/message.repository.js';

/**
 * Every endpoint validates its input with one of these schemas. Coercion is
 * explicit (`z.coerce`) so query strings arrive at controllers as real numbers,
 * and unknown keys are stripped rather than silently forwarded to Mongo.
 */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24 character hex ObjectId');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const idParam = z.object({ id: objectId });

export const listSongsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(120).optional(),
  albumId: objectId.optional(),
  artistId: objectId.optional(),
  sort: z.enum(['title', '-playCount', 'albumOrder', '-createdAt']).default('-playCount'),
});

export const listArtistsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(120).optional(),
});

export const listAlbumsQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(120).optional(),
  artistId: objectId.optional(),
});

export const searchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const recordPlayBody = z.object({
  source: z.enum(['library', 'album', 'playlist', 'search', 'room']),
  roomId: objectId.optional(),
});

export const streamQuery = z.object({
  exp: z.coerce.number().int().positive(),
  sig: z.string().min(16).max(128),
});

export const coverParams = z.object({
  kind: z.enum(['song', 'album', 'artist']),
  id: objectId,
});

export const createPlaylistBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional(),
  visibility: z.enum(['private', 'public']).default('private'),
});

export const updatePlaylistBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(600).optional(),
    visibility: z.enum(['private', 'public']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field to update' });

export const listPlaylistsQuery = paginationQuery.extend({
  scope: z.enum(['mine', 'public', 'all']).default('all'),
  search: z.string().trim().min(1).max(120).optional(),
});

export const addPlaylistSongBody = z.object({
  songId: objectId,
  position: z.coerce.number().int().min(0).max(500).optional(),
});

export const reorderPlaylistBody = z.object({
  songIds: z.array(objectId).min(1).max(200),
});

export const createRoomBody = z.object({
  name: z.string().trim().min(2).max(120),
  visibility: z.enum(['public', 'private']).default('public'),
});

export const listRoomsQuery = paginationQuery.extend({
  activeOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
});

export const queueMutationBody = z.object({
  songId: objectId,
  /** Client-generated idempotency key. */
  eventId: z.string().trim().min(8).max(64),
});

export const messagesQuery = z.object({
  /**
   * Opaque keyset cursor minted by this API (`nextBefore`). It packs the
   * timestamp *and* the message id, because two messages can share a
   * millisecond and a timestamp alone cannot say where a page ended.
   */
  before: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .transform((value) => decodeMessageCursor(value))
    .refine((cursor): cursor is MessageCursor => cursor !== null, { message: 'must be a cursor returned by this API' })
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const statsPlaysQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export const statsTopTracksQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export const statsActiveRoomsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const demoSessionBody = z.object({
  email: z.string().trim().email().max(160),
  displayName: z.string().trim().min(1).max(80).optional(),
});

export type ListSongsQuery = z.infer<typeof listSongsQuery>;
export type ListArtistsQuery = z.infer<typeof listArtistsQuery>;
export type ListAlbumsQuery = z.infer<typeof listAlbumsQuery>;
export type SearchQuery = z.infer<typeof searchQuery>;
export type RecordPlayBody = z.infer<typeof recordPlayBody>;
export type StreamQuery = z.infer<typeof streamQuery>;
export type CoverParams = z.infer<typeof coverParams>;
export type CreatePlaylistBody = z.infer<typeof createPlaylistBody>;
export type UpdatePlaylistBody = z.infer<typeof updatePlaylistBody>;
export type ListPlaylistsQuery = z.infer<typeof listPlaylistsQuery>;
export type AddPlaylistSongBody = z.infer<typeof addPlaylistSongBody>;
export type ReorderPlaylistBody = z.infer<typeof reorderPlaylistBody>;
export type CreateRoomBody = z.infer<typeof createRoomBody>;
export type ListRoomsQuery = z.infer<typeof listRoomsQuery>;
export type QueueMutationBody = z.infer<typeof queueMutationBody>;
export type MessagesQuery = z.infer<typeof messagesQuery>;
export type StatsPlaysQuery = z.infer<typeof statsPlaysQuery>;
export type StatsTopTracksQuery = z.infer<typeof statsTopTracksQuery>;
export type StatsActiveRoomsQuery = z.infer<typeof statsActiveRoomsQuery>;
export type DemoSessionBody = z.infer<typeof demoSessionBody>;
export type PaginationQuery = z.infer<typeof paginationQuery>;
export type IdParam = z.infer<typeof idParam>;
