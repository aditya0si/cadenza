import { create } from 'zustand';
import { api, getAuthToken } from '../lib/api';
import {
  emitWithAck,
  getSocket,
  newEventId,
  type CadenzaSocket,
  type PlaybackStatePayload,
  type RoomSnapshotPayload,
} from '../lib/socket';
import { emptyRoomState, roomReducer, type RoomEvent, type RoomSyncState } from '../room/roomSync';

interface RoomActions {
  /** Opens the socket, joins the room and keeps the store in sync with the server. */
  connect: (roomId: string) => Promise<void>;
  disconnect: () => void;
  /** REST-only snapshot (used when the socket is not connected yet). */
  loadSnapshot: (roomId: string) => Promise<void>;
  sendMessage: (body: string) => Promise<void>;
  addToQueue: (songId: string) => Promise<void>;
  removeFromQueue: (songId: string) => Promise<void>;
  control: (action: 'play' | 'pause' | 'seek', positionMs: number) => Promise<void>;
  changeTrack: (songId: string) => Promise<void>;
  reportPosition: (positionMs: number) => void;
  clearError: () => void;
}

type RoomStore = RoomSyncState & RoomActions;

let socket: CadenzaSocket | null = null;
const listeners: Array<[string, (...args: never[]) => void]> = [];

const detachListeners = (): void => {
  if (!socket) return;
  for (const [event, handler] of listeners) {
    (socket as unknown as { off: (name: string, fn: (...args: never[]) => void) => void }).off(event, handler);
  }
  listeners.length = 0;
};

/**
 * Room state is *server-authoritative*: the socket is the only writer of
 * playback/queue/chat state, and every mutation carries a client event id so a
 * reconnect cannot double-apply it. The reducer (`roomSync.ts`) is pure, so the
 * sync rules are unit-tested without a socket.
 */
export const useRoomStore = create<RoomStore>((set, get) => {
  const dispatch = (event: RoomEvent): void => {
    set((state) => roomReducer(state as RoomSyncState, event) as Partial<RoomStore>);
  };

  return {
    ...emptyRoomState,

    async loadSnapshot(roomId) {
      const response = await api.room(roomId);
      dispatch({ type: 'room:snapshot', payload: response });
    },

    async connect(roomId) {
      const token = await getAuthToken();
      if (!token) {
        dispatch({ type: 'status', payload: { status: 'error', error: 'Sign in to join a listening room' } });
        return;
      }
      dispatch({ type: 'status', payload: { status: 'joining' } });

      detachListeners();
      socket = getSocket(token);

      const on = <T,>(event: string, handler: (payload: T) => void): void => {
        const typed = handler as unknown as (...args: never[]) => void;
        listeners.push([event, typed]);
        (socket as unknown as { on: (name: string, fn: (...args: never[]) => void) => void }).on(event, typed);
      };

      on<RoomSnapshotPayload>('room:snapshot', (payload) => dispatch({ type: 'room:snapshot', payload }));
      on<PlaybackStatePayload>('playback:state', (payload) => dispatch({ type: 'playback:state', payload }));
      on<PlaybackStatePayload & { reason: string }>('playback:snap', (payload) =>
        dispatch({ type: 'playback:snap', payload }),
      );
      on<{ queue: RoomSyncState['queue'] }>('queue:updated', (payload) => dispatch({ type: 'queue:updated', payload }));
      on<{ message: RoomSyncState['messages'][number] }>('chat:message', (payload) =>
        dispatch({ type: 'chat:message', payload }),
      );
      on<{ connectedUserIds: string[] }>('presence', (payload) => dispatch({ type: 'presence', payload }));
      on<{ error: { message: string } }>('room:error', (payload) =>
        dispatch({ type: 'status', payload: { status: 'error', error: payload.error.message } }),
      );

      // Reconnect → full resync, so a client that slept through events catches up.
      socket.on('connect', () => {
        void emitWithAck(socket as CadenzaSocket, 'room:resync', { roomId }).catch(() => undefined);
      });

      const ack = await emitWithAck(socket, 'room:join', { roomId });
      if (!ack.ok) {
        dispatch({ type: 'status', payload: { status: 'error', error: ack.error?.message ?? 'Could not join this room' } });
        return;
      }
      const snapshot = ack.snapshot as RoomSnapshotPayload | undefined;
      if (snapshot) dispatch({ type: 'room:snapshot', payload: snapshot });
      else dispatch({ type: 'status', payload: { status: 'joined' } });
    },

    disconnect() {
      const roomId = get().roomId;
      if (socket && roomId) {
        void emitWithAck(socket, 'room:leave', { roomId }).catch(() => undefined);
      }
      detachListeners();
      dispatch({ type: 'reset' });
    },

    async sendMessage(body) {
      const roomId = get().roomId;
      if (!socket || !roomId) return;
      const ack = await emitWithAck(socket, 'chat:message', {
        roomId,
        body,
        eventId: newEventId('chat'),
        clientSentAt: Date.now(),
      });
      if (!ack.ok) dispatch({ type: 'status', payload: { status: 'joined', error: ack.error?.message ?? 'Message failed' } });
    },

    async addToQueue(songId) {
      const roomId = get().roomId;
      if (!roomId) return;
      const eventId = newEventId('queue');
      if (socket) {
        const ack = await emitWithAck(socket, 'queue:add', { roomId, songId, eventId });
        if (!ack.ok) dispatch({ type: 'status', payload: { status: 'joined', error: ack.error?.message ?? 'Could not queue that track' } });
        return;
      }
      const response = await api.queueTrack(roomId, songId, eventId);
      dispatch({ type: 'queue:updated', payload: { queue: response.room.queue } });
    },

    async removeFromQueue(songId) {
      const roomId = get().roomId;
      if (!roomId) return;
      const eventId = newEventId('remove');
      if (socket) {
        const ack = await emitWithAck(socket, 'queue:remove', { roomId, songId, eventId });
        if (!ack.ok) dispatch({ type: 'status', payload: { status: 'joined', error: ack.error?.message ?? 'Could not remove that track' } });
        return;
      }
      const response = await api.removeQueuedTrack(roomId, songId, eventId);
      dispatch({ type: 'queue:updated', payload: { queue: response.room.queue } });
    },

    async control(action, positionMs) {
      const roomId = get().roomId;
      if (!socket || !roomId) return;
      const ack = await emitWithAck(socket, `playback:${action}` as 'playback:play', {
        roomId,
        positionMs,
        eventId: newEventId(action),
      });
      if (!ack.ok) dispatch({ type: 'status', payload: { status: 'joined', error: ack.error?.message ?? 'Playback change rejected' } });
    },

    async changeTrack(songId) {
      const roomId = get().roomId;
      if (!socket || !roomId) return;
      const ack = await emitWithAck(socket, 'playback:track', { roomId, songId, eventId: newEventId('track') });
      if (!ack.ok) dispatch({ type: 'status', payload: { status: 'joined', error: ack.error?.message ?? 'Only the host can change the track' } });
    },

    /** Tells the server where this client thinks playback is; it may snap us back. */
    reportPosition(positionMs) {
      const roomId = get().roomId;
      if (!socket || !roomId) return;
      void emitWithAck(socket, 'playback:report', { roomId, positionMs, eventId: newEventId('report') })
        .then((ack) => {
          if (typeof ack.driftMs === 'number') dispatch({ type: 'drift:report', payload: { driftMs: ack.driftMs } });
        })
        .catch(() => undefined);
    },

    clearError() {
      set({ error: null });
    },
  };
});
