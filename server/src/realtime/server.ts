import { Types } from 'mongoose';
import { Server as IOServer, type Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { AppContext } from '../context.js';
import { AppError, isAppError } from '../errors.js';
import { roomRepository } from '../repositories/room.repository.js';
import { messageRepository, type MessageLean } from '../repositories/message.repository.js';
import { songRepository } from '../repositories/song.repository.js';
import type { RealtimeBroadcaster } from '../services/room.service.js';
import { EventDeduplicator, TokenBucket } from './dedupe.js';
import { PresenceRegistry } from './presence.js';
import { clampPosition, projectPosition, shouldSnap, toPlaybackEvent, type PlaybackAnchor } from './playback.js';
import type { AuthenticatedUser } from '../auth/types.js';

/** Message the client sees when the handshake token is missing or invalid. */
export const SOCKET_AUTH_ERROR = 'UNAUTHENTICATED';

export interface RealtimeServer extends RealtimeBroadcaster {
  io: IOServer;
  presence: PresenceRegistry;
  connectedCount(): number;
  close(): Promise<void>;
}

interface AckPayload {
  ok: boolean;
  [key: string]: unknown;
}

type Ack = ((payload: AckPayload) => void) | undefined;

interface SocketData {
  user: AuthenticatedUser;
}

interface JoinPayload {
  roomId?: unknown;
}

interface PlaybackPayload extends JoinPayload {
  positionMs?: unknown;
  eventId?: unknown;
}

interface TrackPayload extends JoinPayload {
  songId?: unknown;
  eventId?: unknown;
}

interface ChatPayload extends JoinPayload {
  body?: unknown;
  eventId?: unknown;
  clientSentAt?: unknown;
}

const readRoomId = (payload: unknown): string => {
  const roomId = (payload as JoinPayload | undefined)?.roomId;
  if (typeof roomId !== 'string' || !Types.ObjectId.isValid(roomId)) {
    throw AppError.validation('A valid roomId is required');
  }
  return roomId;
};

const readEventId = (payload: unknown): string => {
  const eventId = (payload as { eventId?: unknown } | undefined)?.eventId;
  if (typeof eventId !== 'string' || eventId.length < 8 || eventId.length > 64) {
    throw AppError.validation('eventId (8-64 chars) is required for idempotent events');
  }
  return eventId;
};

const readPosition = (payload: unknown): number => {
  const positionMs = (payload as PlaybackPayload | undefined)?.positionMs;
  if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) {
    throw AppError.validation('positionMs must be a non-negative number');
  }
  return Math.round(positionMs);
};

const toAckError = (error: unknown): AckPayload => {
  if (isAppError(error)) return { ok: false, error: { code: error.code, message: error.message } };
  return {
    ok: false,
    error: { code: 'INTERNAL', message: error instanceof Error ? error.message : 'Unexpected socket error' },
  };
};

/**
 * Client event ids are generated per client, so every idempotency key is
 * namespaced by user: two listeners can legitimately pick the same id, and one
 * client's replay must never be treated as another client's event.
 */
const eventKey = (userId: string, eventId: string): string => `${userId}:${eventId}`;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;

/**
 * `ws` refuses a frame larger than `maxPayload` with this message, which is the
 * only place a payload-size refusal is visible on the server (the transport
 * closes the socket before any socket.io handler runs).
 */
const isMaxPayloadError = (error: unknown): boolean =>
  error instanceof Error && /max payload size exceeded/i.test(error.message);

interface RawTransportSocket {
  on(event: 'error', handler: (error: unknown) => void): void;
  on(event: 'close', handler: (code: number) => void): void;
}

/** Room document playback row → the pure clock anchor used by the playback helpers. */
const anchorOf = (room: { playback: { trackId?: Types.ObjectId | null; isPlaying: boolean; positionMs: number; serverTs: Date; updatedBy?: Types.ObjectId | null } }): PlaybackAnchor => ({
  trackId: room.playback.trackId ? String(room.playback.trackId) : null,
  isPlaying: room.playback.isPlaying,
  positionMs: room.playback.positionMs,
  serverTs: room.playback.serverTs,
  updatedBy: room.playback.updatedBy ? String(room.playback.updatedBy) : null,
});

/**
 * The realtime half of CADENZA.
 *
 * Guarantees this module is responsible for:
 *   - authenticated handshakes only (the same identity verifier as HTTP),
 *   - membership checks on every room mutation,
 *   - a server-authoritative playback clock with drift snapping,
 *   - idempotent mutations (queue/chat keyed in Mongo, playback in memory),
 *   - presence that survives multi-tab clients,
 *   - full state resync after a reconnect.
 */
export function createRealtimeServer(httpServer: HttpServer, ctx: AppContext): RealtimeServer {
  const io = new IOServer(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: {
      origin: ctx.env.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 20_000,
    pingTimeout: 25_000,
    // Hard ceiling on one socket payload. socket.io's default is 1 MB, which is
    // buffered *before* it is refused, so a single 1.2 MB emit silently killed
    // the connection. The bound is the memory guard; the hook below makes the
    // refusal typed instead of silent.
    maxHttpBufferSize: ctx.env.SOCKET_MAX_PAYLOAD_BYTES,
  });

  io.engine.on('connection', (engineSocket) => {
    const raw = (engineSocket.transport as { socket?: RawTransportSocket }).socket;
    raw?.on('error', (error) => {
      if (!isMaxPayloadError(error)) return;
      ctx.logger.warn(
        { code: 'PAYLOAD_TOO_LARGE', limitBytes: ctx.env.SOCKET_MAX_PAYLOAD_BYTES, transport: engineSocket.transport.name },
        'socket payload refused: it exceeds SOCKET_MAX_PAYLOAD_BYTES',
      );
    });
  });

  const presence = new PresenceRegistry();
  const playbackDedupe = new EventDeduplicator(200);
  const chatBucket = new TokenBucket(ctx.env.SOCKET_CHAT_BURST, ctx.env.SOCKET_CHAT_REFILL_PER_SEC);
  const queueBucket = new TokenBucket(ctx.env.SOCKET_QUEUE_BURST, ctx.env.SOCKET_QUEUE_REFILL_PER_SEC);
  // Drift reports are the third client-driven channel: unbucketed, one client
  // could flood the server with them as fast as it can emit.
  const reportBucket = new TokenBucket(ctx.env.SOCKET_REPORT_BURST, ctx.env.SOCKET_REPORT_REFILL_PER_SEC);

  const emitPresence = (roomId: string): void => {
    io.to(roomId).emit('presence', { roomId, connectedUserIds: presence.connectedUserIds(roomId) });
  };

  const broadcaster: RealtimeBroadcaster = {
    broadcastToRoom(roomId: string, event: string, payload: unknown): void {
      io.to(roomId).emit(event, payload);
    },
    connectedUserIds(roomId: string): string[] {
      return presence.connectedUserIds(roomId);
    },
    /**
     * REST `leave` and a socket `room:leave` must have the same effect. Without
     * this the departed member's socket stayed in the Socket.IO room and kept
     * receiving `chat:message` broadcasts — a one-way read leak.
     */
    async evictUserFromRoom(roomId: string, userId: string): Promise<number> {
      const sockets = await io.in(roomId).fetchSockets();
      let evicted = 0;
      for (const remote of sockets) {
        const socketData = remote.data as SocketData | undefined;
        if (socketData?.user?.id !== userId) continue;
        await remote.leave(roomId);
        presence.remove(roomId, remote.id);
        remote.emit('room:evicted', { roomId, reason: 'left' });
        evicted += 1;
      }
      if (evicted > 0) emitPresence(roomId);
      return evicted;
    },
  };

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
      const headerToken = socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
      const raw = typeof token === 'string' && token.length > 0 ? token : headerToken;
      if (!raw) {
        next(new Error(`${SOCKET_AUTH_ERROR}: no session token in the handshake`));
        return;
      }
      const identity = await ctx.identity.verify(raw);
      const user = await ctx.services.users.ensureUser(identity);
      (socket.data as SocketData).user = user;
      next();
    } catch (error) {
      ctx.logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'socket handshake rejected');
      next(new Error(`${SOCKET_AUTH_ERROR}: ${error instanceof Error ? error.message : 'invalid session token'}`));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket.data as SocketData).user;
    ctx.logger.info({ socketId: socket.id, userId: user.id }, 'socket connected');

    const withUser = async <T>(handler: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await handler();
      } catch (error) {
        ctx.logger.warn(
          { socketId: socket.id, userId: user.id, err: error instanceof Error ? error.message : String(error) },
          'socket event failed',
        );
        throw error;
      }
    };

    const respond = async (ack: Ack, handler: () => Promise<AckPayload>): Promise<void> => {
      try {
        const payload = await withUser(handler);
        ack?.(payload ?? { ok: true });
      } catch (error) {
        const payload = toAckError(error);
        ack?.(payload);
        socket.emit('room:error', { ...payload, roomId: (socket.data as { lastRoomId?: string }).lastRoomId ?? null });
      }
    };

    socket.on('room:join', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        await socket.join(roomId);
        presence.add(roomId, user.id, socket.id);
        (socket.data as { lastRoomId?: string }).lastRoomId = roomId;

        const snapshot = await ctx.services.rooms.snapshot(roomId, user);
        socket.emit('room:snapshot', snapshot);
        socket.emit('playback:state', toPlaybackEvent(anchorOf(room)));
        emitPresence(roomId);
        return { ok: true, snapshot };
      });
    });

    socket.on('room:leave', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        await socket.leave(roomId);
        presence.remove(roomId, socket.id);
        emitPresence(roomId);
        return { ok: true, roomId };
      });
    });

    socket.on('room:resync', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        await ctx.services.rooms.requireMembership(roomId, user.id);
        presence.add(roomId, user.id, socket.id);
        await socket.join(roomId);
        const snapshot = await ctx.services.rooms.snapshot(roomId, user);
        socket.emit('room:snapshot', snapshot);
        return { ok: true, snapshot, resynced: true };
      });
    });

    socket.on('playback:play', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        if (!room.playback.trackId) throw AppError.conflict('Queue a track before starting playback');
        if (!playbackDedupe.claim(roomId, eventKey(user.id, eventId))) return { ok: true, duplicate: true };

        const song = await songRepository.findById(room.playback.trackId);
        const positionMs = clampPosition(readPosition(payload), song?.durationMs ?? 0);
        const now = Date.now();
        await roomRepository.updatePlayback(roomId, {
          trackId: room.playback.trackId,
          isPlaying: true,
          positionMs,
          serverTs: new Date(now),
          updatedBy: new Types.ObjectId(user.id),
        });
        const state = toPlaybackEvent(
          { trackId: String(room.playback.trackId), isPlaying: true, positionMs, serverTs: now, updatedBy: user.id },
          now,
        );
        io.to(roomId).emit('playback:state', state);
        return { ok: true, state };
      });
    });

    socket.on('playback:pause', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        if (!playbackDedupe.claim(roomId, eventKey(user.id, eventId))) return { ok: true, duplicate: true };

        const authoritative = projectPosition(anchorOf(room));
        const now = Date.now();
        await roomRepository.updatePlayback(roomId, {
          trackId: room.playback.trackId ?? null,
          isPlaying: false,
          positionMs: authoritative,
          serverTs: new Date(now),
          updatedBy: new Types.ObjectId(user.id),
        });
        const state = toPlaybackEvent(
          { trackId: room.playback.trackId ? String(room.playback.trackId) : null, isPlaying: false, positionMs: authoritative, serverTs: now, updatedBy: user.id },
          now,
        );
        io.to(roomId).emit('playback:state', state);
        return { ok: true, state };
      });
    });

    socket.on('playback:seek', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        if (!room.playback.trackId) throw AppError.conflict('Nothing is queued to seek within');
        if (!playbackDedupe.claim(roomId, eventKey(user.id, eventId))) return { ok: true, duplicate: true };

        const song = await songRepository.findById(room.playback.trackId);
        const positionMs = clampPosition(readPosition(payload), song?.durationMs ?? 0);
        const now = Date.now();
        await roomRepository.updatePlayback(roomId, {
          trackId: room.playback.trackId,
          isPlaying: room.playback.isPlaying,
          positionMs,
          serverTs: new Date(now),
          updatedBy: new Types.ObjectId(user.id),
        });
        const state = toPlaybackEvent(
          {
            trackId: String(room.playback.trackId),
            isPlaying: room.playback.isPlaying,
            positionMs,
            serverTs: now,
            updatedBy: user.id,
          },
          now,
        );
        io.to(roomId).emit('playback:state', state);
        return { ok: true, state };
      });
    });

    /** Host-only: changing the track is the one privileged playback action. */
    socket.on('playback:track', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        if (String(room.hostId) !== user.id) {
          throw AppError.forbidden('Only the room host can change the track');
        }
        const songId = (payload as TrackPayload | undefined)?.songId;
        if (typeof songId !== 'string' || !Types.ObjectId.isValid(songId)) {
          throw AppError.validation('songId must be a valid ObjectId');
        }
        const song = await songRepository.findById(songId);
        if (!song) throw AppError.notFound('Song not found');
        if (!playbackDedupe.claim(roomId, eventKey(user.id, eventId))) return { ok: true, duplicate: true };

        const now = Date.now();
        await roomRepository.updatePlayback(roomId, {
          trackId: song._id as Types.ObjectId,
          isPlaying: true,
          positionMs: 0,
          serverTs: new Date(now),
          updatedBy: new Types.ObjectId(user.id),
        });
        const state = toPlaybackEvent({ trackId: songId, isPlaying: true, positionMs: 0, serverTs: now, updatedBy: user.id }, now);
        io.to(roomId).emit('playback:state', state);
        io.to(roomId).emit('track:changed', { roomId, songId, changedBy: user.id });
        await ctx.services.catalog.recordPlay({ songId, userId: user.id, roomId, source: 'room' });
        return { ok: true, state };
      });
    });

    /**
     * Drift report: the client tells the server where it thinks playback is.
     * Anything beyond the configured threshold is snapped back to the
     * server-authoritative position.
     */
    socket.on('playback:report', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const room = await ctx.services.rooms.requireMembership(roomId, user.id);
        if (!reportBucket.take(socket.id)) {
          throw new AppError('RATE_LIMITED', 'Slow down: too many drift reports in a row');
        }
        const clientPositionMs = readPosition(payload);
        const anchor = anchorOf(room);
        const now = Date.now();
        const authoritativePositionMs = projectPosition(anchor, now);
        const driftMs = Math.round(clientPositionMs - authoritativePositionMs);
        const snapped = shouldSnap(clientPositionMs, authoritativePositionMs, ctx.env.PLAYBACK_DRIFT_THRESHOLD_MS);
        if (snapped) {
          socket.emit('playback:snap', {
            roomId,
            ...toPlaybackEvent(anchor, now),
            reason: 'drift',
          });
        }
        return { ok: true, driftMs, snapped, authoritativePositionMs: Math.round(authoritativePositionMs) };
      });
    });

    socket.on('queue:add', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const songId = (payload as TrackPayload | undefined)?.songId;
        if (typeof songId !== 'string' || !Types.ObjectId.isValid(songId)) {
          throw AppError.validation('songId must be a valid ObjectId');
        }
        if (!queueBucket.take(socket.id)) {
          throw new AppError('RATE_LIMITED', 'Slow down: too many queue changes in a row');
        }
        // The service performs the atomic event-id claim and broadcasts to the room.
        const result = await ctx.services.rooms.addToQueue(roomId, user, { songId, eventId });
        return { ok: true, duplicate: result.duplicate, queue: result.room.queue };
      });
    });

    socket.on('queue:remove', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const songId = (payload as TrackPayload | undefined)?.songId;
        if (typeof songId !== 'string' || !Types.ObjectId.isValid(songId)) {
          throw AppError.validation('songId must be a valid ObjectId');
        }
        if (!queueBucket.take(socket.id)) {
          throw new AppError('RATE_LIMITED', 'Slow down: too many queue changes in a row');
        }
        const result = await ctx.services.rooms.removeFromQueue(roomId, user, { songId, eventId });
        return { ok: true, duplicate: result.duplicate, queue: result.room.queue };
      });
    });

    socket.on('chat:message', (payload: unknown, ack?: Ack) => {
      void respond(ack, async () => {
        const roomId = readRoomId(payload);
        const eventId = readEventId(payload);
        const body = (payload as ChatPayload | undefined)?.body;
        if (typeof body !== 'string' || body.trim().length === 0 || body.length > 1000) {
          throw AppError.validation('body must be a non-empty string of at most 1000 characters');
        }
        await ctx.services.rooms.requireMembership(roomId, user.id);
        if (!chatBucket.take(socket.id)) {
          throw new AppError('RATE_LIMITED', 'Slow down: too many messages in a row');
        }

        const toMessage = (row: MessageLean) => ({
          id: String(row._id),
          roomId,
          body: row.body,
          createdAt: new Date(row.createdAt).toISOString(),
          author: { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl },
        });

        // Idempotency is per (room, author, event): a different listener using
        // the same event id is a *different* event and must not be swallowed.
        const existing = await messageRepository.findByEventId(roomId, user.id, eventId);
        if (existing) {
          return { ok: true, duplicate: true, message: toMessage(existing) };
        }

        let created: MessageLean;
        try {
          created = await messageRepository.create({
            roomId: new Types.ObjectId(roomId),
            authorId: new Types.ObjectId(user.id),
            body: body.trim(),
            eventId,
          });
        } catch (error) {
          // Two retries of the same event can race between the read above and
          // this write; the unique index { roomId, authorId, eventId } decides
          // and the loser answers with the winner's row instead of an error.
          if (!isDuplicateKeyError(error)) throw error;
          const winner = await messageRepository.findByEventId(roomId, user.id, eventId);
          if (!winner) throw error;
          return { ok: true, duplicate: true, message: toMessage(winner) };
        }

        const message = {
          ...toMessage(created),
          clientSentAt: typeof (payload as ChatPayload | undefined)?.clientSentAt === 'number' ? (payload as ChatPayload).clientSentAt : null,
        };
        io.to(roomId).emit('chat:message', { message });
        await roomRepository.touchMember(roomId, new Types.ObjectId(user.id));
        return { ok: true, message };
      });
    });

    socket.on('disconnect', (reason: string) => {
      const affected = presence.removeSocket(socket.id);
      for (const entry of affected) emitPresence(entry.roomId);
      ctx.logger.info({ socketId: socket.id, userId: user.id, reason }, 'socket disconnected');
    });
  });

  const realtime: RealtimeServer = {
    ...broadcaster,
    io,
    presence,
    connectedCount(): number {
      return io.sockets.sockets.size;
    },
    async close(): Promise<void> {
      await io.close();
    },
  };

  return realtime;
}
