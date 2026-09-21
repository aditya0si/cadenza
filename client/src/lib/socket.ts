import { io, type Socket } from 'socket.io-client';
import { assetUrl } from './utils';

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? assetUrl('');

export interface RoomSnapshotPayload {
  room: import('../types').RoomDto;
  messages: import('../types').MessageDto[];
}

export interface PlaybackStatePayload {
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  serverTs: number;
  updatedBy: string | null;
}

export interface ServerToClientEvents {
  'room:snapshot': (payload: RoomSnapshotPayload) => void;
  'playback:state': (payload: PlaybackStatePayload) => void;
  'playback:snap': (payload: PlaybackStatePayload & { roomId: string; reason: string }) => void;
  'queue:updated': (payload: { roomId: string; queue: import('../types').SongDto[]; addedBy?: string; removedBy?: string }) => void;
  'track:changed': (payload: { roomId: string; songId: string; changedBy: string }) => void;
  'chat:message': (payload: { message: import('../types').MessageDto }) => void;
  presence: (payload: { roomId: string; connectedUserIds: string[] }) => void;
  'room:error': (payload: { ok: false; error: { code: string; message: string }; roomId: string | null }) => void;
}

export interface AckResponse {
  ok: boolean;
  duplicate?: boolean;
  error?: { code: string; message: string };
  [key: string]: unknown;
}

export interface ClientToServerEvents {
  'room:join': (payload: { roomId: string }, ack?: (response: AckResponse) => void) => void;
  'room:leave': (payload: { roomId: string }, ack?: (response: AckResponse) => void) => void;
  'room:resync': (payload: { roomId: string }, ack?: (response: AckResponse) => void) => void;
  'playback:play': (payload: { roomId: string; positionMs: number; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'playback:pause': (payload: { roomId: string; positionMs: number; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'playback:seek': (payload: { roomId: string; positionMs: number; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'playback:track': (payload: { roomId: string; songId: string; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'playback:report': (payload: { roomId: string; positionMs: number; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'queue:add': (payload: { roomId: string; songId: string; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'queue:remove': (payload: { roomId: string; songId: string; eventId: string }, ack?: (response: AckResponse) => void) => void;
  'chat:message': (
    payload: { roomId: string; body: string; eventId: string; clientSentAt: number },
    ack?: (response: AckResponse) => void,
  ) => void;
}

export type CadenzaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * A single socket for the whole app. The handshake carries the session token,
 * so the connection is re-created whenever the identity changes.
 */
let socket: CadenzaSocket | null = null;

export const getSocket = (token: string): CadenzaSocket => {
  if (socket && socket.auth && (socket.auth as { token?: string }).token === token) return socket;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = io(SOCKET_URL, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
  }) as CadenzaSocket;
  return socket;
};

export const currentSocket = (): CadenzaSocket | null => socket;

export const disconnectSocket = (): void => {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
};

/** Client-side idempotency key for every mutating event. */
export const newEventId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const emitWithAck = (
  target: CadenzaSocket,
  event: keyof ClientToServerEvents,
  payload: Record<string, unknown>,
): Promise<AckResponse> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${String(event)} was not acknowledged`)), 8_000);
    // The socket.io typings cannot express "emit any event with an ack" here.
    (target as unknown as { emit: (name: string, body: unknown, ack: (response: AckResponse) => void) => void }).emit(
      String(event),
      payload,
      (response: AckResponse) => {
        clearTimeout(timer);
        resolve(response);
      },
    );
  });
