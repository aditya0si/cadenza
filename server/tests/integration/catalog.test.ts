import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createTestHarness, type TestHarness } from '../helpers/harness.js';
import { seedCatalog, uniqueEventId, type SeededCatalog } from '../helpers/factory.js';
import { PlayEvent, Song } from '../../src/models/index.js';
import { ensureIndexes } from '../../src/db/connect.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;
let catalog: SeededCatalog;
let token: string;

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  await ensureIndexes();
  catalog = await seedCatalog(5);
  ({ token } = await harness.signIn('catalog@cadenza.test'));
});

afterAll(async () => {
  await harness.close();
});

describe('health endpoints', () => {
  it('reports liveness with the active auth mode', async () => {
    const response = await harness.request().get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.service).toBe('cadenza-api');
    expect(response.body.authMode).toBe('demo');
    expect(response.body.realtime).toBe(true);
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('reports readiness against the live Mongo connection', async () => {
    const response = await harness.request().get('/api/health/ready').expect(200);
    expect(response.body).toMatchObject({ status: 'ready', mongo: 'connected', realtime: true });
  });

  it('echoes a caller-supplied request id and mints one otherwise', async () => {
    const echoed = await harness.request().get('/api/health').set('x-request-id', 'req-from-test').expect(200);
    expect(echoed.headers['x-request-id']).toBe('req-from-test');

    const minted = await harness.request().get('/api/health').expect(200);
    expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('catalogue browsing', () => {
  it('paginates songs and reports honest totals', async () => {
    const first = await harness.request().get('/api/songs?limit=2&page=1').expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.total).toBe(5);
    expect(first.body.totalPages).toBe(3);
    expect(first.body.hasMore).toBe(true);

    const last = await harness.request().get('/api/songs?limit=2&page=3').expect(200);
    expect(last.body.items).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
  });

  it('sorts by title when asked and filters by album', async () => {
    const byTitle = await harness.request().get('/api/songs?sort=title&limit=5').expect(200);
    const titles = byTitle.body.items.map((song: { title: string }) => song.title);
    expect(titles).toEqual([...titles].sort((a: string, b: string) => a.localeCompare(b)));

    const byAlbum = await harness.request().get(`/api/songs?albumId=${catalog.albumId}`).expect(200);
    expect(byAlbum.body.total).toBe(5);
    expect(byAlbum.body.items.every((song: { album: { id: string } }) => song.album.id === catalog.albumId)).toBe(true);
  });

  it('rejects a malformed id with a typed validation error', async () => {
    const response = await harness.request().get('/api/songs/not-an-object-id').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.error.details[0].path).toBe('id');
  });

  it('404s an unknown song with the same envelope', async () => {
    const unknown = '6ab11ab1549716cf3bd88199';
    const response = await harness.request().get(`/api/songs/${unknown}`).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('returns ranked full-text search hits across songs', async () => {
    const response = await harness.request().get('/api/search?q=neon').expect(200);
    expect(response.body.query).toBe('neon');
    expect(response.body.songs.map((song: { title: string }) => song.title)).toContain('Neon Rain');
  });

  it('rejects a search term that is too short to be useful', async () => {
    const response = await harness.request().get('/api/search?q=n').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an album with its tracks in track order', async () => {
    const response = await harness.request().get(`/api/albums/${catalog.albumId}`).expect(200);
    expect(response.body.album.id).toBe(catalog.albumId);
    expect(response.body.songs).toHaveLength(5);
    const numbers = response.body.songs.map((song: { trackNumber: number }) => song.trackNumber);
    expect(numbers).toEqual([...numbers].sort((a: number, b: number) => a - b));
  });

  it('returns artist detail with albums and top songs', async () => {
    const response = await harness.request().get(`/api/artists/${catalog.artistId}`).expect(200);
    expect(response.body.artist.name).toBe('Test Signal');
    expect(response.body.albums).toHaveLength(1);
    expect(response.body.topSongs.length).toBeGreaterThan(0);
    expect(response.body.artist.imageUrl).toBe(`/api/media/cover/artist/${catalog.artistId}`);
  });

  it('serves the discover rail from real rows', async () => {
    const response = await harness.request().get('/api/discover').expect(200);
    expect(response.body.featuredAlbums.length).toBeGreaterThan(0);
    expect(response.body.artists.length).toBeGreaterThan(0);
  });
});

describe('play tracking', () => {
  it('requires a session before it will record a play', async () => {
    const response = await harness.request().post(`/api/songs/${catalog.songIds[0]}/play`).send({ source: 'library' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('records a play event, increments the counters and shows up in stats', async () => {
    const songId = catalog.songIds[0];
    const before = await harness.request().get(`/api/songs/${songId}`).expect(200);

    const response = await harness
      .request()
      .post(`/api/songs/${songId}/play`)
      .set('authorization', `Bearer ${token}`)
      .send({ source: 'album' })
      .expect(201);
    expect(response.body.songId).toBe(songId);
    expect(response.body.totalPlays).toBe(1);

    const after = await harness.request().get(`/api/songs/${songId}`).expect(200);
    expect(after.body.song.playCount).toBe(before.body.song.playCount + 1);

    expect(await PlayEvent.countDocuments({ songId })).toBe(1);
    expect(await Song.countDocuments({ _id: songId })).toBe(1);
  });

  it('rejects an unknown play source', async () => {
    const response = await harness
      .request()
      .post(`/api/songs/${catalog.songIds[0]}/play`)
      .set('authorization', `Bearer ${token}`)
      .send({ source: 'telepathy' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts a room-scoped play with a valid room id', async () => {
    const roomId = '6ab11ab1549716cf3bd88177';
    await harness
      .request()
      .post(`/api/songs/${catalog.songIds[1]}/play`)
      .set('authorization', `Bearer ${token}`)
      .send({ source: 'room', roomId })
      .expect(201);
    expect(await PlayEvent.countDocuments({ roomId })).toBe(1);
  });
});

describe('CORS allowlist and 404 handling', () => {
  it('allows a configured origin', async () => {
    const response = await harness
      .request()
      .get('/api/health')
      .set('origin', 'http://localhost:5173')
      .expect(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects an origin outside the allowlist', async () => {
    const response = await harness.request().get('/api/health').set('origin', 'http://evil.example').expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns the typed envelope for unknown routes', async () => {
    const response = await harness.request().get('/api/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toMatch(/No route matches/);
  });
});

describe('demo session route', () => {
  it('issues a token and materialises the user', async () => {
    const { token: demoToken, user } = await harness.signIn('demo-flow@cadenza.test', 'Demo Flow');
    expect(user.email).toBe('demo-flow@cadenza.test');
    expect(user.roles).toEqual(['listener']);

    const me = await harness.request().get('/api/auth/me').set('authorization', `Bearer ${demoToken}`).expect(200);
    expect(me.body.user.id).toBe(user.id);
    expect(me.body.authMode).toBe('demo');
  });

  it('grants admin to the allowlisted demo email', async () => {
    const { user } = await harness.signIn('admin@cadenza.test', 'Demo Admin');
    expect(user.roles).toContain('admin');
  });

  it('rejects a malformed demo session request', async () => {
    const response = await harness.request().post('/api/auth/demo-session').send({ email: 'not-an-email' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a garbage bearer token on /auth/me', async () => {
    const response = await harness.request().get('/api/auth/me').set('authorization', 'Bearer nonsense').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a missing bearer token on /auth/me', async () => {
    const response = await harness.request().get('/api/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

void uniqueEventId;
