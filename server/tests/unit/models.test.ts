import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { Album, Artist, Playlist, Room, Song, User } from '../../src/models/index.js';

const mongoUri = inject('mongoUri');

beforeAll(async () => {
  // See user-service.test.ts: one fork for all files + mongoose's singleton default connection
  // means an open connection from an earlier file would make this `dbName` a silent no-op.
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(mongoUri, { dbName: `cadenza_models_${randomBytes(4).toString('hex')}` });
  // Force index creation so text-index assertions are meaningful.
  await Promise.all([User.init(), Artist.init(), Album.init(), Song.init(), Playlist.init(), Room.init()]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const hex = () => new mongoose.Types.ObjectId().toHexString();

describe('Song model', () => {
  it('requires a title, duration and audio key', async () => {
    await expect(Song.create({ slug: `x-${hex()}`, artistId: hex(), coverKey: 'covers/a.svg' })).rejects.toThrowError(
      /title|durationMs|audioKey/,
    );
  });

  it('rejects a duplicate slug at the database level', async () => {
    const slug = `dupe-${hex()}`;
    await Song.create({
      title: 'First',
      slug,
      artistId: hex(),
      durationMs: 1_000,
      audioKey: 'tracks/neon-rain.mp3',
      coverKey: 'covers/neon-rain.svg',
    });
    await expect(
      Song.create({
        title: 'Second',
        slug,
        artistId: hex(),
        durationMs: 1_000,
        audioKey: 'tracks/slow-orbit.mp3',
        coverKey: 'covers/slow-orbit.svg',
      }),
    ).rejects.toThrowError(/duplicate key/i);
  });

  it('serves ranked full-text search through the song_text index', async () => {
    const artistId = hex();
    await Song.create([
      {
        title: 'Aurora Drift',
        slug: `aurora-${hex()}`,
        artistId,
        durationMs: 24_000,
        audioKey: 'tracks/aurora-drift.mp3',
        coverKey: 'covers/aurora-drift.svg',
        genres: ['ambient', 'choral'],
      },
      {
        title: 'Velvet Static',
        slug: `velvet-${hex()}`,
        artistId,
        durationMs: 21_000,
        audioKey: 'tracks/velvet-static.mp3',
        coverKey: 'covers/velvet-static.svg',
        genres: ['house'],
      },
    ]);

    const indexes = await Song.collection.indexes();
    expect(indexes.some((index) => index.name === 'song_text')).toBe(true);

    const hits = await Song.find({ $text: { $search: 'ambient' } }).lean();
    expect(hits).toHaveLength(1);
    expect(hits[0]?.title).toBe('Aurora Drift');

    const none = await Song.find({ $text: { $search: 'zzzznothing' } }).lean();
    expect(none).toHaveLength(0);
  });

  it('keeps playCount non-negative', async () => {
    await expect(
      Song.create({
        title: 'Negative',
        slug: `neg-${hex()}`,
        artistId: hex(),
        durationMs: 1_000,
        audioKey: 'tracks/neon-rain.mp3',
        coverKey: 'covers/neon-rain.svg',
        playCount: -5,
      }),
    ).rejects.toThrowError(/playCount/);
  });
});

describe('User model', () => {
  it('defaults to the listener role and rejects unknown roles', async () => {
    const user = await User.create({ clerkId: `demo:${hex()}`, email: `${hex()}@cadenza.test`, displayName: 'Listener' });
    expect(user.roles).toEqual(['listener']);

    await expect(
      User.create({ clerkId: `demo:${hex()}`, email: `${hex()}@cadenza.test`, displayName: 'Bad', roles: ['wizard'] }),
    ).rejects.toThrowError(/roles/);
  });

  it('enforces a unique clerkId', async () => {
    const clerkId = `demo:${hex()}`;
    await User.create({ clerkId, email: `${hex()}@cadenza.test`, displayName: 'One' });
    await expect(User.create({ clerkId, email: `${hex()}@cadenza.test`, displayName: 'Two' })).rejects.toThrowError(
      /duplicate key/i,
    );
  });
});

describe('Playlist and Room models', () => {
  it('defaults playlists to private with an empty track list', async () => {
    const playlist = await Playlist.create({ name: 'Private set', ownerId: hex() });
    expect(playlist.visibility).toBe('private');
    expect(playlist.songs).toHaveLength(0);
  });

  it('keeps room queue entries and playback state in one document', async () => {
    const room = await Room.create({
      name: 'Indexed room',
      slug: `room-${hex()}`,
      hostId: hex(),
      members: [{ userId: hex(), role: 'host' }],
      queue: [{ songId: hex(), addedBy: hex(), eventId: 'evt-1' }],
      playback: { trackId: null, isPlaying: false, positionMs: 0, serverTs: new Date(), updatedBy: null },
    });
    expect(room.queue).toHaveLength(1);
    expect(room.playback.isPlaying).toBe(false);
    expect(room.processedEventIds).toHaveLength(0);

    const indexes = await Room.collection.indexes();
    expect(indexes.some((index) => index.key['members.userId'] === 1)).toBe(true);
  });
});
