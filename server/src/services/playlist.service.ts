import { Types } from 'mongoose';
import { AppError } from '../errors.js';
import type { AuthenticatedUser } from '../auth/types.js';
import { playlistRepository, type PlaylistLean } from '../repositories/playlist.repository.js';
import { songRepository } from '../repositories/song.repository.js';
import { artistRepository } from '../repositories/artist.repository.js';
import { albumRepository } from '../repositories/album.repository.js';
import type { Paginated } from '../repositories/pagination.js';
import { serializePlaylist, serializeSong, type PlaylistDto, type SongDto } from '../http/serializers.js';

const MAX_TRACKS = 200;

/**
 * Playlist authorization in one place:
 *   read   → owner, or anyone for a public playlist, or an admin
 *   write  → owner, or an admin
 * Every method funnels through `loadForRead` / `loadForWrite`, so the authz
 * matrix is exercised by the same code the API uses.
 */
export class PlaylistService {
  private async decorate(playlist: PlaylistLean): Promise<PlaylistDto> {
    const ids = playlist.songs.map((entry) => String(entry.songId));
    if (ids.length === 0) return serializePlaylist(playlist, []);

    const songs = await songRepository.findByIds(ids);
    const [artists, albums] = await Promise.all([
      artistRepository.findByIds([...new Set(songs.map((song) => String(song.artistId)))]),
      albumRepository.findByIds([
        ...new Set(songs.map((song) => (song.albumId ? String(song.albumId) : '')).filter((id) => id !== '')),
      ]),
    ]);
    const byId = new Map(songs.map((song) => [String(song._id), song]));
    const artistNames = new Map(artists.map((artist) => [String(artist._id), artist.name]));
    const albumTitles = new Map(albums.map((album) => [String(album._id), album.title]));

    const ordered: SongDto[] = [];
    for (const entry of playlist.songs) {
      const song = byId.get(String(entry.songId));
      if (!song) continue; // a deleted song drops out of the playlist view
      ordered.push(
        serializeSong(song, {
          artistName: artistNames.get(String(song.artistId)) ?? null,
          albumTitle: song.albumId ? (albumTitles.get(String(song.albumId)) ?? null) : null,
        }),
      );
    }
    return serializePlaylist(playlist, ordered);
  }

  private async loadForRead(id: string, requester: AuthenticatedUser | null): Promise<PlaylistLean> {
    const playlist = await playlistRepository.findById(id);
    if (!playlist) throw AppError.notFound('Playlist not found');
    const isOwner = requester !== null && String(playlist.ownerId) === requester.id;
    const isAdmin = requester?.roles.includes('admin') ?? false;
    if (isOwner || isAdmin || playlist.visibility === 'public') return playlist;
    throw AppError.forbidden('This playlist is private');
  }

  private async loadForWrite(id: string, requester: AuthenticatedUser): Promise<PlaylistLean> {
    const playlist = await playlistRepository.findById(id);
    if (!playlist) throw AppError.notFound('Playlist not found');
    const isOwner = String(playlist.ownerId) === requester.id;
    if (!isOwner && !requester.roles.includes('admin')) {
      throw AppError.forbidden('Only the playlist owner can change it');
    }
    return playlist;
  }

  async list(
    query: { scope: 'mine' | 'public' | 'all'; search?: string | undefined; page: number; limit: number },
    requester: AuthenticatedUser | null,
  ): Promise<Paginated<PlaylistDto>> {
    if (query.scope === 'mine' && !requester) throw AppError.unauthenticated('Sign in to see your playlists');
    const listQuery =
      query.scope === 'mine'
        ? { ownerId: requester?.id, page: query.page, limit: query.limit, search: query.search }
        : query.scope === 'public'
          ? { visibility: 'public' as const, page: query.page, limit: query.limit, search: query.search }
          : {
              ...(requester ? { ownedByOrPublic: requester.id } : { visibility: 'public' as const }),
              page: query.page,
              limit: query.limit,
              search: query.search,
            };
    const result = await playlistRepository.list(listQuery);
    return { ...result, items: await Promise.all(result.items.map((playlist) => this.decorate(playlist))) };
  }

  async get(id: string, requester: AuthenticatedUser | null): Promise<PlaylistDto> {
    return this.decorate(await this.loadForRead(id, requester));
  }

  async create(
    requester: AuthenticatedUser,
    input: { name: string; description?: string; visibility?: 'private' | 'public' },
  ): Promise<PlaylistDto> {
    const created = await playlistRepository.create({
      name: input.name,
      description: input.description ?? '',
      ownerId: new Types.ObjectId(requester.id),
      visibility: input.visibility ?? 'private',
    });
    return this.decorate(created);
  }

  async update(
    id: string,
    requester: AuthenticatedUser,
    patch: { name?: string; description?: string; visibility?: 'private' | 'public' },
  ): Promise<PlaylistDto> {
    await this.loadForWrite(id, requester);
    const updated = await playlistRepository.update(id, patch);
    if (!updated) throw AppError.notFound('Playlist not found');
    return this.decorate(updated);
  }

  async remove(id: string, requester: AuthenticatedUser): Promise<void> {
    await this.loadForWrite(id, requester);
    const deleted = await playlistRepository.deleteById(id);
    if (!deleted) throw AppError.notFound('Playlist not found');
  }

  async addSong(
    id: string,
    requester: AuthenticatedUser,
    input: { songId: string; position?: number | undefined },
  ): Promise<PlaylistDto> {
    const playlist = await this.loadForWrite(id, requester);
    const song = await songRepository.findById(input.songId);
    if (!song) throw AppError.notFound('Song not found');
    if (playlist.songs.length >= MAX_TRACKS) {
      throw AppError.conflict(`Playlists are capped at ${MAX_TRACKS} tracks`);
    }
    if (playlist.songs.some((entry) => String(entry.songId) === input.songId)) {
      throw AppError.conflict('That track is already in this playlist');
    }
    const updated = await playlistRepository.addSong(id, {
      songId: song._id as Types.ObjectId,
      addedBy: new Types.ObjectId(requester.id),
      ...(input.position === undefined ? {} : { position: input.position }),
    });
    if (!updated) throw AppError.notFound('Playlist not found');
    return this.decorate(updated);
  }

  async removeSong(id: string, requester: AuthenticatedUser, songId: string): Promise<PlaylistDto> {
    const playlist = await this.loadForWrite(id, requester);
    if (!playlist.songs.some((entry) => String(entry.songId) === songId)) {
      throw AppError.notFound('That track is not in this playlist');
    }
    const updated = await playlistRepository.removeSong(id, new Types.ObjectId(songId));
    if (!updated) throw AppError.notFound('Playlist not found');
    return this.decorate(updated);
  }

  /** Drag-to-reorder: the client sends the full track order it wants. */
  async reorder(id: string, requester: AuthenticatedUser, songIds: string[]): Promise<PlaylistDto> {
    const playlist = await this.loadForWrite(id, requester);
    const current = playlist.songs.map((entry) => String(entry.songId));
    if (current.length !== songIds.length) {
      throw AppError.validation('Reorder payload must contain every track exactly once');
    }
    const currentSet = new Set(current);
    const seen = new Set<string>();
    for (const songId of songIds) {
      if (!currentSet.has(songId)) throw AppError.validation(`Track ${songId} is not in this playlist`);
      if (seen.has(songId)) throw AppError.validation(`Track ${songId} appears twice in the reorder payload`);
      seen.add(songId);
    }
    const byId = new Map(playlist.songs.map((entry) => [String(entry.songId), entry]));
    const reordered = songIds.map((songId) => {
      const entry = byId.get(songId);
      if (!entry) throw AppError.validation(`Track ${songId} is not in this playlist`);
      return {
        songId: entry.songId as Types.ObjectId,
        addedAt: new Date(entry.addedAt),
        addedBy: (entry.addedBy ?? null) as Types.ObjectId | null,
      };
    });
    const updated = await playlistRepository.reorder(id, reordered);
    if (!updated) throw AppError.notFound('Playlist not found');
    return this.decorate(updated);
  }
}
