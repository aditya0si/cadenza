import { describe, expect, it } from 'vitest';
import { computeDrift, emptyRoomState, projectRoomPosition, roomReducer, type RoomPlayback, type RoomSyncState } from './roomSync';
import type { MessageDto, RoomDto } from '../types';
import { songList } from '../test/fixtures';

const NOW = 1_760_000_000_000;

const playback = (overrides: Partial<RoomPlayback> = {}): RoomPlayback => ({
  trackId: 'a',
  isPlaying: true,
  positionMs: 10_000,
  serverTs: NOW - 2_000,
  updatedBy: 'user-1',
  ...overrides,
});

const room = (overrides: Partial<RoomDto> = {}): RoomDto => ({
  id: 'room-1',
  name: 'Realtime Room',
  slug: 'realtime-room-abcd',
  hostId: 'user-1',
  visibility: 'public',
  members: [
    { userId: 'user-1', displayName: 'Host', avatarUrl: null, role: 'host', joinedAt: new Date(NOW).toISOString(), connected: true },
    { userId: 'user-2', displayName: 'Guest', avatarUrl: null, role: 'member', joinedAt: new Date(NOW).toISOString(), connected: false },
  ],
  queue: songList('a', 'b'),
  playback: {
    trackId: 'a',
    isPlaying: true,
    positionMs: 10_000,
    serverTs: new Date(NOW - 2_000).toISOString(),
    updatedBy: 'user-1',
  },
  lastActivityAt: new Date(NOW).toISOString(),
  ...overrides,
});

const message = (id: string, body = 'hello'): MessageDto => ({
  id,
  roomId: 'room-1',
  body,
  createdAt: new Date(NOW).toISOString(),
  author: { id: 'user-2', displayName: 'Guest', avatarUrl: null },
});

describe('projectRoomPosition', () => {
  it('projects forward while playing', () => {
    expect(projectRoomPosition(playback(), NOW)).toBe(12_000);
  });

  it('freezes while paused', () => {
    expect(projectRoomPosition(playback({ isPlaying: false }), NOW + 30_000)).toBe(10_000);
  });

  it('never projects backwards or below zero', () => {
    expect(projectRoomPosition(playback({ serverTs: NOW + 5_000 }), NOW)).toBe(10_000);
    expect(projectRoomPosition(playback({ positionMs: -100 }), NOW)).toBe(2_000);
  });
});

describe('computeDrift', () => {
  it('reports how far the local clock is from the server clock', () => {
    expect(computeDrift(12_400, playback(), NOW)).toBe(400);
    expect(computeDrift(9_000, playback(), NOW)).toBe(-3_000);
  });
});

describe('roomReducer', () => {
  it('adopts the full server snapshot on join', () => {
    const state = roomReducer(emptyRoomState, {
      type: 'room:snapshot',
      payload: { room: room(), messages: [message('m1')] },
    });
    expect(state.status).toBe('joined');
    expect(state.roomId).toBe('room-1');
    expect(state.queue.map((song) => song.id)).toEqual(['a', 'b']);
    expect(state.playback.trackId).toBe('a');
    expect(state.messages).toHaveLength(1);
    // Presence is derived from the snapshot's connected flags.
    expect(state.connectedUserIds).toEqual(['user-1']);
  });

  it('replaces the playback anchor on every playback:state event', () => {
    const base = roomReducer(emptyRoomState, { type: 'room:snapshot', payload: { room: room(), messages: [] } });
    const next = roomReducer(base, {
      type: 'playback:state',
      payload: playback({ isPlaying: false, positionMs: 3_000 }),
    });
    expect(next.playback.isPlaying).toBe(false);
    expect(next.playback.positionMs).toBe(3_000);
    expect(next.driftMs).toBeNull();
  });

  it('counts snaps and clears drift when the server corrects this client', () => {
    const base: RoomSyncState = { ...emptyRoomState, driftMs: 9_000 };
    const next = roomReducer(base, {
      type: 'playback:snap',
      payload: { ...playback({ positionMs: 4_000 }), reason: 'drift' },
    });
    expect(next.snapCount).toBe(1);
    expect(next.lastSnapReason).toBe('drift');
    expect(next.driftMs).toBe(0);
    expect(next.playback.positionMs).toBe(4_000);
  });

  it('replaces the queue (and mirrors it onto the room) on queue:updated', () => {
    const base = roomReducer(emptyRoomState, { type: 'room:snapshot', payload: { room: room(), messages: [] } });
    const next = roomReducer(base, { type: 'queue:updated', payload: { queue: songList('c') } });
    expect(next.queue.map((song) => song.id)).toEqual(['c']);
    expect(next.room?.queue.map((song) => song.id)).toEqual(['c']);
  });

  it('appends chat messages exactly once', () => {
    let state = roomReducer(emptyRoomState, { type: 'chat:message', payload: { message: message('m1') } });
    state = roomReducer(state, { type: 'chat:message', payload: { message: message('m1') } });
    state = roomReducer(state, { type: 'chat:message', payload: { message: message('m2', 'second') } });
    expect(state.messages.map((entry) => entry.id)).toEqual(['m1', 'm2']);
  });

  it('caps the retained chat history', () => {
    let state = emptyRoomState;
    for (let index = 0; index < 260; index += 1) {
      state = roomReducer(state, { type: 'chat:message', payload: { message: message(`m${index}`) } });
    }
    expect(state.messages).toHaveLength(200);
    expect(state.messages[0]?.id).toBe('m60');
    expect(state.messages[199]?.id).toBe('m259');
  });

  it('tracks presence, drift reports and errors', () => {
    let state = roomReducer(emptyRoomState, { type: 'presence', payload: { connectedUserIds: ['user-1', 'user-2'] } });
    state = roomReducer(state, { type: 'drift:report', payload: { driftMs: -120 } });
    state = roomReducer(state, { type: 'status', payload: { status: 'error', error: 'Only the host can change the track' } });
    expect(state.connectedUserIds).toEqual(['user-1', 'user-2']);
    expect(state.driftMs).toBe(-120);
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/host/);
  });

  it('resets to the initial state on leave', () => {
    const base = roomReducer(emptyRoomState, { type: 'room:snapshot', payload: { room: room(), messages: [message('m1')] } });
    expect(roomReducer(base, { type: 'reset' })).toEqual(emptyRoomState);
  });
});
