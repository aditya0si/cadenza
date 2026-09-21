import type { Types } from 'mongoose';
import { AppError } from '../errors.js';
import { artistRepository } from '../repositories/artist.repository.js';
import { albumRepository } from '../repositories/album.repository.js';
import { songRepository, type SongSort } from '../repositories/song.repository.js';
import { playEventRepository } from '../repositories/playEvent.repository.js';
import type { Paginated } from '../repositories/pagination.js';
import {
  serializeAlbum,
  serializeArtist,
  serializeSong,
  type AlbumDto,
  type ArtistDto,
  type SongDto,
} from '../http/serializers.js';

const DEFAULT_LIMIT = 20;

export interface SearchResults {
  query: string;
  artists: ArtistDto[];
  albums: AlbumDto[];
  songs: SongDto[];
}

/**
 * Browse + ranked search over the catalogue. Songs are always returned with
 * their artist/album display names resolved in two batched lookups, never
 * per-row queries.
 */
export class CatalogService {
  private async decorateSongs(songs: Awaited<ReturnType<typeof songRepository.list>>['items']): Promise<SongDto[]> {
    if (songs.length === 0) return [];
    const artistIds = [...new Set(songs.map((song) => String(song.artistId)))];
    const albumIds = [...new Set(songs.map((song) => (song.albumId ? String(song.albumId) : null)).filter((id): id is string => id !== null))];
    const [artists, albums] = await Promise.all([
      artistRepository.findByIds(artistIds),
      albumRepository.findByIds(albumIds),
    ]);
    const artistNames = new Map(artists.map((artist) => [String(artist._id), artist.name]));
    const albumTitles = new Map(albums.map((album) => [String(album._id), album.title]));
    return songs.map((song) =>
      serializeSong(song, {
        artistName: artistNames.get(String(song.artistId)) ?? null,
        albumTitle: song.albumId ? (albumTitles.get(String(song.albumId)) ?? null) : null,
      }),
    );
  }

  async listSongs(query: {
    search?: string | undefined;
    albumId?: string | undefined;
    artistId?: string | undefined;
    page: number;
    limit: number;
    sort: SongSort;
  }): Promise<Paginated<SongDto>> {
    const result = await songRepository.list(query);
    const items = await this.decorateSongs(result.items);
    return { ...result, items };
  }

  async getSong(id: string): Promise<SongDto> {
    const song = await songRepository.findById(id);
    if (!song) throw AppError.notFound('Song not found');
    const [artist, album] = await Promise.all([
      artistRepository.findById(song.artistId),
      song.albumId ? albumRepository.findById(song.albumId) : Promise.resolve(null),
    ]);
    return serializeSong(song, { artistName: artist?.name ?? null, albumTitle: album?.title ?? null });
  }

  async listArtists(query: { search?: string | undefined; page: number; limit: number }): Promise<Paginated<ArtistDto>> {
    const result = await artistRepository.list(query);
    return { ...result, items: result.items.map(serializeArtist) };
  }

  async getArtist(id: string): Promise<{ artist: ArtistDto; albums: AlbumDto[]; topSongs: SongDto[] }> {
    const artist = await artistRepository.findById(id);
    if (!artist) throw AppError.notFound('Artist not found');
    const [albums, songs] = await Promise.all([
      albumRepository.findByArtist(id),
      songRepository.list({ artistId: id, page: 1, limit: 50, sort: '-playCount' }),
    ]);
    const topSongs = await this.decorateSongs(songs.items);
    return {
      artist: serializeArtist(artist),
      albums: albums.map((album) => serializeAlbum(album, artist.name)),
      topSongs,
    };
  }

  async listAlbums(query: {
    search?: string | undefined;
    artistId?: string | undefined;
    page: number;
    limit: number;
  }): Promise<Paginated<AlbumDto>> {
    const result = await albumRepository.list(query);
    const artistIds = [...new Set(result.items.map((album) => String(album.artistId)))];
    const artists = await artistRepository.findByIds(artistIds);
    const names = new Map(artists.map((artist) => [String(artist._id), artist.name]));
    return {
      ...result,
      items: result.items.map((album) => serializeAlbum(album, names.get(String(album.artistId)) ?? null)),
    };
  }

  async getAlbum(id: string): Promise<{ album: AlbumDto; songs: SongDto[] }> {
    const album = await albumRepository.findById(id);
    if (!album) throw AppError.notFound('Album not found');
    const [artist, songs] = await Promise.all([
      artistRepository.findById(album.artistId),
      songRepository.listByAlbum(id),
    ]);
    return {
      album: serializeAlbum(album, artist?.name ?? null),
      songs: songs.map((song) => serializeSong(song, { artistName: artist?.name ?? null, albumTitle: album.title })),
    };
  }

  /** Ranked full-text search backed by the Mongo text indexes. */
  async search(query: string, limit = DEFAULT_LIMIT): Promise<SearchResults> {
    const [artists, albums, songs] = await Promise.all([
      artistRepository.search(query, limit),
      albumRepository.search(query, limit),
      songRepository.search(query, limit),
    ]);
    const artistNames = new Map(artists.map((artist) => [String(artist._id), artist.name]));
    const missingArtistIds = [...new Set(songs.map((song) => String(song.artistId)))].filter(
      (id) => !artistNames.has(id),
    );
    for (const artist of await artistRepository.findByIds(missingArtistIds)) {
      artistNames.set(String(artist._id), artist.name);
    }
    const albumTitles = new Map(albums.map((album) => [String(album._id), album.title]));
    return {
      query,
      artists: artists.map(serializeArtist),
      albums: albums.map((album) => serializeAlbum(album, artistNames.get(String(album.artistId)) ?? null)),
      songs: songs.map((song) =>
        serializeSong(song, {
          artistName: artistNames.get(String(song.artistId)) ?? null,
          albumTitle: song.albumId ? (albumTitles.get(String(song.albumId)) ?? null) : null,
        }),
      ),
    };
  }

  async discover(): Promise<{ featuredAlbums: AlbumDto[]; topSongs: SongDto[]; artists: ArtistDto[] }> {
    const [albums, topSongs, artists] = await Promise.all([
      albumRepository.featured(6),
      songRepository.topByPlayCount(8),
      artistRepository.list({ page: 1, limit: 6 }),
    ]);
    const artistIds = [...new Set(albums.map((album) => String(album.artistId)))];
    const albumArtists = await artistRepository.findByIds(artistIds);
    const names = new Map(albumArtists.map((artist) => [String(artist._id), artist.name]));
    return {
      featuredAlbums: albums.map((album) => serializeAlbum(album, names.get(String(album.artistId)) ?? null)),
      topSongs: await this.decorateSongs(topSongs),
      artists: artists.items.map(serializeArtist),
    };
  }

  async recordPlay(input: {
    songId: string;
    userId: string | null;
    roomId: string | null;
    source: 'library' | 'album' | 'playlist' | 'search' | 'room';
  }): Promise<{ playCount: number; totalPlays: number }> {
    const song = await songRepository.findById(input.songId);
    if (!song) throw AppError.notFound('Song not found');
    await playEventRepository.create({
      songId: song._id as Types.ObjectId,
      userId: input.userId ? (input.userId as unknown as Types.ObjectId) : null,
      roomId: input.roomId ? (input.roomId as unknown as Types.ObjectId) : null,
      source: input.source,
    });
    await Promise.all([
      songRepository.incrementPlayCount(song._id, 1),
      artistRepository.incrementMonthlyListeners(song.artistId, 1),
    ]);
    const refreshed = await songRepository.findById(song._id);
    return {
      playCount: refreshed?.playCount ?? song.playCount + 1,
      totalPlays: await playEventRepository.countForSong(song._id),
    };
  }
}
