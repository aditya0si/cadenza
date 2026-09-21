import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createTestHarness, type TestHarness } from '../helpers/harness.js';
import { createPlaylist, seedCatalog, type SeededCatalog } from '../helpers/factory.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;
let catalog: SeededCatalog;
let ownerToken: string;
let otherToken: string;
let adminToken: string;

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  catalog = await seedCatalog(4);
  ({ token: ownerToken } = await harness.signIn('owner@cadenza.test', 'Playlist Owner'));
  ({ token: otherToken } = await harness.signIn('other@cadenza.test', 'Other Listener'));
  ({ token: adminToken } = await harness.signIn('admin@cadenza.test', 'Cadenza Admin'));
});

afterAll(async () => {
  await harness.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('playlist creation and reads', () => {
  it('requires a session to create a playlist', async () => {
    const response = await harness.request().post('/api/playlists').send({ name: 'Nope' }).expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('creates a private playlist owned by the caller', async () => {
    const response = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Deep Focus', description: 'long session', visibility: 'private' })
      .expect(201);
    expect(response.body.playlist.visibility).toBe('private');
    expect(response.body.playlist.trackCount).toBe(0);
    expect(response.body.playlist.durationMs).toBe(0);
  });

  it('rejects an empty playlist name', async () => {
    const response = await harness.request().post('/api/playlists').set(auth(ownerToken)).send({ name: '' }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('lets the owner read a private playlist but not another listener', async () => {
    const { body } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Owner Only' })
      .expect(201);
    const playlistId = body.playlist.id as string;

    await harness.request().get(`/api/playlists/${playlistId}`).set(auth(ownerToken)).expect(200);
    const denied = await harness.request().get(`/api/playlists/${playlistId}`).set(auth(otherToken)).expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('lets any signed-in listener read a public playlist, and admins read anything', async () => {
    const { body } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Public Mix', visibility: 'public' })
      .expect(201);
    const playlistId = body.playlist.id as string;

    await harness.request().get(`/api/playlists/${playlistId}`).set(auth(otherToken)).expect(200);

    const { body: privateBody } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Admin Eyes Only' })
      .expect(201);
    await harness.request().get(`/api/playlists/${privateBody.playlist.id}`).set(auth(adminToken)).expect(200);
  });

  it('404s an unknown playlist', async () => {
    const response = await harness
      .request()
      .get('/api/playlists/6ab11ab1549716cf3bd88199')
      .set(auth(ownerToken))
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});

describe('playlist track management', () => {
  let playlistId: string;

  beforeAll(async () => {
    const { body } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Track Ops' })
      .expect(201);
    playlistId = body.playlist.id as string;
  });

  it('adds tracks and reports the running duration', async () => {
    const response = await harness
      .request()
      .post(`/api/playlists/${playlistId}/songs`)
      .set(auth(ownerToken))
      .send({ songId: catalog.songIds[0] })
      .expect(201);
    expect(response.body.playlist.trackCount).toBe(1);
    expect(response.body.playlist.durationMs).toBe(22_000);
    expect(response.body.playlist.songs[0].title).toBe('Neon Rain');
  });

  it('refuses a duplicate track', async () => {
    const response = await harness
      .request()
      .post(`/api/playlists/${playlistId}/songs`)
      .set(auth(ownerToken))
      .send({ songId: catalog.songIds[0] })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('404s an unknown track and 403s a non-owner', async () => {
    await harness
      .request()
      .post(`/api/playlists/${playlistId}/songs`)
      .set(auth(ownerToken))
      .send({ songId: '6ab11ab1549716cf3bd88199' })
      .expect(404);

    const denied = await harness
      .request()
      .post(`/api/playlists/${playlistId}/songs`)
      .set(auth(otherToken))
      .send({ songId: catalog.songIds[1] })
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('reorders tracks when given the complete order', async () => {
    for (const songId of [catalog.songIds[1], catalog.songIds[2]]) {
      await harness.request().post(`/api/playlists/${playlistId}/songs`).set(auth(ownerToken)).send({ songId }).expect(201);
    }
    const desired = [catalog.songIds[2], catalog.songIds[0], catalog.songIds[1]];
    const response = await harness
      .request()
      .put(`/api/playlists/${playlistId}/order`)
      .set(auth(ownerToken))
      .send({ songIds: desired })
      .expect(200);
    expect(response.body.playlist.songs.map((song: { id: string }) => song.id)).toEqual(desired);
  });

  it('rejects an incomplete, duplicated or foreign reorder payload', async () => {
    const incomplete = await harness
      .request()
      .put(`/api/playlists/${playlistId}/order`)
      .set(auth(ownerToken))
      .send({ songIds: [catalog.songIds[0]] })
      .expect(400);
    expect(incomplete.body.error.code).toBe('VALIDATION_ERROR');

    const duplicated = await harness
      .request()
      .put(`/api/playlists/${playlistId}/order`)
      .set(auth(ownerToken))
      .send({ songIds: [catalog.songIds[0], catalog.songIds[0], catalog.songIds[1]] })
      .expect(400);
    expect(duplicated.body.error.message).toMatch(/twice/);

    const foreign = await harness
      .request()
      .put(`/api/playlists/${playlistId}/order`)
      .set(auth(ownerToken))
      .send({ songIds: [catalog.songIds[0], catalog.songIds[1], catalog.songIds[3]] })
      .expect(400);
    expect(foreign.body.error.message).toMatch(/not in this playlist/);
  });

  it('removes a track and 404s when it is not there', async () => {
    const response = await harness
      .request()
      .delete(`/api/playlists/${playlistId}/songs/${catalog.songIds[2]}`)
      .set(auth(ownerToken))
      .expect(200);
    expect(response.body.playlist.trackCount).toBe(2);

    const missing = await harness
      .request()
      .delete(`/api/playlists/${playlistId}/songs/${catalog.songIds[2]}`)
      .set(auth(ownerToken))
      .expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});

describe('playlist updates, deletion and listing scopes', () => {
  it('lets only the owner (or an admin) patch and delete', async () => {
    const { body } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'Patch Me' })
      .expect(201);
    const playlistId = body.playlist.id as string;

    await harness
      .request()
      .patch(`/api/playlists/${playlistId}`)
      .set(auth(otherToken))
      .send({ name: 'Hijacked' })
      .expect(403);

    const patched = await harness
      .request()
      .patch(`/api/playlists/${playlistId}`)
      .set(auth(ownerToken))
      .send({ name: 'Patched', visibility: 'public' })
      .expect(200);
    expect(patched.body.playlist.name).toBe('Patched');
    expect(patched.body.playlist.visibility).toBe('public');

    await harness.request().delete(`/api/playlists/${playlistId}`).set(auth(otherToken)).expect(403);
    await harness.request().delete(`/api/playlists/${playlistId}`).set(auth(adminToken)).expect(204);
    await harness.request().get(`/api/playlists/${playlistId}`).set(auth(adminToken)).expect(404);
  });

  it('rejects an empty patch body', async () => {
    const { body } = await harness
      .request()
      .post('/api/playlists')
      .set(auth(ownerToken))
      .send({ name: 'No Patch' })
      .expect(201);
    const response = await harness
      .request()
      .patch(`/api/playlists/${body.playlist.id}`)
      .set(auth(ownerToken))
      .send({})
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('scopes listing to mine, public or everything I can see', async () => {
    const ownerId = (await harness.request().get('/api/auth/me').set(auth(ownerToken)).expect(200)).body.user.id as string;
    await createPlaylist({ ownerId, name: 'Scoped private', visibility: 'private' });
    await createPlaylist({ ownerId, name: 'Scoped public', visibility: 'public' });

    const mine = await harness.request().get('/api/playlists?scope=mine&limit=50').set(auth(ownerToken)).expect(200);
    expect(mine.body.items.every((playlist: { visibility: string }) => typeof playlist.visibility === 'string')).toBe(true);

    const publicOnly = await harness.request().get('/api/playlists?scope=public&limit=50').expect(200);
    expect(publicOnly.body.items.length).toBeGreaterThan(0);
    expect(publicOnly.body.items.every((playlist: { visibility: string }) => playlist.visibility === 'public')).toBe(true);

    const otherView = await harness.request().get('/api/playlists?scope=all&limit=50').set(auth(otherToken)).expect(200);
    expect(otherView.body.items.every((playlist: { visibility: string }) => playlist.visibility === 'public')).toBe(true);

    const ownerView = await harness.request().get('/api/playlists?scope=all&limit=50').set(auth(ownerToken)).expect(200);
    expect(ownerView.body.total).toBeGreaterThanOrEqual(publicOnly.body.total);
  });

  it('requires a session for scope=mine', async () => {
    const response = await harness.request().get('/api/playlists?scope=mine').expect(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('paginates playlists honestly', async () => {
    const response = await harness.request().get('/api/playlists?scope=public&limit=1&page=1').expect(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.limit).toBe(1);
    expect(response.body.total).toBeGreaterThan(0);
  });
});
