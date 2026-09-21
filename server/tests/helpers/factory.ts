import { Types } from 'mongoose';
import { Album, Artist, Playlist, Room, Song, User } from '../../src/models/index.js';

/** Small, deterministic builders so every test starts from real Mongo rows. */

export interface SeededCatalog {
  artistId: string;
  albumId: string;
  songIds: string[];
}

export async function seedCatalog(songCount = 3): Promise<SeededCatalog> {
  const artist = await Artist.create({
    name: 'Test Signal',
    slug: `test-signal-${new Types.ObjectId().toHexString()}`,
    bio: 'Fixture artist used by the CADENZA test suite.',
    imageKey: 'covers/midnight-circuit.svg',
    genres: ['electronic'],
    monthlyListeners: 0,
    origin: null,
  });
  const album = await Album.create({
    title: 'Fixture Album',
    slug: `fixture-album-${new Types.ObjectId().toHexString()}`,
    artistId: artist._id,
    releaseYear: 2026,
    coverKey: 'covers/midnight-circuit.svg',
    songCount,
    description: null,
  });

  const tracks = [
    { title: 'Neon Rain', slug: 'neon-rain', audioKey: 'tracks/neon-rain.mp3', coverKey: 'covers/neon-rain.svg' },
    { title: 'Slow Orbit', slug: 'slow-orbit', audioKey: 'tracks/slow-orbit.mp3', coverKey: 'covers/slow-orbit.svg' },
    { title: 'Paper Lanterns', slug: 'paper-lanterns', audioKey: 'tracks/paper-lanterns.mp3', coverKey: 'covers/paper-lanterns.svg' },
    { title: 'Glass Harbor', slug: 'glass-harbor', audioKey: 'tracks/glass-harbor.mp3', coverKey: 'covers/glass-harbor.svg' },
    { title: 'Velvet Static', slug: 'velvet-static', audioKey: 'tracks/velvet-static.mp3', coverKey: 'covers/velvet-static.svg' },
  ].slice(0, songCount);

  const songs = await Song.create(
    tracks.map((track, index) => ({
      title: track.title,
      slug: `${track.slug}-${new Types.ObjectId().toHexString()}`,
      artistId: artist._id,
      albumId: album._id,
      trackNumber: index + 1,
      durationMs: 22_000,
      waveformPeaks: Array.from({ length: 12 }, (_value, i) => Number((0.1 + i / 20).toFixed(3))),
      audioKey: track.audioKey,
      coverKey: track.coverKey,
      bpm: 104,
      musicalKey: 'A minor',
      genres: ['synthwave'],
      playCount: 0,
    })),
  );

  return {
    artistId: String(artist._id),
    albumId: String(album._id),
    songIds: songs.map((song) => String(song._id)),
  };
}

export async function createUser(input: {
  email: string;
  displayName?: string;
  roles?: string[];
  clerkId?: string;
}): Promise<{ id: string; clerkId: string; email: string }> {
  const clerkId = input.clerkId ?? `demo:${input.email}`;
  const user = await User.create({
    clerkId,
    email: input.email.toLowerCase(),
    displayName: input.displayName ?? input.email.split('@')[0] ?? 'Listener',
    avatarUrl: null,
    roles: input.roles ?? ['listener'],
    lastSeenAt: new Date(),
  });
  return { id: String(user._id), clerkId, email: user.email };
}

export async function createPlaylist(input: {
  ownerId: string;
  name?: string;
  visibility?: 'private' | 'public';
  songIds?: string[];
}): Promise<string> {
  const playlist = await Playlist.create({
    name: input.name ?? 'Fixture Playlist',
    description: 'created by the test suite',
    ownerId: new Types.ObjectId(input.ownerId),
    visibility: input.visibility ?? 'private',
    songs: (input.songIds ?? []).map((songId) => ({
      songId: new Types.ObjectId(songId),
      addedAt: new Date(),
      addedBy: new Types.ObjectId(input.ownerId),
    })),
  });
  return String(playlist._id);
}

export async function createRoom(input: {
  hostId: string;
  name?: string;
  visibility?: 'private' | 'public';
  memberIds?: string[];
  queueSongIds?: string[];
}): Promise<string> {
  const room = await Room.create({
    name: input.name ?? 'Fixture Room',
    slug: `fixture-room-${new Types.ObjectId().toHexString()}`,
    hostId: new Types.ObjectId(input.hostId),
    visibility: input.visibility ?? 'public',
    members: [
      { userId: new Types.ObjectId(input.hostId), role: 'host', joinedAt: new Date(), lastSeenAt: new Date() },
      ...(input.memberIds ?? []).map((userId) => ({
        userId: new Types.ObjectId(userId),
        role: 'member' as const,
        joinedAt: new Date(),
        lastSeenAt: new Date(),
      })),
    ],
    queue: (input.queueSongIds ?? []).map((songId, index) => ({
      songId: new Types.ObjectId(songId),
      addedBy: new Types.ObjectId(input.hostId),
      addedAt: new Date(),
      eventId: `fixture-queue-${index}`,
    })),
    playback: {
      trackId: input.queueSongIds?.[0] ? new Types.ObjectId(input.queueSongIds[0]) : null,
      isPlaying: false,
      positionMs: 0,
      serverTs: new Date(),
      updatedBy: new Types.ObjectId(input.hostId),
    },
    lastActivityAt: new Date(),
    processedEventIds: [],
  });
  return String(room._id);
}

export const uniqueEventId = (prefix = 'evt'): string => `${prefix}-${new Types.ObjectId().toHexString()}`;
