import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { Album, Artist, Message, PlayEvent, Playlist, Room, Song, User } from '../models/index.js';

export interface ManifestTrack {
  slug: string;
  title: string;
  artist: string;
  album: string;
  bpm: number;
  key: string;
  durationMs: number;
  audioFile: string;
  coverFile: string;
  peaksFile: string;
  peaks: number[];
  bytes: number;
}

export interface Manifest {
  generatedAt: string;
  sampleRate: number;
  tracks: ManifestTrack[];
}

export interface SeedReport {
  artists: number;
  albums: number;
  songs: number;
  users: number;
  playlists: number;
  rooms: number;
  messages: number;
  playEvents: number;
  skipped: boolean;
}

const GENRES_BY_ARTIST: Record<string, string[]> = {
  'Kite Ensemble': ['synthwave', 'downtempo'],
  'Harbour Static': ['lo-fi', 'trip hop'],
  'Ninth Avenue': ['indie electronic', 'house'],
  'Meridian Choir': ['ambient', 'choral'],
};

const ARTIST_BIO: Record<string, string> = {
  'Kite Ensemble': 'Two-producer outfit building slow-motion synth music for long nights and longer drives.',
  'Harbour Static': 'Port-city duo recording lo-fi sketches with broken drum machines and tape saturation.',
  'Ninth Avenue': 'Four-piece live electronic band writing commuter-length songs about city routines.',
  'Meridian Choir': 'Ambient collective layering choral pads over modular drones.',
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DEMO_LISTENER = { clerkId: 'demo:demo@cadenza.dev', email: 'demo@cadenza.dev', displayName: 'Demo Listener' };
const DEMO_ADMIN = { clerkId: 'demo:admin@cadenza.dev', email: 'admin@cadenza.dev', displayName: 'Cadenza Admin' };

/** Deterministic pseudo-random spread of seeded plays over the last two weeks. */
const seededPlaysFor = (index: number, total: number): { startedAt: Date; userId: Types.ObjectId | null }[] => {
  const plays: { startedAt: Date; userId: Types.ObjectId | null }[] = [];
  const daySpan = 14;
  for (let day = 0; day < daySpan; day += 1) {
    const perDay = ((index + day * 3) % 5) + 1;
    for (let n = 0; n < perDay; n += 1) {
      const hoursAgo = (daySpan - day) * 24 - (n * 2 + (index % 3));
      plays.push({ startedAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000), userId: null });
    }
  }
  void total;
  return plays;
};

/**
 * Loads the generated sample library (media/MANIFEST.json) into Mongo and adds a
 * small amount of demo content so the UI has something to show on first boot.
 *
 * Idempotent: a catalogue that already has songs is left untouched, and the
 * demo rows are matched by their natural keys (email / slug / event id).
 *
 * The play events below are synthetic seed rows (clearly labelled as such in the
 * README) — they exist so the admin dashboard has a 14-day series to chart.
 */
export async function seedAll(mediaDir: string): Promise<SeedReport> {
  const manifestPath = path.join(mediaDir, 'MANIFEST.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;

  const report: SeedReport = {
    artists: 0,
    albums: 0,
    songs: 0,
    users: 0,
    playlists: 0,
    rooms: 0,
    messages: 0,
    playEvents: 0,
    skipped: false,
  };

  if ((await Song.countDocuments({})) > 0) {
    report.skipped = true;
    return report;
  }

  // --- catalogue -----------------------------------------------------------
  const artistNames = [...new Set(manifest.tracks.map((track) => track.artist))];
  const artistIds = new Map<string, Types.ObjectId>();
  for (const name of artistNames) {
    const firstCover = manifest.tracks.find((track) => track.artist === name)?.coverFile ?? 'covers/midnight-circuit.svg';
    const artist = await Artist.findOneAndUpdate(
      { slug: slugify(name) },
      {
        $setOnInsert: {
          name,
          slug: slugify(name),
          bio: ARTIST_BIO[name] ?? `${name} — CADENZA sample artist.`,
          imageKey: firstCover,
          genres: GENRES_BY_ARTIST[name] ?? ['electronic'],
          monthlyListeners: 0,
          origin: null,
        },
      },
      { upsert: true, new: true },
    );
    artistIds.set(name, artist._id as Types.ObjectId);
    report.artists += 1;
  }

  const albumTitles = [...new Set(manifest.tracks.map((track) => track.album))];
  const albumIds = new Map<string, Types.ObjectId>();
  for (const title of albumTitles) {
    const firstTrack = manifest.tracks.find((track) => track.album === title);
    if (!firstTrack) continue;
    const album = await Album.findOneAndUpdate(
      { slug: slugify(title) },
      {
        $setOnInsert: {
          title,
          slug: slugify(title),
          artistId: artistIds.get(firstTrack.artist),
          releaseYear: 2026,
          coverKey: firstTrack.coverFile,
          songCount: manifest.tracks.filter((track) => track.album === title).length,
          description: `${title} — generated for the CADENZA sample library.`,
        },
      },
      { upsert: true, new: true },
    );
    albumIds.set(title, album._id as Types.ObjectId);
    report.albums += 1;
  }

  const songIds = new Map<string, Types.ObjectId>();
  for (const [index, track] of manifest.tracks.entries()) {
    const albumTrackNumber = manifest.tracks.filter((t) => t.album === track.album).findIndex((t) => t.slug === track.slug) + 1;
    const song = await Song.findOneAndUpdate(
      { slug: track.slug },
      {
        $setOnInsert: {
          title: track.title,
          slug: track.slug,
          artistId: artistIds.get(track.artist),
          albumId: albumIds.get(track.album) ?? null,
          trackNumber: albumTrackNumber,
          durationMs: track.durationMs,
          waveformPeaks: track.peaks,
          audioKey: track.audioFile,
          coverKey: track.coverFile,
          bpm: track.bpm,
          musicalKey: track.key,
          genres: GENRES_BY_ARTIST[track.artist] ?? ['electronic'],
          playCount: 0,
        },
      },
      { upsert: true, new: true },
    );
    songIds.set(track.slug, song._id as Types.ObjectId);
    report.songs += 1;
    void index;
  }

  // --- demo identities -----------------------------------------------------
  const listener = await User.findOneAndUpdate(
    { clerkId: DEMO_LISTENER.clerkId },
    { $setOnInsert: { ...DEMO_LISTENER, roles: ['listener'], avatarUrl: null, lastSeenAt: new Date() } },
    { upsert: true, new: true },
  );
  const admin = await User.findOneAndUpdate(
    { clerkId: DEMO_ADMIN.clerkId },
    { $setOnInsert: { ...DEMO_ADMIN, roles: ['listener', 'admin'], avatarUrl: null, lastSeenAt: new Date() } },
    { upsert: true, new: true },
  );
  report.users += 2;

  // --- demo playlists ------------------------------------------------------
  const playlistSeeds = [
    {
      name: 'Late Shift Focus',
      description: 'Slow synth loops for working after everyone else has logged off.',
      visibility: 'public' as const,
      slugs: ['midnight-circuit', 'slow-orbit', 'neon-rain', 'aurora-drift'],
    },
    {
      name: 'Warm-Up Laps',
      description: 'Private rehearsal set — uptempo only.',
      visibility: 'private' as const,
      slugs: ['velvet-static', 'meridian-lights', 'glass-harbor'],
    },
  ];
  for (const seed of playlistSeeds) {
    const songs = seed.slugs
      .map((slug) => songIds.get(slug))
      .filter((id): id is Types.ObjectId => id !== undefined)
      .map((songId) => ({ songId, addedAt: new Date(), addedBy: listener._id as Types.ObjectId }));
    await Playlist.findOneAndUpdate(
      { ownerId: listener._id, name: seed.name },
      { $set: { description: seed.description, visibility: seed.visibility, songs } },
      { upsert: true, new: true },
    );
    report.playlists += 1;
  }

  // --- demo room with a queued set and chat -------------------------------
  const queueSlugs = ['glass-harbor', 'midnight-circuit'];
  const queue = queueSlugs
    .map((slug, index) => {
      const songId = songIds.get(slug);
      if (!songId) return null;
      return {
        songId,
        addedBy: listener._id as Types.ObjectId,
        addedAt: new Date(Date.now() - (queueSlugs.length - index) * 60_000),
        eventId: `seed-queue-${slug}`,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const room = await Room.findOneAndUpdate(
    { slug: 'rooftop-session' },
    {
      $setOnInsert: {
        name: 'Rooftop Session',
        slug: 'rooftop-session',
        hostId: listener._id as Types.ObjectId,
        visibility: 'public',
        members: [{ userId: listener._id as Types.ObjectId, role: 'host', joinedAt: new Date(), lastSeenAt: new Date() }],
        queue,
        playback: {
          trackId: queue[0]?.songId ?? null,
          isPlaying: false,
          positionMs: 0,
          serverTs: new Date(),
          updatedBy: listener._id as Types.ObjectId,
        },
        lastActivityAt: new Date(),
        processedEventIds: queue.map((entry) => entry.eventId),
      },
    },
    { upsert: true, new: true },
  );
  report.rooms += 1;

  const chatSeeds = [
    { eventId: 'seed-message-1', body: 'Kicking off with Glass Harbor — headphones recommended.' },
    { eventId: 'seed-message-2', body: 'Queue is open, add anything from Discover.' },
    { eventId: 'seed-message-3', body: 'Nice, that transition into Midnight Circuit works.' },
  ];
  for (const [index, chat] of chatSeeds.entries()) {
    await Message.findOneAndUpdate(
      { roomId: room._id, eventId: chat.eventId },
      {
        $setOnInsert: {
          roomId: room._id,
          authorId: listener._id as Types.ObjectId,
          body: chat.body,
          eventId: chat.eventId,
          createdAt: new Date(Date.now() - (chatSeeds.length - index) * 90_000),
        },
      },
      { upsert: true, new: true },
    );
    report.messages += 1;
  }

  // --- synthetic play history for the admin dashboard ---------------------
  for (const [index, track] of manifest.tracks.entries()) {
    const songId = songIds.get(track.slug);
    if (!songId) continue;
    const plays = seededPlaysFor(index, manifest.tracks.length);
    await PlayEvent.insertMany(
      plays.map((play) => ({
        songId,
        userId: play.userId,
        roomId: null,
        source: index % 2 === 0 ? 'library' : 'playlist',
        msPlayed: 0,
        startedAt: play.startedAt,
      })),
    );
    await Song.updateOne({ _id: songId }, { $set: { playCount: plays.length } });
    await Artist.updateOne({ _id: artistIds.get(track.artist) }, { $inc: { monthlyListeners: plays.length } });
    report.playEvents += plays.length;
  }

  void admin;
  return report;
}
