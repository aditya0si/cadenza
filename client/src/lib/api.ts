import { assetUrl } from './utils';
import type {
  ActiveRoomRow,
  AlbumDto,
  HealthDto,
  MessageDto,
  Paginated,
  PlaylistDto,
  PlaysBucket,
  RoomDto,
  RoomSummaryDto,
  SearchResults,
  SongDto,
  StatsOverview,
  StreamUrlDto,
  TopTrackRow,
  UserDto,
} from '../types';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? `${assetUrl('') || 'http://localhost:4000'}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The token getter is injected by whichever auth provider is active (Clerk in
 * production, demo sessions when no Clerk keys are configured), so no component
 * ever has to know which one is in play.
 */
type TokenGetter = () => Promise<string | null> | string | null;

let getToken: TokenGetter = () => null;

export const setTokenGetter = (getter: TokenGetter): void => {
  getToken = getter;
};

/** Used by the socket layer to authenticate the handshake. */
export const getAuthToken = async (): Promise<string | null> => getToken();

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false, signal } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = await getToken();
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: { code?: string; message?: string; details?: unknown } }
    | T
    | null;

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details ?? null,
    );
  }
  return payload as T;
}

const query = (params: Record<string, string | number | boolean | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
};

export const api = {
  health: () => apiRequest<HealthDto>('/health'),

  demoSignIn: (email: string, displayName?: string) =>
    apiRequest<{ token: string; user: UserDto; expiresAt: string; mode: 'demo'; warning: string }>('/auth/demo-session', {
      method: 'POST',
      body: { email, ...(displayName ? { displayName } : {}) },
    }),
  me: () => apiRequest<{ user: UserDto; authMode: 'clerk' | 'demo' }>('/auth/me', { auth: true }),

  discover: () =>
    apiRequest<{ featuredAlbums: AlbumDto[]; topSongs: SongDto[]; artists: import('../types').ArtistDto[] }>('/discover'),
  songs: (params: { search?: string; albumId?: string; artistId?: string; sort?: string; page?: number; limit?: number } = {}) =>
    apiRequest<Paginated<SongDto>>(`/songs${query(params)}`),
  song: (id: string) => apiRequest<{ song: SongDto }>(`/songs/${id}`),
  albums: (params: { search?: string; artistId?: string; page?: number; limit?: number } = {}) =>
    apiRequest<Paginated<AlbumDto>>(`/albums${query(params)}`),
  album: (id: string) => apiRequest<{ album: AlbumDto; songs: SongDto[] }>(`/albums/${id}`),
  artist: (id: string) =>
    apiRequest<{ artist: import('../types').ArtistDto; albums: AlbumDto[]; topSongs: SongDto[] }>(`/artists/${id}`),
  search: (q: string) => apiRequest<SearchResults>(`/search${query({ q })}`),
  streamUrl: (songId: string) => apiRequest<StreamUrlDto>(`/songs/${songId}/stream-url`, { auth: true }),
  recordPlay: (songId: string, source: string, roomId?: string) =>
    apiRequest<{ playCount: number; totalPlays: number }>(`/songs/${songId}/play`, {
      method: 'POST',
      auth: true,
      body: { source, ...(roomId ? { roomId } : {}) },
    }),

  playlists: (params: { scope?: 'mine' | 'public' | 'all'; search?: string; page?: number; limit?: number } = {}) =>
    apiRequest<Paginated<PlaylistDto>>(`/playlists${query(params)}`, { auth: true }),
  playlist: (id: string) => apiRequest<{ playlist: PlaylistDto }>(`/playlists/${id}`, { auth: true }),
  createPlaylist: (body: { name: string; description?: string; visibility?: 'private' | 'public' }) =>
    apiRequest<{ playlist: PlaylistDto }>('/playlists', { method: 'POST', auth: true, body }),
  updatePlaylist: (id: string, body: { name?: string; description?: string; visibility?: 'private' | 'public' }) =>
    apiRequest<{ playlist: PlaylistDto }>(`/playlists/${id}`, { method: 'PATCH', auth: true, body }),
  deletePlaylist: (id: string) => apiRequest<void>(`/playlists/${id}`, { method: 'DELETE', auth: true }),
  addPlaylistSong: (id: string, songId: string) =>
    apiRequest<{ playlist: PlaylistDto }>(`/playlists/${id}/songs`, { method: 'POST', auth: true, body: { songId } }),
  removePlaylistSong: (id: string, songId: string) =>
    apiRequest<{ playlist: PlaylistDto }>(`/playlists/${id}/songs/${songId}`, { method: 'DELETE', auth: true }),
  reorderPlaylist: (id: string, songIds: string[]) =>
    apiRequest<{ playlist: PlaylistDto }>(`/playlists/${id}/order`, { method: 'PUT', auth: true, body: { songIds } }),

  rooms: (params: { activeOnly?: boolean; page?: number; limit?: number } = {}) =>
    apiRequest<Paginated<RoomSummaryDto>>(`/rooms${query({ ...params, activeOnly: params.activeOnly ?? true })}`, {
      auth: true,
    }),
  room: (id: string) => apiRequest<{ room: RoomDto; messages: MessageDto[] }>(`/rooms/${id}`, { auth: true }),
  createRoom: (body: { name: string; visibility?: 'private' | 'public' }) =>
    apiRequest<{ room: RoomDto }>('/rooms', { method: 'POST', auth: true, body }),
  joinRoom: (id: string) => apiRequest<{ room: RoomDto }>(`/rooms/${id}/join`, { method: 'POST', auth: true }),
  leaveRoom: (id: string) =>
    apiRequest<{ room: RoomDto; promoted: string | null }>(`/rooms/${id}/leave`, { method: 'POST', auth: true }),
  queueTrack: (id: string, songId: string, eventId: string) =>
    apiRequest<{ room: RoomDto; duplicate: boolean }>(`/rooms/${id}/queue`, {
      method: 'POST',
      auth: true,
      body: { songId, eventId },
    }),
  removeQueuedTrack: (id: string, songId: string, eventId: string) =>
    apiRequest<{ room: RoomDto; duplicate: boolean }>(`/rooms/${id}/queue/${songId}`, {
      method: 'DELETE',
      auth: true,
      body: { songId, eventId },
    }),
  messages: (id: string, params: { before?: string; limit?: number } = {}) =>
    apiRequest<{ items: MessageDto[]; nextBefore: string | null; hasMore: boolean }>(
      `/rooms/${id}/messages${query(params)}`,
      { auth: true },
    ),

  statsOverview: () => apiRequest<StatsOverview>('/stats/overview', { auth: true }),
  statsPlays: (days = 14) => apiRequest<{ days: number; buckets: PlaysBucket[] }>(`/stats/plays${query({ days })}`, { auth: true }),
  statsTopTracks: (limit = 10, days?: number) =>
    apiRequest<{ tracks: TopTrackRow[] }>(`/stats/top-tracks${query({ limit, days })}`, { auth: true }),
  statsActiveRooms: (limit = 10) =>
    apiRequest<{ rooms: ActiveRoomRow[] }>(`/stats/active-rooms${query({ limit })}`, { auth: true }),
};

export { API_URL };
