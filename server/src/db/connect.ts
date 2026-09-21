import mongoose from 'mongoose';

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

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/** mongoose readyState: 1 = connected. */
export const isMongoConnected = (): boolean => mongoose.connection.readyState === 1;

export const mongoReadyState = (): number => mongoose.connection.readyState;
