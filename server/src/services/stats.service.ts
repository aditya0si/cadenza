import { songRepository } from '../repositories/song.repository.js';
import { artistRepository } from '../repositories/artist.repository.js';
import { playEventRepository } from '../repositories/playEvent.repository.js';
import { roomRepository } from '../repositories/room.repository.js';
import { userRepository } from '../repositories/user.repository.js';
import { playlistRepository } from '../repositories/playlist.repository.js';
import { albumRepository } from '../repositories/album.repository.js';
import { messageRepository } from '../repositories/message.repository.js';
import { serializeSong, type SongDto } from '../http/serializers.js';

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

export interface TopTrackRowDto {
  songId: string;
  title: string;
  artistName: string;
  plays: number;
  coverUrl: string;
}

/** Everything behind /api/stats/* — all of it real aggregation over Mongo. */
export class StatsService {
  async overview(): Promise<StatsOverview> {
    const [users, artists, albums, songs, playlists, rooms, activeRooms, messages, playEvents] = await Promise.all([
      userRepository.count(),
      artistRepository.count(),
      albumRepository.count(),
      songRepository.count(),
      playlistRepository.count(),
      roomRepository.count(),
      roomRepository.countActive(),
      messageRepository.count(),
      playEventRepository.count(),
    ]);
    return { users, artists, albums, songs, playlists, rooms, activeRooms, messages, playEvents };
  }

  async playsOverTime(
    days: number,
  ): Promise<{ days: number; buckets: { date: string; plays: number; uniqueListeners: number }[] }> {
    return { days, buckets: await playEventRepository.playsOverTime(days) };
  }

  async topTracks(limit: number, days?: number): Promise<TopTrackRowDto[]> {
    const rows = await playEventRepository.topTracks(limit, days);
    return rows.map((row) => ({ ...row, coverUrl: `/api/media/cover/song/${row.songId}` }));
  }

  async activeRooms(limit: number): Promise<ActiveRoomRow[]> {
    const rooms = await roomRepository.listActiveWithPlayback(limit);
    const rows: ActiveRoomRow[] = [];
    for (const room of rooms) {
      let nowPlaying: SongDto | null = null;
      if (room.playback.trackId) {
        const song = await songRepository.findById(room.playback.trackId);
        if (song) {
          const artist = await artistRepository.findById(song.artistId);
          nowPlaying = serializeSong(song, { artistName: artist?.name ?? null });
        }
      }
      rows.push({
        id: String(room._id),
        name: room.name,
        slug: room.slug,
        memberCount: room.members.length,
        queueLength: room.queue.length,
        isPlaying: room.playback.isPlaying,
        nowPlaying,
        lastActivityAt: new Date(room.lastActivityAt).toISOString(),
      });
    }
    return rows;
  }
}
