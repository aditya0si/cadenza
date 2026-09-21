import { Types } from 'mongoose';
import { PlayEvent } from '../models/index.js';

export interface PlaysOverTimeBucket {
  date: string;
  plays: number;
  uniqueListeners: number;
}

export interface TopTrackRow {
  songId: string;
  title: string;
  artistName: string;
  plays: number;
}

export const playEventRepository = {
  async create(input: {
    songId: Types.ObjectId;
    userId: Types.ObjectId | null;
    roomId: Types.ObjectId | null;
    source: 'library' | 'album' | 'playlist' | 'search' | 'room';
    msPlayed?: number;
    startedAt?: Date;
  }): Promise<void> {
    await PlayEvent.create({ ...input, startedAt: input.startedAt ?? new Date() });
  },

  /** Daily play counts for the admin chart. Real aggregation, not a fake series. */
  async playsOverTime(days: number): Promise<PlaysOverTimeBucket[]> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await PlayEvent.aggregate<{ _id: string; plays: number; listeners: Types.ObjectId[] }>([
      { $match: { startedAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: 'UTC' } },
          plays: { $sum: 1 },
          listeners: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((row) => ({
      date: row._id,
      plays: row.plays,
      uniqueListeners: row.listeners.filter((id) => id !== null).length,
    }));
  },

  async topTracks(limit: number, days?: number): Promise<TopTrackRow[]> {
    const match = days ? { startedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } } : {};
    const rows = await PlayEvent.aggregate<TopTrackRow>([
      { $match: match },
      { $group: { _id: '$songId', plays: { $sum: 1 } } },
      { $sort: { plays: -1, _id: 1 } },
      { $limit: limit },
      {
        $lookup: { from: 'songs', localField: '_id', foreignField: '_id', as: 'song', pipeline: [{ $project: { title: 1, artistId: 1 } }] },
      },
      { $unwind: { path: '$song', preserveNullAndEmptyArrays: true } },
      {
        $lookup: { from: 'artists', localField: 'song.artistId', foreignField: '_id', as: 'artist', pipeline: [{ $project: { name: 1 } }] },
      },
      { $unwind: { path: '$artist', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          songId: { $toString: '$_id' },
          plays: 1,
          title: { $ifNull: ['$song.title', 'Unknown track'] },
          artistName: { $ifNull: ['$artist.name', 'Unknown artist'] },
        },
      },
    ]);
    return rows;
  },

  async countForSong(songId: string | Types.ObjectId, since?: Date): Promise<number> {
    return PlayEvent.countDocuments(since ? { songId, startedAt: { $gte: since } } : { songId });
  },

  async count(): Promise<number> {
    return PlayEvent.countDocuments({});
  },
};
