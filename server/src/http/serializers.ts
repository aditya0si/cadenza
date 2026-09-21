import type { ArtistLean } from '../repositories/artist.repository.js';
import type { AlbumLean } from '../repositories/album.repository.js';
import type { SongLean } from '../repositories/song.repository.js';
import type { PlaylistLean } from '../repositories/playlist.repository.js';
import type { RoomLean } from '../repositories/room.repository.js';
import type { MessageLean } from '../repositories/message.repository.js';
import type { UserLean } from '../repositories/user.repository.js';

/**
 * Serializers are the only place that turns database rows into API shapes:
 * ids are stringified, internal keys (`audioKey`) never leave the server, and
 * audio is always referenced through the signed-URL endpoint.
 */
export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  createdAt: string;
}

export interface ArtistRefDto {
  id: string;
  name: string;
}

export interface AlbumRefDto {
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
  artist: ArtistRefDto | null;
  album: AlbumRefDto | null;
}

export interface AlbumDto {
  id: string;
  title: string;
  slug: string;
  releaseYear: number;
  coverUrl: string;
  songCount: number;
  description: string | null;
  artist: ArtistRefDto | null;
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

export interface MessageDto {
  id: string;
  roomId: string;
  body: string;
  createdAt: string;
  author: { id: string; displayName: string; avatarUrl: string | null };
}

export const serializeUser = (user: UserLean): UserDto => ({
  id: String(user._id),
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl ?? null,
  roles: [...user.roles],
  createdAt: new Date(user.createdAt).toISOString(),
});

export const serializeArtist = (artist: ArtistLean): ArtistDto => ({
  id: String(artist._id),
  name: artist.name,
  slug: artist.slug,
  bio: artist.bio,
  imageUrl: `/api/media/cover/artist/${String(artist._id)}`,
  genres: [...artist.genres],
  monthlyListeners: artist.monthlyListeners,
  origin: artist.origin ?? null,
});

export const serializeAlbum = (album: AlbumLean, artistName: string | null): AlbumDto => ({
  id: String(album._id),
  title: album.title,
  slug: album.slug,
  releaseYear: album.releaseYear,
  coverUrl: `/api/media/cover/album/${String(album._id)}`,
  songCount: album.songCount,
  description: album.description ?? null,
  artist: artistName ? { id: String(album.artistId), name: artistName } : null,
});

export const serializeSong = (
  song: SongLean,
  refs: { artistName?: string | null; albumTitle?: string | null } = {},
): SongDto => ({
  id: String(song._id),
  title: song.title,
  slug: song.slug,
  durationMs: song.durationMs,
  waveformPeaks: [...song.waveformPeaks],
  coverUrl: `/api/media/cover/song/${String(song._id)}`,
  bpm: song.bpm ?? null,
  musicalKey: song.musicalKey ?? null,
  genres: [...song.genres],
  playCount: song.playCount,
  trackNumber: song.trackNumber,
  artist: song.artistId ? { id: String(song.artistId), name: refs.artistName ?? 'Unknown artist' } : null,
  album: song.albumId && refs.albumTitle ? { id: String(song.albumId), title: refs.albumTitle } : null,
});

export const serializePlaylist = (playlist: PlaylistLean, songs: SongDto[]): PlaylistDto => ({
  id: String(playlist._id),
  name: playlist.name,
  description: playlist.description ?? '',
  visibility: playlist.visibility,
  ownerId: String(playlist.ownerId),
  trackCount: playlist.songs.length,
  durationMs: songs.reduce((total, song) => total + song.durationMs, 0),
  songs,
  updatedAt: new Date(playlist.updatedAt).toISOString(),
});

export const serializePlayback = (room: RoomLean): PlaybackStateDto => ({
  trackId: room.playback.trackId ? String(room.playback.trackId) : null,
  isPlaying: room.playback.isPlaying,
  positionMs: room.playback.positionMs,
  serverTs: new Date(room.playback.serverTs).toISOString(),
  updatedBy: room.playback.updatedBy ? String(room.playback.updatedBy) : null,
});

export const serializeRoom = (input: {
  room: RoomLean;
  members: RoomMemberDto[];
  queue: SongDto[];
  connectedUserIds?: string[];
}): RoomDto => {
  const connected = new Set(input.connectedUserIds ?? []);
  return {
    id: String(input.room._id),
    name: input.room.name,
    slug: input.room.slug,
    hostId: String(input.room.hostId),
    visibility: input.room.visibility,
    members: input.members.map((member) => ({ ...member, connected: connected.has(member.userId) })),
    queue: input.queue,
    playback: serializePlayback(input.room),
    lastActivityAt: new Date(input.room.lastActivityAt).toISOString(),
  };
};

export const serializeMessage = (message: MessageLean, author: { id: string; displayName: string; avatarUrl: string | null }): MessageDto => ({
  id: String(message._id),
  roomId: String(message.roomId),
  body: message.body,
  createdAt: new Date(message.createdAt).toISOString(),
  author,
});
