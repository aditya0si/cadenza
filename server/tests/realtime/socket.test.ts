import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import type { Socket } from 'socket.io-client';
import { awaitEvent, closeSockets, createTestHarness, emitWithAck, type TestHarness } from '../helpers/harness.js';
import { seedCatalog, uniqueEventId, type SeededCatalog } from '../helpers/factory.js';
import { roomRepository } from '../../src/repositories/room.repository.js';
import type { RoomDto, SongDto } from '../../src/http/serializers.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;
let catalog: SeededCatalog;
let hostToken: string;
let guestToken: string;
let strangerToken: string;
let hostId: string;
let guestId: string;
let roomId: string;

interface Ack {
  ok: boolean;
  duplicate?: boolean;
  error?: { code: string; message: string };
  snapshot?: { room: RoomDto };
  queue?: SongDto[];
  state?: { trackId: string | null; isPlaying: boolean; positionMs: number; serverTs: number };
  message?: { id: string; body: string; author: { id: string } };
  driftMs?: number;
  snapped?: boolean;
  authoritativePositionMs?: number;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  catalog = await seedCatalog(4);
  const host = await harness.signIn('socket-host@cadenza.test', 'Socket Host');
  const guest = await harness.signIn('socket-guest@cadenza.test', 'Socket Guest');
  ({ token: strangerToken } = await harness.signIn('socket-stranger@cadenza.test', 'Socket Stranger'));
  hostToken = host.token;
  guestToken = guest.token;
  hostId = host.user.id;
  guestId = guest.user.id;

  const created = await harness
    .request()
    .post('/api/rooms')
    .set(auth(hostToken))
    .send({ name: 'Realtime Room', visibility: 'public' })
    .expect(201);
  roomId = created.body.room.id as string;
  await harness.request().post(`/api/rooms/${roomId}/join`).set(auth(guestToken)).expect(200);
});

afterAll(async () => {
  await harness.close();
});

describe('socket handshake authentication', () => {
  it('rejects a connection with no session token', async () => {
    await expect(harness.connectSocket('')).rejects.toThrowError(/UNAUTHENTICATED/);
  });

  it('rejects a connection with a forged token', async () => {
    await expect(harness.connectSocket('not.a.real.token')).rejects.toThrowError(/UNAUTHENTICATED/);
  });

  it('accepts a connection with a valid demo session', async () => {
    const socket = await harness.connectSocket(hostToken);
    expect(socket.connected).toBe(true);
    await closeSockets(socket);
  });
});

describe('room membership over sockets', () => {
  it('lets a member join and receive the authoritative snapshot + playback state', async () => {
    const socket = await harness.connectSocket(hostToken);
    const playbackState = awaitEvent(socket, 'playback:state');
    const ack = await emitWithAck<Ack>(socket, 'room:join', { roomId });

    expect(ack.ok).toBe(true);
    expect(ack.snapshot?.room.id).toBe(roomId);
    expect(ack.snapshot?.room.members.map((member) => member.userId).sort()).toEqual([hostId, guestId].sort());

    const state = await playbackState;
    expect(state.trackId).toBeNull();
    expect(state.isPlaying).toBe(false);
    await closeSockets(socket);
  });

  it('refuses a socket join from a non-member and reports why', async () => {
    const socket = await harness.connectSocket(strangerToken);
    const roomError = awaitEvent<{ error: { code: string } }>(socket, 'room:error');
    const ack = await emitWithAck<Ack>(socket, 'room:join', { roomId });

    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('FORBIDDEN');
    expect((await roomError).error.code).toBe('FORBIDDEN');
    await closeSockets(socket);
  });

  it('rejects a malformed room id before touching the database', async () => {
    const socket = await harness.connectSocket(hostToken);
    const ack = await emitWithAck<Ack>(socket, 'room:join', { roomId: 'nope' });
    expect(ack.error?.code).toBe('VALIDATION_ERROR');
    await closeSockets(socket);
  });
});

describe('queue propagation and idempotency', () => {
  it('broadcasts a queued track to every member and dedupes replayed event ids', async () => {
    const host = await harness.connectSocket(hostToken);
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(guest, 'room:join', { roomId });

    const eventId = uniqueEventId('queue');
    const received = awaitEvent<{ queue: SongDto[] }>(guest, 'queue:updated');
    const started = Date.now();
    const ack = await emitWithAck<Ack>(host, 'queue:add', { roomId, songId: catalog.songIds[0], eventId });
    const broadcast = await received;
    const latency = Date.now() - started;

    expect(ack.ok).toBe(true);
    expect(ack.duplicate).toBe(false);
    expect(broadcast.queue).toHaveLength(1);
    expect(broadcast.queue[0]?.id).toBe(catalog.songIds[0]);
    expect(latency).toBeLessThan(2_000);

    // Replay the exact same event id: no second track, no second broadcast.
    let broadcasts = 0;
    const countBroadcast = (): void => {
      broadcasts += 1;
    };
    guest.on('queue:updated', countBroadcast);
    const replay = await emitWithAck<Ack>(host, 'queue:add', { roomId, songId: catalog.songIds[0], eventId });
    expect(replay.ok).toBe(true);
    expect(replay.duplicate).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    guest.off('queue:updated', countBroadcast);
    expect(broadcasts).toBe(0);
    expect((await roomRepository.findById(roomId))?.queue).toHaveLength(1);

    await closeSockets(host, guest);
  });

  it('broadcasts queue removals', async () => {
    const host = await harness.connectSocket(hostToken);
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(guest, 'room:join', { roomId });

    const received = awaitEvent<{ queue: SongDto[] }>(guest, 'queue:updated');
    const ack = await emitWithAck<Ack>(host, 'queue:remove', {
      roomId,
      songId: catalog.songIds[0],
      eventId: uniqueEventId('remove'),
    });
    expect(ack.ok).toBe(true);
    expect((await received).queue).toHaveLength(0);
    await closeSockets(host, guest);
  });

  it('rejects queue mutations from a socket that is not in the room', async () => {
    const stranger = await harness.connectSocket(strangerToken);
    const ack = await emitWithAck<Ack>(stranger, 'queue:add', {
      roomId,
      songId: catalog.songIds[1],
      eventId: uniqueEventId('queue'),
    });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('FORBIDDEN');
    await closeSockets(stranger);
  });
});

describe('server-authoritative playback', () => {
  it('propagates play, seek and pause with server timestamps', async () => {
    const host = await harness.connectSocket(hostToken);
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(guest, 'room:join', { roomId });
    await emitWithAck<Ack>(host, 'queue:add', { roomId, songId: catalog.songIds[0], eventId: uniqueEventId('queue') });

    const trackChanged = awaitEvent<{ songId: string }>(guest, 'track:changed');
    const change = await emitWithAck<Ack>(host, 'playback:track', {
      roomId,
      songId: catalog.songIds[0],
      eventId: uniqueEventId('track'),
    });
    expect(change.ok).toBe(true);
    expect((await trackChanged).songId).toBe(catalog.songIds[0]);

    const playState = awaitEvent<NonNullable<Ack['state']>>(guest, 'playback:state');
    const play = await emitWithAck<Ack>(guest, 'playback:play', {
      roomId,
      positionMs: 5_000,
      eventId: uniqueEventId('play'),
    });
    expect(play.ok).toBe(true);
    const state = await playState;
    expect(state.isPlaying).toBe(true);
    expect(state.trackId).toBe(catalog.songIds[0]);
    expect(Math.abs(state.positionMs - 5_000)).toBeLessThan(1_000);
    expect(Math.abs(state.serverTs - Date.now())).toBeLessThan(2_000);

    const seekState = awaitEvent<NonNullable<Ack['state']>>(guest, 'playback:state');
    await emitWithAck<Ack>(host, 'playback:seek', { roomId, positionMs: 12_000, eventId: uniqueEventId('seek') });
    const seeked = await seekState;
    expect(seeked.positionMs).toBe(12_000);
    expect(seeked.isPlaying).toBe(true);

    const pauseState = awaitEvent<NonNullable<Ack['state']>>(guest, 'playback:state');
    await emitWithAck<Ack>(host, 'playback:pause', { roomId, positionMs: 0, eventId: uniqueEventId('pause') });
    const paused = await pauseState;
    expect(paused.isPlaying).toBe(false);
    expect(paused.positionMs).toBeGreaterThanOrEqual(12_000);

    await closeSockets(host, guest);
  });

  it('only lets the host change the track', async () => {
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(guest, 'room:join', { roomId });
    const ack = await emitWithAck<Ack>(guest, 'playback:track', {
      roomId,
      songId: catalog.songIds[1],
      eventId: uniqueEventId('track'),
    });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('FORBIDDEN');
    await closeSockets(guest);
  });

  it('snaps a client that drifted past the threshold and leaves a synced client alone', async () => {
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(guest, 'room:join', { roomId });

    // Anchor playback at ~4s in, playing.
    await emitWithAck<Ack>(guest, 'playback:seek', { roomId, positionMs: 4_000, eventId: uniqueEventId('seek') });
    await emitWithAck<Ack>(guest, 'playback:play', { roomId, positionMs: 4_000, eventId: uniqueEventId('play') });

    const snap = awaitEvent<{ positionMs: number; reason: string }>(guest, 'playback:snap');
    const drifted = await emitWithAck<Ack>(guest, 'playback:report', {
      roomId,
      positionMs: 60_000,
      eventId: uniqueEventId('report'),
    });
    expect(drifted.ok).toBe(true);
    expect(drifted.snapped).toBe(true);
    expect(Math.abs(drifted.driftMs ?? 0)).toBeGreaterThan(750);
    const snapPayload = await snap;
    expect(snapPayload.reason).toBe('drift');
    expect(Math.abs(snapPayload.positionMs - 4_000)).toBeLessThan(3_000);

    // A client that is in sync must not be snapped.
    let snaps = 0;
    const countSnaps = (): void => {
      snaps += 1;
    };
    guest.on('playback:snap', countSnaps);
    const synced = await emitWithAck<Ack>(guest, 'playback:report', {
      roomId,
      positionMs: 4_100,
      eventId: uniqueEventId('report'),
    });
    expect(synced.snapped).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
    guest.off('playback:snap', countSnaps);
    expect(snaps).toBe(0);

    await closeSockets(guest);
  });

  it('treats a replayed playback event as a no-op', async () => {
    const host = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    const eventId = uniqueEventId('pause');
    const first = await emitWithAck<Ack>(host, 'playback:pause', { roomId, positionMs: 1_000, eventId });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBeUndefined();
    const replay = await emitWithAck<Ack>(host, 'playback:pause', { roomId, positionMs: 1_000, eventId });
    expect(replay.duplicate).toBe(true);
    await closeSockets(host);
  });
});

describe('chat', () => {
  it('broadcasts messages to every member and dedupes replays', async () => {
    const host = await harness.connectSocket(hostToken);
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(guest, 'room:join', { roomId });

    const eventId = uniqueEventId('chat');
    const received = awaitEvent<{ message: { body: string; author: { id: string } } }>(host, 'chat:message');
    const ack = await emitWithAck<Ack>(guest, 'chat:message', { roomId, body: 'sounds great', eventId });
    expect(ack.ok).toBe(true);
    const broadcast = await received;
    expect(broadcast.message.body).toBe('sounds great');
    expect(broadcast.message.author.id).toBe(guestId);

    const replay = await emitWithAck<Ack>(guest, 'chat:message', { roomId, body: 'sounds great', eventId });
    expect(replay.ok).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect(replay.message?.id).toBe(ack.message?.id);

    await closeSockets(host, guest);
  });

  it('rejects empty messages and floods', async () => {
    const host = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });

    const empty = await emitWithAck<Ack>(host, 'chat:message', { roomId, body: '   ', eventId: uniqueEventId('chat') });
    expect(empty.error?.code).toBe('VALIDATION_ERROR');

    const codes: (string | undefined)[] = [];
    for (let index = 0; index < 14; index += 1) {
      const ack = await emitWithAck<Ack>(host, 'chat:message', {
        roomId,
        body: `flood ${index}`,
        eventId: uniqueEventId('chat'),
      });
      codes.push(ack.error?.code);
    }
    expect(codes).toContain('RATE_LIMITED');
    await closeSockets(host);
  });
});

describe('presence and reconnect resync', () => {
  it('tracks who is connected, including two tabs for one user', async () => {
    const host = await harness.connectSocket(hostToken);
    const guestTabOne = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });

    const firstPresence = awaitEvent<{ connectedUserIds: string[] }>(host, 'presence');
    await emitWithAck<Ack>(guestTabOne, 'room:join', { roomId });
    const presence = await firstPresence;
    expect(presence.connectedUserIds.sort()).toEqual([guestId, hostId].sort());

    const guestTabTwo = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(guestTabTwo, 'room:join', { roomId });
    expect(harness.server.realtime.presence.socketCount(roomId)).toBe(3);
    expect(harness.server.realtime.presence.connectedUserIds(roomId).sort()).toEqual([guestId, hostId].sort());

    const afterTabClose = awaitEvent<{ connectedUserIds: string[] }>(host, 'presence');
    await closeSockets(guestTabTwo);
    expect((await afterTabClose).connectedUserIds).toContain(guestId);

    const afterGuestLeaves = awaitEvent<{ connectedUserIds: string[] }>(host, 'presence');
    await closeSockets(guestTabOne);
    const remaining = await afterGuestLeaves;
    expect(remaining.connectedUserIds).toEqual([hostId]);

    await closeSockets(host);
  });

  it('resyncs full room state after a forced disconnect', async () => {
    const host = await harness.connectSocket(hostToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(host, 'queue:add', { roomId, songId: catalog.songIds[2], eventId: uniqueEventId('queue') });
    await emitWithAck<Ack>(host, 'playback:track', {
      roomId,
      songId: catalog.songIds[2],
      eventId: uniqueEventId('track'),
    });
    await emitWithAck<Ack>(host, 'playback:play', { roomId, positionMs: 7_000, eventId: uniqueEventId('play') });

    host.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const reconnected = await harness.connectSocket(hostToken);
    const ack = await emitWithAck<Ack>(reconnected, 'room:resync', { roomId });
    expect(ack.ok).toBe(true);
    const room = ack.snapshot?.room as RoomDto;
    expect(room.queue.some((song) => song.id === catalog.songIds[2])).toBe(true);
    expect(room.playback.trackId).toBe(catalog.songIds[2]);
    expect(room.playback.isPlaying).toBe(true);
    expect(room.playback.positionMs).toBeGreaterThanOrEqual(7_000);
    await closeSockets(reconnected);
  });

  it('does not leak events into rooms the socket never joined', async () => {
    const otherRoom = await harness
      .request()
      .post('/api/rooms')
      .set(auth(guestToken))
      .send({ name: 'Isolated Room' })
      .expect(201);
    const otherRoomId = otherRoom.body.room.id as string;

    const host = await harness.connectSocket(hostToken);
    const guest = await harness.connectSocket(guestToken);
    await emitWithAck<Ack>(host, 'room:join', { roomId });
    await emitWithAck<Ack>(guest, 'room:join', { roomId: otherRoomId });

    let leaked = 0;
    const countLeak = (): void => {
      leaked += 1;
    };
    guest.on('chat:message', countLeak);
    await emitWithAck<Ack>(host, 'chat:message', { roomId, body: 'only room one', eventId: uniqueEventId('chat') });
    await new Promise((resolve) => setTimeout(resolve, 200));
    guest.off('chat:message', countLeak);
    expect(leaked).toBe(0);

    await closeSockets(host, guest);
  });
});
