import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { roomRepository, type RoomLean } from '../repositories/room.repository.js';
import { messageRepository, type MessageCursor, type MessageLean } from '../repositories/message.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { songRepository } from '../repositories/song.repository.js';
import { artistRepository } from '../repositories/artist.repository.js';
import { albumRepository } from '../repositories/album.repository.js';
import type { Paginated } from '../repositories/pagination.js';
import {
  serializeMessage,
  serializeRoom,
  serializeSong,
  type MessageDto,
  type RoomDto,
  type RoomMemberDto,
  type SongDto,
} from '../http/serializers.js';

export interface RoomSummaryDto {
  id: string;
  name: string;
  slug: string;
  hostId: string;
  visibility: 'private' | 'public';
  memberCount: number;
  queueLength: number;
  isPlaying: boolean;
  nowPlaying: SongDto | null;
  lastActivityAt: string;
}

/** The slice of the Socket.IO server the REST layer needs to push updates. */
export interface RealtimeBroadcaster {
  broadcastToRoom(roomId: string, event: string, payload: unknown): void;
  connectedUserIds(roomId: string): string[];
  /**
   * Drops every socket belonging to `userId` out of the Socket.IO room and out
   * of presence, so a member who left over REST stops receiving that room's
   * broadcasts. Returns how many sockets were evicted.
   */
  evictUserFromRoom(roomId: string, userId: string): Promise<number>;
}

export interface RoomSnapshot {
  room: RoomDto;
  messages: MessageDto[];
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'room';

/**
 * Listening rooms. Membership is checked on every mutating call; the REST layer
 * and the socket layer both go through this service, so a socket event can never
 * do something the REST API would refuse (and vice versa).
 */
export class RoomService {
  constructor(private readonly realtime: () => RealtimeBroadcaster | null) {}

  private async decorateQueue(queue: { songId: Types.ObjectId }[]): Promise<SongDto[]> {
    if (queue.length === 0) return [];
    const songs = await songRepository.findByIds(queue.map((entry) => String(entry.songId)));
    const [artists, albums] = await Promise.all([
      artistRepository.findByIds([...new Set(songs.map((song) => String(song.artistId)))]),
      albumRepository.findByIds([
        ...new Set(songs.map((song) => (song.albumId ? String(song.albumId) : '')).filter((id) => id !== '')),
      ]),
    ]);
    const artistNames = new Map(artists.map((artist) => [String(artist._id), artist.name]));
    const albumTitles = new Map(albums.map((album) => [String(album._id), album.title]));
    const byId = new Map(songs.map((song) => [String(song._id), song]));

    const ordered: SongDto[] = [];
    for (const entry of queue) {
      const song = byId.get(String(entry.songId));
      if (!song) continue;
      ordered.push(
        serializeSong(song, {
          artistName: artistNames.get(String(song.artistId)) ?? null,
          albumTitle: song.albumId ? (albumTitles.get(String(song.albumId)) ?? null) : null,
        }),
      );
    }
    return ordered;
  }

  private async decorateMembers(room: RoomLean): Promise<RoomMemberDto[]> {
    const users = await userRepository.findByIds(room.members.map((member) => String(member.userId)));
    const byId = new Map(users.map((user) => [String(user._id), user]));
    return room.members.map((member) => {
      const user = byId.get(String(member.userId));
      return {
        userId: String(member.userId),
        displayName: user?.displayName ?? 'Listener',
        avatarUrl: user?.avatarUrl ?? null,
        role: member.role,
        joinedAt: new Date(member.joinedAt).toISOString(),
        connected: false,
      };
    });
  }

  private requireMember(room: RoomLean, userId: string, message = 'Join the room before changing its playback'): void {
    if (!room.members.some((member) => String(member.userId) === userId)) {
      throw AppError.forbidden(message);
    }
  }

  async requireMembership(roomId: string, userId: string): Promise<RoomLean> {
    const room = await this.requireRoom(roomId);
    this.requireMember(room, userId);
    return room;
  }

  async requireRoom(roomId: string): Promise<RoomLean> {
    if (!Types.ObjectId.isValid(roomId)) throw AppError.notFound('Room not found');
    const room = await roomRepository.findById(roomId);
    if (!room) throw AppError.notFound('Room not found');
    return room;
  }

  async list(query: { page: number; limit: number; activeOnly: boolean }): Promise<Paginated<RoomSummaryDto>> {
    const result = await roomRepository.list({
      visibility: 'public',
      ...(query.activeOnly ? { activeSince: new Date(Date.now() - 60 * 60 * 1000) } : {}),
      page: query.page,
      limit: query.limit,
    });
    const summaries = await Promise.all(
      result.items.map(async (room) => {
        const nowPlaying = room.playback.trackId ? (await this.decorateQueue([{ songId: room.playback.trackId }]))[0] ?? null : null;
        return {
          id: String(room._id),
          name: room.name,
          slug: room.slug,
          hostId: String(room.hostId),
          visibility: room.visibility,
          memberCount: room.members.length,
          queueLength: room.queue.length,
          isPlaying: room.playback.isPlaying,
          nowPlaying,
          lastActivityAt: new Date(room.lastActivityAt).toISOString(),
        } satisfies RoomSummaryDto;
      }),
    );
    return { ...result, items: summaries };
  }

  /**
   * The snapshot behind `GET /rooms/:id` and the socket `room:snapshot`.
   *
   * Chat is member-only, on both transports: a non-member gets a *public* room's
   * metadata and queue (that is what the browse list is for) but never its
   * messages, and a non-member of a private room gets 403. The socket path
   * refuses a non-member `room:join` outright, and this is the same rule on the
   * REST path.
   */
  async snapshot(roomId: string, requester: AuthenticatedUser): Promise<RoomSnapshot> {
    const room = await roomRepository.findById(roomId);
    if (!room) throw AppError.notFound('Room not found');
    if (this.isMember(room, requester.id)) return this.snapshotFor(room, 'member');
    if (room.visibility === 'private') throw AppError.forbidden('This room is private');
    return this.snapshotFor(room, 'public');
  }

  private isMember(room: RoomLean, userId: string): boolean {
    return room.members.some((member) => String(member.userId) === userId);
  }

  /**
   * `member`  — full view, chat included.
   * `public`  — a non-member's view of a public room: metadata + queue, no chat.
   * `departed`— the response to `leave`: the caller stopped being a member in
   *             the same request, so they get the room metadata without chat
   *             and without the private-room gate (they were just inside).
   */
  private async snapshotFor(room: RoomLean, view: 'member' | 'public' | 'departed'): Promise<RoomSnapshot> {
    const [members, queue, history] = await Promise.all([
      this.decorateMembers(room),
      this.decorateQueue(room.queue),
      view === 'member'
        ? messageRepository.listByRoom({ roomId: String(room._id), limit: 50 })
        : Promise.resolve({ items: [] as MessageLean[], nextBefore: null, hasMore: false }),
    ]);
    const authors = await userRepository.findByIds([...new Set(history.items.map((message) => String(message.authorId)))]);
    const authorById = new Map(authors.map((user) => [String(user._id), user]));

    return {
      room: serializeRoom({
        room,
        members,
        queue,
        connectedUserIds: this.realtime()?.connectedUserIds(String(room._id)) ?? [],
      }),
      messages: history.items
        .slice()
        .reverse()
        .map((message) => {
          const author = authorById.get(String(message.authorId));
          return serializeMessage(message, {
            id: String(message.authorId),
            displayName: author?.displayName ?? 'Listener',
            avatarUrl: author?.avatarUrl ?? null,
          });
        }),
    };
  }

  async create(
    requester: AuthenticatedUser,
    input: { name: string; visibility?: 'private' | 'public' },
  ): Promise<RoomDto> {
    const slug = `${slugify(input.name)}-${randomBytes(2).toString('hex')}`;
    const room = await roomRepository.create({
      name: input.name,
      slug,
      hostId: new Types.ObjectId(requester.id),
      visibility: input.visibility ?? 'public',
    });
    return this.snapshot(String(room._id), requester).then((snapshot) => snapshot.room);
  }

  async join(roomId: string, requester: AuthenticatedUser): Promise<RoomDto> {
    const room = await this.requireRoom(roomId);
    if (room.visibility === 'private' && room.members.length > 0 && !room.members.some((m) => String(m.userId) === requester.id)) {
      // Private rooms are invite-only by id: the first joiner is the host, who
      // was added at creation time.
      throw AppError.forbidden('This room is private');
    }
    const updated = await roomRepository.addMember(roomId, new Types.ObjectId(requester.id));
    void updated;
    const snapshot = await this.snapshot(roomId, requester);
    this.realtime()?.broadcastToRoom(roomId, 'presence', {
      roomId,
      connectedUserIds: this.realtime()?.connectedUserIds(roomId) ?? [],
    });
    // `addMember` is a no-op when the user was already a member, so the fresh
    // snapshot is authoritative either way.
    return snapshot.room;
  }

  async leave(roomId: string, requester: AuthenticatedUser): Promise<{ room: RoomDto; promoted: string | null }> {
    const room = await this.requireMembership(roomId, requester.id);
    const remaining = room.members.filter((member) => String(member.userId) !== requester.id);
    await roomRepository.removeMember(roomId, new Types.ObjectId(requester.id));

    let promoted: string | null = null;
    if (remaining.length > 0 && String(room.hostId) === requester.id) {
      // Host left: the longest-standing remaining member takes over, and the
      // room document's hostId moves with them.
      const next = remaining
        .slice()
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime())[0];
      if (next) {
        promoted = String(next.userId);
        await roomRepository.transferHost(roomId, next.userId as Types.ObjectId);
      }
    }
    // Membership is gone, so the socket must go with it: leaving over REST used
    // to leave the socket in the Socket.IO room, where it kept receiving
    // `chat:message` broadcasts it was no longer entitled to read.
    await this.realtime()?.evictUserFromRoom(roomId, requester.id);
    const updated = await this.requireRoom(roomId);
    const snapshot = await this.snapshotFor(updated, 'departed');
    this.realtime()?.broadcastToRoom(roomId, 'presence', {
      roomId,
      connectedUserIds: this.realtime()?.connectedUserIds(roomId) ?? [],
    });
    return { room: snapshot.room, promoted };
  }

  async addToQueue(
    roomId: string,
    requester: AuthenticatedUser,
    input: { songId: string; eventId: string },
  ): Promise<{ room: RoomDto; duplicate: boolean; song: SongDto | null }> {
    await this.requireMembership(roomId, requester.id);
    const song = await songRepository.findById(input.songId);
    if (!song) throw AppError.notFound('Song not found');

    const claimed = await roomRepository.claimEvent(roomId, requester.id, input.eventId);
    if (!claimed) {
      const current = await this.snapshot(roomId, requester);
      return { room: current.room, duplicate: true, song: null };
    }

    const updated = await roomRepository.addToQueue(roomId, {
      songId: song._id as Types.ObjectId,
      addedBy: new Types.ObjectId(requester.id),
      eventId: input.eventId,
    });
    const snapshot = await this.snapshot(roomId, requester);
    const queuedSong = snapshot.room.queue.find((entry) => entry.id === input.songId) ?? null;
    if (updated) {
      this.realtime()?.broadcastToRoom(roomId, 'queue:updated', { roomId, queue: snapshot.room.queue, addedBy: requester.id });
    }
    return { room: snapshot.room, duplicate: false, song: queuedSong };
  }

  async removeFromQueue(
    roomId: string,
    requester: AuthenticatedUser,
    input: { songId: string; eventId: string },
  ): Promise<{ room: RoomDto; duplicate: boolean; removed: boolean }> {
    const room = await this.requireMembership(roomId, requester.id);
    if (!room.queue.some((entry) => String(entry.songId) === input.songId)) {
      throw AppError.notFound('That track is not in the room queue');
    }
    const claimed = await roomRepository.claimEvent(roomId, requester.id, input.eventId);
    if (!claimed) {
      const current = await this.snapshot(roomId, requester);
      return { room: current.room, duplicate: true, removed: false };
    }
    await roomRepository.removeFromQueue(roomId, new Types.ObjectId(input.songId));
    const snapshot = await this.snapshot(roomId, requester);
    this.realtime()?.broadcastToRoom(roomId, 'queue:updated', { roomId, queue: snapshot.room.queue, removedBy: requester.id });
    return { room: snapshot.room, duplicate: false, removed: true };
  }

  async history(
    roomId: string,
    requester: AuthenticatedUser,
    query: { before?: MessageCursor | undefined; limit: number },
  ): Promise<{ items: MessageDto[]; nextBefore: string | null; hasMore: boolean }> {
    const room = await this.requireRoom(roomId);
    // Chat history is member-only, exactly like the socket snapshot: a public
    // room's metadata is readable, its conversation is not.
    this.requireMember(room, requester.id, 'Join the room to read its chat history');
    const page = await messageRepository.listByRoom({ roomId, before: query.before, limit: query.limit });
    const authors = await userRepository.findByIds([...new Set(page.items.map((message) => String(message.authorId)))]);
    const authorById = new Map(authors.map((user) => [String(user._id), user]));
    return {
      items: page.items.map((message) => {
        const author = authorById.get(String(message.authorId));
        return serializeMessage(message, {
          id: String(message.authorId),
          displayName: author?.displayName ?? 'Listener',
          avatarUrl: author?.avatarUrl ?? null,
        });
      }),
      nextBefore: page.nextBefore,
      hasMore: page.hasMore,
    };
  }
}
