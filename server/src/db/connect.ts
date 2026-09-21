import mongoose from 'mongoose';
import { Album, Artist, Message, PlayEvent, Playlist, Room, Song, User } from '../models/index.js';

export interface MongoConnectionInfo {
  uri: string;
  dbName: string;
}

export async function connectMongo(uri: string, dbName?: string): Promise<MongoConnectionInfo> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    ...(dbName ? { dbName } : {}),
    serverSelectionTimeoutMS: 15_000,
    maxPoolSize: 10,
  });
  const connection = mongoose.connection;
  return { uri, dbName: connection.name };
}

/**
 * Builds every collection index (including the `$text` indexes that ranked
 * search depends on) before the server starts serving traffic. Without this a
 * `$text` query can hit a collection whose index is still being built in the
 * background and fail with "text index required".
 */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    User.init(),
    Artist.init(),
    Album.init(),
    Song.init(),
    Playlist.init(),
    Room.init(),
    Message.init(),
    PlayEvent.init(),
  ]);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** mongoose readyState: 1 = connected. */
export const isMongoConnected = (): boolean => mongoose.connection.readyState === 1;

export const mongoReadyState = (): number => mongoose.connection.readyState;
