import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { REPO_MEDIA_DIR, binaryParser, createTestHarness, type TestHarness } from '../helpers/harness.js';
import { seedCatalog, type SeededCatalog } from '../helpers/factory.js';
import { Song } from '../../src/models/index.js';
import { buildStreamPath, signStreamToken } from '../../src/media/signing.js';
import { AppError } from '../../src/errors.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;
let catalog: SeededCatalog;
let token: string;
let audioBytes: Buffer;
let audioSize: number;

const AUDIO_REL = 'tracks/neon-rain.mp3';
const sha256 = (buffer: Buffer): string => createHash('sha256').update(buffer).digest('hex');

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  catalog = await seedCatalog(3);
  ({ token } = await harness.signIn('media@cadenza.test'));
  const audioPath = path.join(REPO_MEDIA_DIR, AUDIO_REL);
  audioSize = (await stat(audioPath)).size;
  audioBytes = await readFile(audioPath);
});

afterAll(async () => {
  await harness.close();
});

const firstSongId = (): string => catalog.songIds[0] as string;

describe('signed stream URL issuance', () => {
  it('refuses to mint a URL without a session', async () => {
    const response = await harness.request().get(`/api/songs/${firstSongId()}/stream-url`).expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('mints a short-lived, track-scoped URL for an authenticated listener', async () => {
    const response = await harness
      .request()
      .get(`/api/songs/${firstSongId()}/stream-url`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.songId).toBe(firstSongId());
    expect(response.body.url).toMatch(new RegExp(`^/api/media/stream/${firstSongId()}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
    expect(response.body.ttlSeconds).toBe(300);
    expect(response.body.durationMs).toBe(22_000);
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The URL must not leak the media path or the signing secret.
    expect(JSON.stringify(response.body)).not.toContain('neon-rain.mp3');
    expect(JSON.stringify(response.body)).not.toContain(harness.env.MEDIA_SIGNING_SECRET);
  });

  it('404s for a track that is not in the catalogue', async () => {
    const response = await harness
      .request()
      .get('/api/songs/6ab11ab1549716cf3bd88199/stream-url')
      .set('authorization', `Bearer ${token}`)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('audio streaming with Range support', () => {
  const streamUrl = async (): Promise<string> => {
    const response = await harness
      .request()
      .get(`/api/songs/${firstSongId()}/stream-url`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    return response.body.url as string;
  };

  it('serves the whole file when no Range is requested', async () => {
    const url = await streamUrl();
    const response = await harness
      .request()
      .get(url)
      .parse(binaryParser)
      .expect(200);

    expect(response.headers['content-type']).toBe('audio/mpeg');
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-length']).toBe(String(audioSize));
    expect(response.body).toBeInstanceOf(Buffer);
    expect(response.body.length).toBe(audioSize);
    // Byte-for-byte identical to the generated file on disk.
    expect(sha256(response.body as Buffer)).toBe(sha256(audioBytes));
  });

  it('serves exactly the requested byte window (seek support)', async () => {
    const url = await streamUrl();
    const response = await harness
      .request()
      .get(url)
      .set('range', 'bytes=0-99')
      .parse(binaryParser)
      .expect(206);

    expect(response.headers['content-range']).toBe(`bytes 0-99/${audioSize}`);
    expect(response.headers['content-length']).toBe('100');
    expect((response.body as Buffer).length).toBe(100);
    expect((response.body as Buffer).equals(audioBytes.subarray(0, 100))).toBe(true);
  });

  it('serves an open-ended range to the end of the file', async () => {
    const url = await streamUrl();
    const start = audioSize - 500;
    const response = await harness
      .request()
      .get(url)
      .set('range', `bytes=${start}-`)
      .parse(binaryParser)
      .expect(206);

    expect(response.headers['content-range']).toBe(`bytes ${start}-${audioSize - 1}/${audioSize}`);
    expect((response.body as Buffer).equals(audioBytes.subarray(start))).toBe(true);
  });

  it('serves a suffix range (last N bytes)', async () => {
    const url = await streamUrl();
    const response = await harness
      .request()
      .get(url)
      .set('range', 'bytes=-200')
      .parse(binaryParser)
      .expect(206);

    expect(response.headers['content-range']).toBe(`bytes ${audioSize - 200}-${audioSize - 1}/${audioSize}`);
    expect((response.body as Buffer).equals(audioBytes.subarray(audioSize - 200))).toBe(true);
  });

  it('answers 416 for a range beyond the end of the file', async () => {
    const url = await streamUrl();
    const response = await harness
      .request()
      .get(url)
      .set('range', `bytes=${audioSize + 10}-`)
      .expect(416);

    expect(response.headers['content-range']).toBe(`bytes */${audioSize}`);
    expect(response.body.error.code).toBe('INVALID_RANGE');
  });

  it('rejects a tampered signature', async () => {
    const url = await streamUrl();
    const tampered = url.replace(/sig=[0-9a-f]{8}/, 'sig=deadbeef');
    const response = await harness.request().get(tampered).expect(403);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects a token minted for a different track', async () => {
    const otherSong = catalog.songIds[1] as string;
    const token2 = signStreamToken(harness.env.MEDIA_SIGNING_SECRET, firstSongId(), 300);
    const response = await harness.request().get(buildStreamPath(token2).replace(firstSongId(), otherSong)).expect(403);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects an expired token with 410', async () => {
    const expired = signStreamToken(harness.env.MEDIA_SIGNING_SECRET, firstSongId(), -60);
    const response = await harness.request().get(buildStreamPath(expired)).expect(410);
    expect(response.body.error.code).toBe('EXPIRED_SIGNATURE');
  });

  it('rejects a request with no signature parameters at all', async () => {
    const response = await harness.request().get(`/api/media/stream/${firstSongId()}`).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the song exists but its file is missing from the library', async () => {
    const orphan = await Song.create({
      title: 'Orphan',
      slug: 'orphan-track',
      artistId: catalog.artistId,
      albumId: catalog.albumId,
      durationMs: 1_000,
      audioKey: 'tracks/does-not-exist.mp3',
      coverKey: 'covers/neon-rain.svg',
    });
    const response = await harness
      .request()
      .get(`/api/songs/${String(orphan._id)}/stream-url`)
      .set('authorization', `Bearer ${token}`)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses a stored media key that tries to escape the media directory', async () => {
    const traversal = await Song.create({
      title: 'Traversal',
      slug: 'traversal-track',
      artistId: catalog.artistId,
      durationMs: 1_000,
      audioKey: '../.env',
      coverKey: 'covers/neon-rain.svg',
    });
    const response = await harness
      .request()
      .get(`/api/songs/${String(traversal._id)}/stream-url`)
      .set('authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('cover art', () => {
  it('serves song cover art publicly as SVG', async () => {
    const response = await harness
      .request()
      .get(`/api/media/cover/song/${firstSongId()}`)
      .parse(binaryParser)
      .expect(200);
    expect(response.headers['content-type']).toBe('image/svg+xml');
    expect((response.body as Buffer).toString('utf8')).toContain('<svg');
  });

  it('serves album and artist cover art', async () => {
    await harness.request().get(`/api/media/cover/album/${catalog.albumId}`).expect(200);
    await harness.request().get(`/api/media/cover/artist/${catalog.artistId}`).expect(200);
  });

  it('404s for an unknown cover and 400s for a bogus kind', async () => {
    const missing = await harness.request().get('/api/media/cover/song/6ab11ab1549716cf3bd88199').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
    await harness.request().get(`/api/media/cover/poster/${firstSongId()}`).expect(400);
  });
});

void AppError;
