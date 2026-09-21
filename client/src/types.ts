/** API DTOs — mirrors `server/src/http/serializers.ts`. */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  createdAt: string;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface AlbumRef {
  id: string;
  title: string;
}

export interface SongDto {
  id: string;
  title: string;
  slug: string;
  durationMs: number;
  waveformPeaks: number[];
  coverUrl: string;
  bpm: number | null;
  musicalKey: string | null;
  genres: string[];
  playCount: number;
  trackNumber: number;
  artist: ArtistRef | null;
  album: AlbumRef | null;
}

export interface ArtistDto {
  id: string;
  name: string;
  slug: string;
  bio: string;
  imageUrl: string;
  genres: string[];
  monthlyListeners: number;
  origin: string | null;
}

export interface AlbumDto {
  id: string;
  title: string;
  slug: string;
  releaseYear: number;
  coverUrl: string;
  songCount: number;
  description: string | null;
  artist: ArtistRef | null;
}

export interface PlaylistDto {
  id: string;
  name: string;
  description: string;
  visibility: 'private' | 'public';
  ownerId: string;
  trackCount: number;
  durationMs: number;
  songs: SongDto[];
  updatedAt: string;
}

export interface RoomMemberDto {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'host' | 'member';
  joinedAt: string;
  connected: boolean;
}

export interface PlaybackStateDto {
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  serverTs: string;
  updatedBy: string | null;
}

export interface RoomDto {
  id: string;
  name: string;
  slug: string;
  hostId: string;
  visibility: 'private' | 'public';
  members: RoomMemberDto[];
  queue: SongDto[];
  playback: PlaybackStateDto;
  lastActivityAt: string;
}

export interface RoomSummaryDto {
  id: string;
  name: string;
  slug: string;
  hostId: string;
  visibility: 'private' | 'public';
  memberCount: number;
  queueLength: number;
  isPlaying: boolean;
  nowPlaying: SongDto | null;
  lastActivityAt: string;
}

export interface MessageDto {
  id: string;
  roomId: string;
  body: string;
  createdAt: string;
  author: { id: string; displayName: string; avatarUrl: string | null };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface SearchResults {
  query: string;
  artists: ArtistDto[];
  albums: AlbumDto[];
  songs: SongDto[];
}

export interface StreamUrlDto {
  songId: string;
  url: string;
  expiresAt: string;
  ttlSeconds: number;
  durationMs: number;
}

export interface StatsOverview {
  users: number;
  artists: number;
  albums: number;
  songs: number;
  playlists: number;
  rooms: number;
  activeRooms: number;
  messages: number;
  playEvents: number;
}

export interface PlaysBucket {
  date: string;
  plays: number;
  uniqueListeners: number;
}

export interface TopTrackRow {
  songId: string;
  title: string;
  artistName: string;
  plays: number;
  coverUrl: string;
}

export interface ActiveRoomRow {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  queueLength: number;
  isPlaying: boolean;
  nowPlaying: SongDto | null;
  lastActivityAt: string;
}

export interface HealthDto {
  status: string;
  service: string;
  version: string;
  uptimeSeconds: number;
  authMode: 'clerk' | 'demo';
  realtime: boolean;
  serverTime: string;
}
