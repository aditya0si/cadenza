import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomStore } from './roomStore';
import { emptyRoomState } from '../room/roomSync';
import { songList } from '../test/fixtures';
import type { MessageDto, RoomDto } from '../types';

type Handler = (payload: unknown) => void;

const harness = vi.hoisted(() => ({
  handlers: new Map<string, Handler[]>(),
  emitted: [] as { event: string; payload: Record<string, unknown> }[],
  acks: new Map<string, unknown>(),
  token: 'test-token' as string | null,
}));

vi.mock('../lib/api', () => ({
  api: { room: vi.fn(), queueTrack: vi.fn(), removeQueuedTrack: vi.fn() },
  getAuthToken: vi.fn(async () => harness.token),
}));

vi.mock('../lib/socket', () => ({
  getSocket: () => ({
    auth: { token: 'test-token' },
    connected: true,
    on: (event: string, handler: Handler) => {
      harness.handlers.set(event, [...(harness.handlers.get(event) ?? []), handler]);
    },
    off: (event: string, handler: Handler) => {
      harness.handlers.set(event, (harness.handlers.get(event) ?? []).filter((entry) => entry !== handler));
    },
  }),
  emitWithAck: async (_socket: unknown, event: string, payload: Record<string, unknown>) => {
    harness.emitted.push({ event, payload });
    return harness.acks.get(event) ?? { ok: true };
  },
  newEventId: (prefix: string) => `${prefix}-fixed`,
}));

const { api } = await import('../lib/api');

const room: RoomDto = {
  id: 'room-1',
  name: 'Realtime Room',
  slug: 'realtime-room-abcd',
  hostId: 'user-1',
  visibility: 'public',
  members: [
    { userId: 'user-1', displayName: 'Host', avatarUrl: null, role: 'host', joinedAt: new Date().toISOString(), connected: true },
  ],
  queue: songList('a'),
  playback: { trackId: 'a', isPlaying: true, positionMs: 1_000, serverTs: new Date().toISOString(), updatedBy: 'user-1' },
  lastActivityAt: new Date().toISOString(),
};

const message = (id: string): MessageDto => ({
  id,
  roomId: 'room-1',
  body: `hello ${id}`,
  createdAt: new Date().toISOString(),
  author: { id: 'user-2', displayName: 'Guest', avatarUrl: null },
});

/** Delivers a server → client event to every handler the store registered. */
const fire = (event: string, payload: unknown): void => {
  for (const handler of harness.handlers.get(event) ?? []) handler(payload);
};

const initial = useRoomStore.getState();

beforeEach(() => {
  harness.handlers.clear();
  harness.emitted.length = 0;
  harness.acks.clear();
  harness.token = 'test-token';
  useRoomStore.setState({ ...initial, ...emptyRoomState }, true);
  vi.clearAllMocks();
});

describe('room store socket wiring', () => {
  it('refuses to connect without a session token', async () => {
    harness.token = null;
    await useRoomStore.getState().connect('room-1');
    expect(useRoomStore.getState().status).toBe('error');
    expect(useRoomStore.getState().error).toMatch(/Sign in/);
    expect(harness.emitted).toHaveLength(0);
  });

  it('joins the room and adopts the snapshot from the ack', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [message('m1')] } });
    await useRoomStore.getState().connect('room-1');

    const join = harness.emitted.find((entry) => entry.event === 'room:join');
    expect(join?.payload.roomId).toBe('room-1');
    const state = useRoomStore.getState();
    expect(state.status).toBe('joined');
    expect(state.roomId).toBe('room-1');
    expect(state.queue.map((song) => song.id)).toEqual(['a']);
    expect(state.messages.map((entry) => entry.id)).toEqual(['m1']);
    expect(state.connectedUserIds).toEqual(['user-1']);
  });

  it('reports a rejected join without touching the room state', async () => {
    harness.acks.set('room:join', { ok: false, error: { code: 'FORBIDDEN', message: 'Join the room before changing its playback' } });
    await useRoomStore.getState().connect('room-1');
    expect(useRoomStore.getState().status).toBe('error');
    expect(useRoomStore.getState().error).toMatch(/Join the room/);
    expect(useRoomStore.getState().queue).toHaveLength(0);
  });

  it('applies playback, queue, chat and presence broadcasts', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');

    fire('playback:state', { trackId: 'b', isPlaying: false, positionMs: 8_000, serverTs: Date.now(), updatedBy: 'user-2' });
    expect(useRoomStore.getState().playback).toMatchObject({ trackId: 'b', isPlaying: false, positionMs: 8_000 });

    fire('queue:updated', { roomId: 'room-1', queue: songList('c', 'd') });
    expect(useRoomStore.getState().queue.map((song) => song.id)).toEqual(['c', 'd']);

    fire('chat:message', { message: message('m2') });
    fire('chat:message', { message: message('m2') });
    expect(useRoomStore.getState().messages.map((entry) => entry.id)).toEqual(['m2']);

    fire('presence', { roomId: 'room-1', connectedUserIds: ['user-1', 'user-2'] });
    expect(useRoomStore.getState().connectedUserIds).toEqual(['user-1', 'user-2']);
  });

  it('counts snaps pushed by the server', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');

    fire('playback:snap', { trackId: 'a', isPlaying: true, positionMs: 2_000, serverTs: Date.now(), updatedBy: null, reason: 'drift' });
    expect(useRoomStore.getState().snapCount).toBe(1);
    expect(useRoomStore.getState().lastSnapReason).toBe('drift');
  });

  it('sends chat with an idempotency key and a client timestamp', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');
    harness.emitted.length = 0;

    await useRoomStore.getState().sendMessage('sounds great');
    const chat = harness.emitted.find((entry) => entry.event === 'chat:message');
    expect(chat?.payload).toMatchObject({ roomId: 'room-1', body: 'sounds great', eventId: 'chat-fixed' });
    expect(typeof chat?.payload.clientSentAt).toBe('number');
  });

  it('routes playback commands through the socket', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');
    harness.emitted.length = 0;

    await useRoomStore.getState().control('seek', 4_000);
    await useRoomStore.getState().changeTrack('b');
    await useRoomStore.getState().addToQueue('c');

    expect(harness.emitted.map((entry) => entry.event)).toEqual(['playback:seek', 'playback:track', 'queue:add']);
    expect(harness.emitted[0]?.payload).toMatchObject({ roomId: 'room-1', positionMs: 4_000, eventId: 'seek-fixed' });
    expect(harness.emitted[1]?.payload).toMatchObject({ songId: 'b', eventId: 'track-fixed' });
    expect(harness.emitted[2]?.payload).toMatchObject({ songId: 'c', eventId: 'queue-fixed' });
  });

  it('surfaces a rejection from a playback command', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');
    harness.acks.set('playback:track', { ok: false, error: { code: 'FORBIDDEN', message: 'Only the room host can change the track' } });

    await useRoomStore.getState().changeTrack('b');
    expect(useRoomStore.getState().error).toMatch(/host/);
  });

  it('falls back to the REST endpoints when no socket is attached', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [] } });
    await useRoomStore.getState().connect('room-1');
    useRoomStore.getState().disconnect();
    useRoomStore.setState({ roomId: 'room-1' });
    harness.emitted.length = 0;

    vi.mocked(api.queueTrack).mockResolvedValueOnce({ room: { ...room, queue: songList('z') }, duplicate: false });
    await useRoomStore.getState().addToQueue('z');
    expect(api.queueTrack).toHaveBeenCalledWith('room-1', 'z', 'queue-fixed');
    expect(useRoomStore.getState().queue.map((song) => song.id)).toEqual(['z']);
    expect(harness.emitted).toHaveLength(0);

    vi.mocked(api.removeQueuedTrack).mockResolvedValueOnce({ room: { ...room, queue: [] }, duplicate: false });
    await useRoomStore.getState().removeFromQueue('z');
    expect(api.removeQueuedTrack).toHaveBeenCalledWith('room-1', 'z', 'remove-fixed');
    expect(useRoomStore.getState().queue).toHaveLength(0);
  });

  it('resets everything on disconnect', async () => {
    harness.acks.set('room:join', { ok: true, snapshot: { room, messages: [message('m1')] } });
    await useRoomStore.getState().connect('room-1');
    harness.emitted.length = 0;

    useRoomStore.getState().disconnect();
    expect(harness.emitted[0]).toMatchObject({ event: 'room:leave' });
    const state = useRoomStore.getState();
    expect(state.roomId).toBeNull();
    expect(state.messages).toHaveLength(0);
    expect(state.status).toBe('idle');
  });
});
