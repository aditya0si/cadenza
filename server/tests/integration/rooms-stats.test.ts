import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { Types } from 'mongoose';
import { createTestHarness, type TestHarness } from '../helpers/harness.js';
import { createRoom, seedCatalog, uniqueEventId, type SeededCatalog } from '../helpers/factory.js';
import { messageRepository } from '../../src/repositories/message.repository.js';
import { Message } from '../../src/models/index.js';
import { roomRepository } from '../../src/repositories/room.repository.js';
import type { RoomDto } from '../../src/http/serializers.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;
let catalog: SeededCatalog;
let hostToken: string;
let guestToken: string;
let strangerToken: string;
let adminToken: string;
let hostId: string;
let guestId: string;

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  catalog = await seedCatalog(3);
  const host = await harness.signIn('host@cadenza.test', 'Room Host');
  const guest = await harness.signIn('guest@cadenza.test', 'Room Guest');
  ({ token: strangerToken } = await harness.signIn('stranger@cadenza.test', 'Stranger'));
  ({ token: adminToken } = await harness.signIn('admin@cadenza.test', 'Cadenza Admin'));
  hostToken = host.token;
  guestToken = guest.token;
  hostId = host.user.id;
  guestId = guest.user.id;
});

afterAll(async () => {
  await harness.close();
});

const createRoomViaApi = async (name: string, visibility: 'public' | 'private' = 'public'): Promise<RoomDto> => {
  const response = await harness
    .request()
    .post('/api/rooms')
    .set(auth(hostToken))
    .send({ name, visibility })
    .expect(201);
  return response.body.room as RoomDto;
};

describe('room lifecycle', () => {
  it('requires a session to create a room and validates the name', async () => {
    await harness.request().post('/api/rooms').send({ name: 'No auth' }).expect(401);
    await harness.request().post('/api/rooms').set(auth(hostToken)).send({ name: 'x' }).expect(400);
  });

  it('makes the creator the host member with an empty queue', async () => {
    const room = await createRoomViaApi('Friday Listening');
    expect(room.hostId).toBe(hostId);
    expect(room.members).toHaveLength(1);
    expect(room.members[0]).toMatchObject({ userId: hostId, role: 'host' });
    expect(room.queue).toEqual([]);
    expect(room.playback.isPlaying).toBe(false);
    expect(room.slug).toMatch(/^friday-listening-[0-9a-f]{4}$/);
  });

  it('joins idempotently and reports members to the host', async () => {
    const room = await createRoomViaApi('Joinable');
    const joined = await harness.request().post(`/api/rooms/${room.id}/join`).set(auth(guestToken)).expect(200);
    expect(joined.body.room.members).toHaveLength(2);

    const again = await harness.request().post(`/api/rooms/${room.id}/join`).set(auth(guestToken)).expect(200);
    expect(again.body.room.members).toHaveLength(2);
    expect((await roomRepository.findById(room.id))?.members).toHaveLength(2);
  });

  it('hides private rooms from non-members but allows public viewing', async () => {
    const privateRoom = await createRoomViaApi('Invite Only', 'private');
    const denied = await harness.request().get(`/api/rooms/${privateRoom.id}`).set(auth(strangerToken)).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    const publicRoom = await createRoomViaApi('Open Deck', 'public');
    await harness.request().get(`/api/rooms/${publicRoom.id}`).set(auth(strangerToken)).expect(200);
  });

  it('hands the host role over when the host leaves', async () => {
    const room = await createRoomViaApi('Handover');
    await harness.request().post(`/api/rooms/${room.id}/join`).set(auth(guestToken)).expect(200);

    const left = await harness.request().post(`/api/rooms/${room.id}/leave`).set(auth(hostToken)).expect(200);
    expect(left.body.promoted).toBe(guestId);
    expect(left.body.room.hostId).toBe(guestId);
    const promoted = left.body.room.members.find((member: { userId: string }) => member.userId === guestId);
    expect(promoted.role).toBe('host');
  });

  it('refuses to let a non-member leave', async () => {
    const room = await createRoomViaApi('Leave Guard');
    const response = await harness.request().post(`/api/rooms/${room.id}/leave`).set(auth(strangerToken)).expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('lets a member leave a private room and answers with the room metadata', async () => {
    // Regression: `leave` used to re-read the snapshot *after* removing the
    // membership, so a private room answered 403 to the member who was leaving it.
    const room = await createRoomViaApi('Private Exit', 'private');
    const left = await harness.request().post(`/api/rooms/${room.id}/leave`).set(auth(hostToken)).expect(200);
    expect(left.body.room.id).toBe(room.id);
    expect(left.body.room.members).toEqual([]);
  });

  it('keeps a public room’s chat member-only while its metadata stays readable', async () => {
    const room = await createRoomViaApi('Open Mic');
    await messageRepository.create({
      roomId: new Types.ObjectId(room.id),
      authorId: new Types.ObjectId(hostId),
      body: 'members only',
      eventId: 'public-chat-1',
    });

    // A non-member gets the browse view: metadata and queue, never the chat.
    const snapshot = await harness.request().get(`/api/rooms/${room.id}`).set(auth(strangerToken)).expect(200);
    expect(snapshot.body.room.id).toBe(room.id);
    expect(snapshot.body.room.members).toHaveLength(1);
    expect(snapshot.body.messages).toEqual([]);

    // And the message-history endpoint is member-only, like the socket path.
    const denied = await harness
      .request()
      .get(`/api/rooms/${room.id}/messages`)
      .set(auth(strangerToken))
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');

    // A member sees both.
    const asMember = await harness.request().get(`/api/rooms/${room.id}/messages`).set(auth(hostToken)).expect(200);
    expect(asMember.body.items.map((message: { body: string }) => message.body)).toEqual(['members only']);
    const memberSnapshot = await harness.request().get(`/api/rooms/${room.id}`).set(auth(hostToken)).expect(200);
    expect(memberSnapshot.body.messages.map((message: { body: string }) => message.body)).toEqual(['members only']);
  });

  it('lists only public rooms and can filter to active ones', async () => {
    const response = await harness.request().get('/api/rooms?limit=50').set(auth(strangerToken)).expect(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items.every((room: { visibility: string }) => room.visibility === 'public')).toBe(true);

    const active = await harness.request().get('/api/rooms?activeOnly=true&limit=50').set(auth(strangerToken)).expect(200);
    expect(active.body.items.every((room: { lastActivityAt: string }) => new Date(room.lastActivityAt).getTime() > Date.now() - 3_600_000)).toBe(true);
  });
});

describe('room queue over REST', () => {
  let roomId: string;

  beforeAll(async () => {
    roomId = (await createRoomViaApi('Queue Ops')).id;
    await harness.request().post(`/api/rooms/${roomId}/join`).set(auth(guestToken)).expect(200);
  });

  it('rejects queue writes from non-members', async () => {
    const response = await harness
      .request()
      .post(`/api/rooms/${roomId}/queue`)
      .set(auth(strangerToken))
      .send({ songId: catalog.songIds[0], eventId: uniqueEventId('queue') })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('adds a track and treats a replayed event id as a duplicate', async () => {
    const eventId = uniqueEventId('queue');
    const added = await harness
      .request()
      .post(`/api/rooms/${roomId}/queue`)
      .set(auth(guestToken))
      .send({ songId: catalog.songIds[0], eventId })
      .expect(201);
    expect(added.body.duplicate).toBe(false);
    expect(added.body.room.queue).toHaveLength(1);
    expect(added.body.song.id).toBe(catalog.songIds[0]);

    const replay = await harness
      .request()
      .post(`/api/rooms/${roomId}/queue`)
      .set(auth(guestToken))
      .send({ songId: catalog.songIds[0], eventId })
      .expect(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.room.queue).toHaveLength(1);
    expect((await roomRepository.findById(roomId))?.queue).toHaveLength(1);
  });

  it('rejects an unknown track and a malformed event id', async () => {
    await harness
      .request()
      .post(`/api/rooms/${roomId}/queue`)
      .set(auth(hostToken))
      .send({ songId: '6ab11ab1549716cf3bd88199', eventId: uniqueEventId('queue') })
      .expect(404);

    const malformed = await harness
      .request()
      .post(`/api/rooms/${roomId}/queue`)
      .set(auth(hostToken))
      .send({ songId: catalog.songIds[1], eventId: 'short' })
      .expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('removes a track and 404s when it is not queued', async () => {
    const removed = await harness
      .request()
      .delete(`/api/rooms/${roomId}/queue/${catalog.songIds[0]}`)
      .set(auth(hostToken))
      .send({ songId: catalog.songIds[0], eventId: uniqueEventId('remove') })
      .expect(200);
    expect(removed.body.removed).toBe(true);
    expect(removed.body.room.queue).toHaveLength(0);

    const missing = await harness
      .request()
      .delete(`/api/rooms/${roomId}/queue/${catalog.songIds[0]}`)
      .set(auth(hostToken))
      .send({ songId: catalog.songIds[0], eventId: uniqueEventId('remove') })
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('keys idempotency per member, so a shared event id is never swallowed', async () => {
    const room = (await createRoomViaApi('Shared Keys')).id;
    await harness.request().post(`/api/rooms/${room}/join`).set(auth(guestToken)).expect(200);

    // Two clients can generate the same event id; each one is its own event.
    const eventId = uniqueEventId('shared');
    const guestAdd = await harness
      .request()
      .post(`/api/rooms/${room}/queue`)
      .set(auth(guestToken))
      .send({ songId: catalog.songIds[0], eventId })
      .expect(201);
    expect(guestAdd.body.duplicate).toBe(false);

    const hostAdd = await harness
      .request()
      .post(`/api/rooms/${room}/queue`)
      .set(auth(hostToken))
      .send({ songId: catalog.songIds[1], eventId })
      .expect(201);
    expect(hostAdd.body.duplicate).toBe(false);
    expect(hostAdd.body.room.queue).toHaveLength(2);

    // Each client's own replay is still a no-op.
    const replay = await harness
      .request()
      .post(`/api/rooms/${room}/queue`)
      .set(auth(guestToken))
      .send({ songId: catalog.songIds[0], eventId })
      .expect(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.room.queue).toHaveLength(2);
  });

  it('answers an oversized JSON body with 413, not 500', async () => {
    const response = await harness
      .request()
      .post('/api/rooms')
      .set(auth(hostToken))
      .send({ name: 'x'.repeat(1_200_000) })
      .expect(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.body.error.message).toMatch(/1 MB/);
  });
});

describe('chat history pagination', () => {
  let roomId: string;

  beforeAll(async () => {
    roomId = (await createRoomViaApi('Chatty')).id;
    for (let index = 0; index < 5; index += 1) {
      await messageRepository.create({
        roomId: new Types.ObjectId(roomId),
        authorId: new Types.ObjectId(hostId),
        body: `message ${index}`,
        eventId: `history-${index}`,
      });
    }
  });

  it('pages backwards with a cursor and no overlap', async () => {
    const first = await harness
      .request()
      .get(`/api/rooms/${roomId}/messages?limit=2`)
      .set(auth(hostToken))
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.items[0].body).toBe('message 4');
    expect(first.body.items[1].body).toBe('message 3');

    const second = await harness
      .request()
      .get(`/api/rooms/${roomId}/messages?limit=2&before=${encodeURIComponent(first.body.nextBefore)}`)
      .set(auth(hostToken))
      .expect(200);
    expect(second.body.items.map((message: { body: string }) => message.body)).toEqual(['message 2', 'message 1']);

    const third = await harness
      .request()
      .get(`/api/rooms/${roomId}/messages?limit=2&before=${encodeURIComponent(second.body.nextBefore)}`)
      .set(auth(hostToken))
      .expect(200);
    expect(third.body.items.map((message: { body: string }) => message.body)).toEqual(['message 0']);
    expect(third.body.hasMore).toBe(false);
    expect(third.body.nextBefore).toBeNull();
  });

  it('rejects an unparseable cursor', async () => {
    const response = await harness
      .request()
      .get(`/api/rooms/${roomId}/messages?before=last-tuesday`)
      .set(auth(hostToken))
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a timestamp-only cursor instead of half-honouring it', async () => {
    // A bare timestamp cannot say *which* message a page ended on, so it cannot
    // express a position inside a group of same-millisecond messages: honouring
    // it would either re-serve or silently skip that group.
    const response = await harness
      .request()
      .get(`/api/rooms/${roomId}/messages?before=${encodeURIComponent('2026-01-01T00:00:00.000Z')}`)
      .set(auth(hostToken))
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('chat history ordering when timestamps tie', () => {
  /**
   * Wall-clock time cannot order two messages written in the same millisecond,
   * so history order has to fall back to a stable key (`_id`) — and the
   * pagination cursor has to carry that key too, or a page boundary landing
   * inside a tie group skips the rest of it. This is the defect the Linux CI
   * runner exposed: there the five seeded messages landed in the same
   * millisecond, the tie order was undefined, and page two came back in the
   * wrong order. Every timestamp here is set explicitly, so the tie is real on
   * every platform and every run — nothing depends on how fast the machine is.
   */
  const olderTie = new Date('2025-12-31T23:59:59.500Z');
  const newerTie = new Date('2026-01-01T00:00:00.000Z');
  /** Newest first: newer group, then `_id` descending inside a group. */
  const expectedOrder = ['tie-new-1', 'tie-new-0', 'tie-old-2', 'tie-old-1', 'tie-old-0'];
  let roomId: string;

  /**
   * Hand-built message id: 4 bytes of the row's own timestamp, 5 fixed bytes,
   * then a counter — so a higher `index` always sorts higher, independent of
   * the clock and of which platform the suite runs on.
   */
  const tiedObjectId = (createdAt: Date, index: number): Types.ObjectId =>
    new Types.ObjectId(
      `${Math.floor(createdAt.getTime() / 1000)
        .toString(16)
        .padStart(8, '0')}${'00'.repeat(5)}${index.toString(16).padStart(6, '0')}`,
    );

  beforeAll(async () => {
    roomId = (await createRoomViaApi('Tied Timestamps')).id;
    const createdAtByIndex = [olderTie, olderTie, olderTie, newerTie, newerTie];
    await Message.create(
      expectedOrder
        .slice()
        .reverse()
        .map((body, index) => ({
          _id: tiedObjectId(createdAtByIndex[index] as Date, index),
          roomId: new Types.ObjectId(roomId),
          authorId: new Types.ObjectId(hostId),
          body,
          eventId: `tie-${index}`,
          createdAt: createdAtByIndex[index] as Date,
        })),
    );

    // Guard the fixture itself: if the timestamps are not tied the way this
    // test claims, the assertions below would prove nothing. Two timestamps,
    // shared by exactly three and two rows.
    const stored = await Message.find({ roomId: new Types.ObjectId(roomId) })
      .select('createdAt')
      .lean<{ createdAt: Date }[]>();
    const sharing = (timestamp: Date) => stored.filter((row) => row.createdAt.getTime() === timestamp.getTime()).length;
    expect([sharing(olderTie), sharing(newerTie)]).toEqual([3, 2]);
  });

  const historyPage = async (cursor: string | null, limit: number) =>
    (
      await harness
        .request()
        .get(
          `/api/rooms/${roomId}/messages?limit=${limit}${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
        )
        .set(auth(hostToken))
        .expect(200)
    ).body as { items: { body: string }[]; nextBefore: string | null; hasMore: boolean };

  const bodiesOf = (page: { items: { body: string }[] }) => page.items.map((message) => message.body);

  it('orders same-millisecond messages deterministically and pages across the tie', async () => {
    const first = await historyPage(null, 2);
    expect(bodiesOf(first)).toEqual(['tie-new-1', 'tie-new-0']);
    expect(first.hasMore).toBe(true);

    const second = await historyPage(first.nextBefore, 2);
    expect(bodiesOf(second)).toEqual(['tie-old-2', 'tie-old-1']);
    expect(second.hasMore).toBe(true);

    // This page boundary sits *inside* the older tie group: a cursor carrying
    // only `createdAt` cannot express it, and the remaining message disappears.
    const third = await historyPage(second.nextBefore, 2);
    expect(bodiesOf(third)).toEqual(['tie-old-0']);
    expect(third.hasMore).toBe(false);
    expect(third.nextBefore).toBeNull();

    // Same cursor, same page: the order is stable, not merely "whatever Mongo
    // happened to return this time".
    const repeated = await historyPage(first.nextBefore, 2);
    expect(bodiesOf(repeated)).toEqual(bodiesOf(second));

    // No overlap, no gap: walking the pages yields every message exactly once.
    expect([...bodiesOf(first), ...bodiesOf(second), ...bodiesOf(third)]).toEqual(expectedOrder);
  });

  it('walks a single tie group one message at a time with a distinct cursor per message', async () => {
    const tiedRoom = (await createRoomViaApi('One Millisecond')).id;
    // Ids are offset from the previous group's: `_id` is unique per collection,
    // not per room, and the walk below must not share rows with that test.
    await Message.create(
      ['same-ms-0', 'same-ms-1', 'same-ms-2'].map((body, index) => ({
        _id: tiedObjectId(olderTie, index + 0x10),
        roomId: new Types.ObjectId(tiedRoom),
        authorId: new Types.ObjectId(hostId),
        body,
        eventId: `same-ms-${index}`,
        createdAt: olderTie,
      })),
    );

    const page = async (cursor: string | null) =>
      (
        await harness
          .request()
          .get(`/api/rooms/${tiedRoom}/messages?limit=1${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`)
          .set(auth(hostToken))
          .expect(200)
      ).body as { items: { body: string }[]; nextBefore: string | null; hasMore: boolean };

    const first = await page(null);
    expect(bodiesOf(first)).toEqual(['same-ms-2']);
    const second = await page(first.nextBefore);
    expect(bodiesOf(second)).toEqual(['same-ms-1']);
    const third = await page(second.nextBefore);
    expect(bodiesOf(third)).toEqual(['same-ms-0']);
    expect(third.hasMore).toBe(false);
    expect(third.nextBefore).toBeNull();

    // Three rows share one timestamp, yet each page ends on a *different*
    // message: the cursors must differ, otherwise the walk cannot advance.
    expect(first.nextBefore).not.toBe(second.nextBefore);
  });
});

describe('admin statistics', () => {
  beforeAll(async () => {
    // Produce real play events through the public endpoint.
    for (const songId of catalog.songIds.slice(0, 2)) {
      await harness
        .request()
        .post(`/api/songs/${songId}/play`)
        .set(auth(hostToken))
        .send({ source: 'library' })
        .expect(201);
    }
    const roomId = await createRoom({ hostId, name: 'Stats Room', queueSongIds: [catalog.songIds[0] as string] });
    expect(roomId).toBeTruthy();
  });

  it('denies listeners and allows admins', async () => {
    for (const path of ['/api/stats/overview', '/api/stats/plays', '/api/stats/top-tracks', '/api/stats/active-rooms']) {
      const denied = await harness.request().get(path).set(auth(hostToken)).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN');
      await harness.request().get(path).set(auth(adminToken)).expect(200);
    }
    await harness.request().get('/api/stats/overview').expect(401);
  });

  it('reports an overview that matches the real collections', async () => {
    const response = await harness.request().get('/api/stats/overview').set(auth(adminToken)).expect(200);
    expect(response.body.songs).toBeGreaterThanOrEqual(3);
    expect(response.body.artists).toBeGreaterThanOrEqual(1);
    expect(response.body.users).toBeGreaterThanOrEqual(4);
    expect(response.body.playEvents).toBeGreaterThanOrEqual(2);
    expect(response.body.activeRooms).toBeGreaterThanOrEqual(1);
  });

  it('returns a real plays-over-time series including today', async () => {
    const response = await harness.request().get('/api/stats/plays?days=7').set(auth(adminToken)).expect(200);
    expect(response.body.days).toBe(7);
    expect(response.body.buckets.length).toBeGreaterThanOrEqual(1);
    const today = new Date().toISOString().slice(0, 10);
    const todayBucket = response.body.buckets.find((bucket: { date: string }) => bucket.date === today);
    expect(todayBucket).toBeTruthy();
    expect(todayBucket.plays).toBeGreaterThanOrEqual(2);
  });

  it('ranks top tracks by real play counts', async () => {
    const response = await harness.request().get('/api/stats/top-tracks?limit=3').set(auth(adminToken)).expect(200);
    expect(response.body.tracks.length).toBeGreaterThanOrEqual(1);
    const first = response.body.tracks[0];
    expect(first.plays).toBeGreaterThanOrEqual(1);
    expect(first.title).toBeTruthy();
    expect(first.artistName).toBe('Test Signal');
    expect(first.coverUrl).toBe(`/api/media/cover/song/${first.songId}`);
  });

  it('lists active rooms with their current track', async () => {
    const response = await harness.request().get('/api/stats/active-rooms?limit=5').set(auth(adminToken)).expect(200);
    expect(response.body.rooms.length).toBeGreaterThanOrEqual(1);
    const statsRoom = response.body.rooms.find((room: { name: string }) => room.name === 'Stats Room');
    expect(statsRoom).toBeTruthy();
    expect(statsRoom.nowPlaying?.title).toBe('Neon Rain');
    expect(statsRoom.memberCount).toBe(1);
    expect(statsRoom.queueLength).toBe(1);
  });
});
