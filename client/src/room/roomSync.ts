import type { MessageDto, RoomDto, SongDto } from '../types';

/**
 * Playback state as the client keeps it: `serverTs` is normalised to epoch
 * milliseconds (the REST DTO carries an ISO string, socket payloads carry a
 * number) so the clock arithmetic below has exactly one representation.
 */
export interface RoomPlayback {
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  serverTs: number;
  updatedBy: string | null;
}

export interface RoomSyncState {
  roomId: string | null;
  room: RoomDto | null;
  messages: MessageDto[];
  connectedUserIds: string[];
  playback: RoomPlayback;
  queue: SongDto[];
  status: 'idle' | 'joining' | 'joined' | 'error';
  error: string | null;
  /** Last drift the server reported for this client, in milliseconds. */
  driftMs: number | null;
  /** Incremented every time the server snaps this client back. */
  snapCount: number;
  lastSnapReason: string | null;
}

export const emptyRoomState: RoomSyncState = {
  roomId: null,
  room: null,
  messages: [],
  connectedUserIds: [],
  playback: { trackId: null, isPlaying: false, positionMs: 0, serverTs: 0, updatedBy: null },
  queue: [],
  status: 'idle',
  error: null,
  driftMs: null,
  snapCount: 0,
  lastSnapReason: null,
};

export const MESSAGE_LIMIT = 200;

export type RoomEvent =
  | { type: 'room:snapshot'; payload: { room: RoomDto; messages: MessageDto[] } }
  | { type: 'playback:state'; payload: RoomPlayback }
  | { type: 'playback:snap'; payload: RoomPlayback & { reason: string } }
  | { type: 'queue:updated'; payload: { queue: SongDto[] } }
  | { type: 'chat:message'; payload: { message: MessageDto } }
  | { type: 'presence'; payload: { connectedUserIds: string[] } }
  | { type: 'drift:report'; payload: { driftMs: number } }
  | { type: 'status'; payload: { status: RoomSyncState['status']; error?: string | null } }
  | { type: 'reset' };

/** Where playback should be right now, derived from the server anchor. */
export function projectRoomPosition(playback: RoomPlayback, now: number = Date.now()): number {
  const base = Math.max(0, playback.positionMs);
  if (!playback.isPlaying) return base;
  const elapsed = Math.max(0, now - playback.serverTs);
  return base + elapsed;
}

export function computeDrift(localPositionMs: number, playback: RoomPlayback, now: number = Date.now()): number {
  return Math.round(localPositionMs - projectRoomPosition(playback, now));
}

/** Chat is append-only and de-duplicated by message id. */
function appendMessage(messages: MessageDto[], message: MessageDto): MessageDto[] {
  if (messages.some((existing) => existing.id === message.id)) return messages;
  const next = [...messages, message];
  return next.length > MESSAGE_LIMIT ? next.slice(next.length - MESSAGE_LIMIT) : next;
}

export function roomReducer(state: RoomSyncState, event: RoomEvent): RoomSyncState {
  switch (event.type) {
    case 'room:snapshot':
      return {
        ...state,
        roomId: event.payload.room.id,
        room: event.payload.room,
        queue: event.payload.room.queue,
        playback: {
          trackId: event.payload.room.playback.trackId,
          isPlaying: event.payload.room.playback.isPlaying,
          positionMs: event.payload.room.playback.positionMs,
          serverTs: Date.parse(event.payload.room.playback.serverTs),
          updatedBy: event.payload.room.playback.updatedBy,
        },
        messages: event.payload.messages.slice(-MESSAGE_LIMIT),
        connectedUserIds: event.payload.room.members.filter((member) => member.connected).map((member) => member.userId),
        status: 'joined',
        error: null,
      };

    case 'playback:state':
      return {
        ...state,
        playback: {
          trackId: event.payload.trackId,
          isPlaying: event.payload.isPlaying,
          positionMs: event.payload.positionMs,
          serverTs: event.payload.serverTs,
          updatedBy: event.payload.updatedBy,
        },
        driftMs: null,
      };

    case 'playback:snap':
      return {
        ...state,
        playback: {
          trackId: event.payload.trackId,
          isPlaying: event.payload.isPlaying,
          positionMs: event.payload.positionMs,
          serverTs: event.payload.serverTs,
          updatedBy: event.payload.updatedBy,
        },
        snapCount: state.snapCount + 1,
        lastSnapReason: event.payload.reason,
        driftMs: 0,
      };

    case 'queue:updated':
      return { ...state, queue: event.payload.queue, room: state.room ? { ...state.room, queue: event.payload.queue } : null };

    case 'chat:message':
      return { ...state, messages: appendMessage(state.messages, event.payload.message) };

    case 'presence':
      return { ...state, connectedUserIds: [...event.payload.connectedUserIds] };

    case 'drift:report':
      return { ...state, driftMs: event.payload.driftMs };

    case 'status':
      return { ...state, status: event.payload.status, error: event.payload.error ?? null };

    case 'reset':
      return emptyRoomState;

    default:
      return state;
  }
}
