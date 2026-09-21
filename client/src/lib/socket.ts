import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN } from './utils';

/**
 * The socket must reach the API host, never the host that served the bundle. `assetUrl('')` returns
 * '' for an empty path and `io('')` silently falls back to the *current* origin, so a split
 * deployment (client on Vercel, API on Render) — or the built preview, which has no `/socket.io`
 * route — tried to upgrade ws://<client-host>/socket.io, got the SPA fallback's 200 instead of a
 * 101, and realtime died with no visible error beyond the console. Derive the origin from the same
 * source of truth as the REST client; `||` (not `??`) so an empty VITE_SOCKET_URL cannot win either.
 * With a relative VITE_API_URL (dev proxy) API_ORIGIN is '' and the same-origin default is correct.
 */
const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL as string | undefined) || API_ORIGIN;

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
  'room:evicted': (payload: { roomId: string; reason: string }) => void;
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

/** The WebSocket close code for "message too big". */
export const OVERSIZED_PAYLOAD_CLOSE_CODE = 1009;

/**
 * Why a connection dropped is only visible in socket.io's disconnect `details`.
 * The one reason that needs its own message is the server's `maxHttpBufferSize`
 * bound: the transport refuses an oversized frame and closes with 1009, which
 * otherwise looks exactly like a silent disconnect. Mapping it to a typed error
 * lets the UI say what happened.
 */
export const payloadTooLargeError = (details: unknown): { code: 'PAYLOAD_TOO_LARGE'; message: string } | null => {
  const code = (details as { context?: { code?: number } } | undefined)?.context?.code;
  if (code !== OVERSIZED_PAYLOAD_CLOSE_CODE) return null;
  return {
    code: 'PAYLOAD_TOO_LARGE',
    message: 'That payload was larger than the server accepts, so the connection was closed. Send less at once.',
  };
};

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
