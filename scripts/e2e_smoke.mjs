#!/usr/bin/env node
/**
 * CADENZA end-to-end smoke test.
 *
 *   npm run build && npm run e2e
 *
 * Boots the REAL built API (server/dist) against an in-memory mongod, seeds the
 * committed media library, registers test identities through the demo-session
 * auth path, and then walks the actual HTTP + Socket.IO flow a listener would:
 *
 *   health → demo sign-in → browse → signed audio URL + Range read → create room
 *   → join as a second listener → queue a track → host changes track → play →
 *   drift report → chat → forced disconnect + resync → playlist → admin stats
 *   → Clerk webhook sync (test-mode verifier) → chat history
 *
 * Every step is timed and reported; the process exits non-zero if any step fails.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'server', 'dist');
const MONGOD_VERSION = '8.2.6';

const load = async (relative) => import(pathToFileURL(path.join(DIST, relative)).href);

if (!existsSync(path.join(DIST, 'index.js'))) {
  process.stderr.write(
    `[e2e] server build not found at ${path.join(DIST, 'index.js')} — run "npm run build" first.\n`,
  );
  process.exit(1);
}

const [{ buildServer }, { loadEnv }, { createLogger }, { DemoIdentityVerifier }, { HmacWebhookVerifier }, { seedAll }] =
  await Promise.all([
    load('index.js'),
    load('config/env.js'),
    load('config/logger.js'),
    load('auth/identity.js'),
    load('auth/webhook.js'),
    load('db/seed.js'),
  ]);

const WEBHOOK_SECRET = 'e2e-webhook-signing-secret';

// ---------------------------------------------------------------------------
// tiny harness
// ---------------------------------------------------------------------------
const results = [];
let currentStep = null;

const step = async (name, fn) => {
  const started = Date.now();
  currentStep = name;
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? '' });
    process.stdout.write(`  PASS  ${name.padEnd(46)} ${String(Date.now() - started).padStart(5)} ms  ${detail ?? ''}\n`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: error instanceof Error ? error.message : String(error) });
    process.stdout.write(
      `  FAIL  ${name.padEnd(46)} ${String(Date.now() - started).padStart(5)} ms  ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  currentStep = null;
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const waitFor = (socket, event, predicate = () => true, timeoutMs = 8_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"${currentStep ? ` during "${currentStep}"` : ''}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });

const emitAck = (socket, event, payload, timeoutMs = 8_000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for "${event}"`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

const connectSocket = (url, token) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ['websocket'], reconnection: false, auth: { token } });
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

const eventId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
process.stdout.write('\nCADENZA e2e smoke test\n======================\n\n');
const bootStarted = Date.now();
const mongo = await MongoMemoryServer.create({ binary: { version: MONGOD_VERSION } });
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AUTH_MODE: 'demo',
  MONGO_URI: mongo.getUri(),
  MEDIA_DIR: path.join(ROOT, 'media'),
  MEDIA_SIGNING_SECRET: 'e2e-media-signing-secret-value',
  RATE_LIMIT_DISABLED: 'true',
  SOCKET_CHAT_BURST: '500',
  SOCKET_CHAT_REFILL_PER_SEC: '500',
  ADMIN_EMAILS: 'admin@cadenza.dev',
  CORS_ORIGINS: 'http://localhost:5173',
});

const server = await buildServer({
  env,
  logger: createLogger(env),
  identity: new DemoIdentityVerifier(env.demoAuthSecret),
  webhook: new HmacWebhookVerifier(WEBHOOK_SECRET),
  port: 0,
});

const api = `${server.url}/api`;
const json = async (response) => {
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
};

const call = async (method, url, { token, body, headers } = {}) => {
  const response = await fetch(url.startsWith('http') ? url : `${api}${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, headers: response.headers, body: await response.json().catch(() => null), raw: response };
};

process.stdout.write(`[e2e] mongod ${MONGOD_VERSION} + API on ${server.url} in ${Date.now() - bootStarted} ms\n\n`);

const state = { hostToken: null, guestToken: null, adminToken: null, roomId: null, songIds: [], sockets: [] };

// ---------------------------------------------------------------------------
// the flow
// ---------------------------------------------------------------------------
await step('seed the generated media library', async () => {
  const report = await seedAll(env.mediaDir);
  assert(report.songs === 8, `expected 8 seeded songs, got ${report.songs}`);
  assert(report.playEvents > 0, 'expected seeded play events for the admin chart');
  return `${report.artists} artists / ${report.albums} albums / ${report.songs} songs / ${report.playEvents} plays`;
});

await step('GET /api/health reports the running service', async () => {
  const response = await call('GET', '/health');
  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.body.status === 'ok', 'health status was not ok');
  assert(response.body.authMode === 'demo', 'expected demo auth mode');
  return `authMode=${response.body.authMode} realtime=${response.body.realtime}`;
});

await step('POST /api/auth/demo-session issues two listeners', async () => {
  const host = await call('POST', '/auth/demo-session', { body: { email: 'e2e-host@cadenza.dev', displayName: 'E2E Host' } });
  const guest = await call('POST', '/auth/demo-session', { body: { email: 'e2e-guest@cadenza.dev', displayName: 'E2E Guest' } });
  assert(host.status === 201 && guest.status === 201, 'demo sign-in failed');
  state.hostToken = host.body.token;
  state.guestToken = guest.body.token;
  assert(typeof state.hostToken === 'string' && state.hostToken.length > 20, 'no token returned');
  return `host=${host.body.user.id.slice(-6)} guest=${guest.body.user.id.slice(-6)}`;
});

await step('GET /api/songs browses the seeded catalogue', async () => {
  const response = await call('GET', '/songs?limit=4&sort=title');
  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.body.total === 8, `expected 8 songs, got ${response.body.total}`);
  state.songIds = response.body.items.map((song) => song.id);
  return `${response.body.total} songs, first="${response.body.items[0].title}"`;
});

await step('GET /api/search ranks full-text hits', async () => {
  const response = await call('GET', '/search?q=neon');
  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.body.songs.length >= 1, 'expected at least one song hit for "neon"');
  return `songs=${response.body.songs.length} artists=${response.body.artists.length}`;
});

await step('GET /api/songs/:id/stream-url + Range read of real audio', async () => {
  const issued = await call('GET', `/songs/${state.songIds[0]}/stream-url`, { token: state.hostToken });
  assert(issued.status === 200, `expected 200, got ${issued.status}`);
  assert(issued.body.url.startsWith('/api/media/stream/'), 'unexpected stream url');

  const partial = await fetch(`${server.url}${issued.body.url}`, { headers: { range: 'bytes=0-99' } });
  const bytes = Buffer.from(await partial.arrayBuffer());
  assert(partial.status === 206, `expected 206, got ${partial.status}`);
  assert(bytes.length === 100, `expected 100 bytes, got ${bytes.length}`);
  assert(/^bytes 0-99\/\d+$/.test(partial.headers.get('content-range') ?? ''), 'bad content-range header');

  const full = await fetch(`${server.url}${issued.body.url}`);
  const whole = Buffer.from(await full.arrayBuffer());
  assert(full.status === 200 && whole.length > 100_000, `expected the full track, got ${whole.length} bytes`);
  return `206 slice=100B, full=${(whole.length / 1024).toFixed(0)} KB, ttl=${issued.body.ttlSeconds}s`;
});

await step('POST /api/rooms creates a room and the guest joins', async () => {
  const created = await call('POST', '/rooms', { token: state.hostToken, body: { name: 'E2E Listening Room', visibility: 'public' } });
  assert(created.status === 201, `expected 201, got ${created.status}`);
  state.roomId = created.body.room.id;
  assert(created.body.room.members.length === 1, 'host should be the only member at creation');

  const joined = await call('POST', `/rooms/${state.roomId}/join`, { token: state.guestToken });
  assert(joined.status === 200, `expected 200, got ${joined.status}`);
  assert(joined.body.room.members.length === 2, 'guest did not join');
  return `room=${state.roomId.slice(-6)} members=${joined.body.room.members.length}`;
});

await step('socket handshake rejects an unauthenticated client', async () => {
  try {
    const socket = await connectSocket(server.url, 'forged-token');
    socket.disconnect();
    throw new Error('expected the handshake to be rejected');
  } catch (error) {
    assert(/UNAUTHENTICATED/.test(error.message), `unexpected error: ${error.message}`);
    return 'rejected with UNAUTHENTICATED';
  }
});

await step('both listeners join the room over sockets', async () => {
  const host = await connectSocket(server.url, state.hostToken);
  const guest = await connectSocket(server.url, state.guestToken);
  state.sockets.push(host, guest);

  const hostAck = await emitAck(host, 'room:join', { roomId: state.roomId });
  const guestAck = await emitAck(guest, 'room:join', { roomId: state.roomId });
  assert(hostAck.ok && guestAck.ok, 'room:join failed');
  assert(hostAck.snapshot.room.members.length === 2, 'snapshot did not include both members');
  return `members=${hostAck.snapshot.room.members.length} queue=${hostAck.snapshot.room.queue.length}`;
});

await step('guest queues a track and the host receives it', async () => {
  const [host, guest] = state.sockets;
  const broadcast = waitFor(host, 'queue:updated');
  const ack = await emitAck(guest, 'queue:add', {
    roomId: state.roomId,
    songId: state.songIds[1],
    eventId: eventId('queue'),
  });
  assert(ack.ok, `queue:add failed: ${JSON.stringify(ack.error ?? {})}`);
  const received = await broadcast;
  assert(received.queue.length === 1, 'queue did not grow');
  return `queue=${received.queue.length} track="${received.queue[0].title}"`;
});

await step('replayed queue:add is idempotent', async () => {
  const [host, guest] = state.sockets;
  const id = eventId('queue-replay');
  await emitAck(guest, 'queue:add', { roomId: state.roomId, songId: state.songIds[2], eventId: id });
  const replay = await emitAck(guest, 'queue:add', { roomId: state.roomId, songId: state.songIds[2], eventId: id });
  assert(replay.ok && replay.duplicate === true, 'expected the replay to be flagged as a duplicate');
  assert(replay.queue.length === 2, `queue should still hold 2 tracks, holds ${replay.queue.length}`);
  void host;
  return `duplicate=true queue=${replay.queue.length}`;
});

await step('host changes track, play/pause/seek propagate', async () => {
  const [host, guest] = state.sockets;
  const changed = waitFor(guest, 'track:changed');
  const change = await emitAck(host, 'playback:track', {
    roomId: state.roomId,
    songId: state.songIds[1],
    eventId: eventId('track'),
  });
  assert(change.ok, 'playback:track failed');
  assert((await changed).songId === state.songIds[1], 'wrong track broadcast');

  const playing = waitFor(guest, 'playback:state', (payload) => payload.isPlaying === true);
  const play = await emitAck(host, 'playback:play', { roomId: state.roomId, positionMs: 4_000, eventId: eventId('play') });
  assert(play.ok, 'playback:play failed');
  const stateAfterPlay = await playing;
  assert(Math.abs(stateAfterPlay.positionMs - 4_000) < 1_500, `unexpected position ${stateAfterPlay.positionMs}`);

  const paused = waitFor(guest, 'playback:state', (payload) => payload.isPlaying === false);
  await emitAck(guest, 'playback:pause', { roomId: state.roomId, positionMs: 0, eventId: eventId('pause') });
  const stateAfterPause = await paused;
  assert(stateAfterPause.positionMs >= 4_000, 'pause should keep the elapsed position');
  return `track ok, paused at ${stateAfterPause.positionMs} ms`;
});

await step('non-host cannot change the track', async () => {
  const [, guest] = state.sockets;
  const denied = await emitAck(guest, 'playback:track', {
    roomId: state.roomId,
    songId: state.songIds[0],
    eventId: eventId('track-denied'),
  });
  assert(denied.ok === false && denied.error.code === 'FORBIDDEN', `expected FORBIDDEN, got ${JSON.stringify(denied)}`);
  return 'rejected with FORBIDDEN';
});

await step('drift report snaps a lagging client back', async () => {
  const [host, guest] = state.sockets;
  await emitAck(host, 'playback:play', { roomId: state.roomId, positionMs: 2_000, eventId: eventId('play') });

  const snap = waitFor(guest, 'playback:snap');
  const drifted = await emitAck(guest, 'playback:report', {
    roomId: state.roomId,
    positionMs: 90_000,
    eventId: eventId('report'),
  });
  assert(drifted.ok && drifted.snapped === true, 'expected the drifted client to be snapped');
  const payload = await snap;
  assert(payload.reason === 'drift', 'snap reason missing');
  return `drift=${drifted.driftMs} ms → snapped to ${payload.positionMs} ms`;
});

await step('chat broadcasts to the room', async () => {
  const [host, guest] = state.sockets;
  const received = waitFor(host, 'chat:message');
  const ack = await emitAck(guest, 'chat:message', { roomId: state.roomId, body: 'e2e says hello', eventId: eventId('chat') });
  assert(ack.ok, 'chat:message failed');
  const broadcast = await received;
  assert(broadcast.message.body === 'e2e says hello', 'wrong message body');
  return `author=${broadcast.message.author.displayName}`;
});

await step('forced disconnect then resync restores full state', async () => {
  const [host, guest] = state.sockets;
  guest.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 150));

  const reconnected = await connectSocket(server.url, state.guestToken);
  state.sockets.push(reconnected);
  const ack = await emitAck(reconnected, 'room:resync', { roomId: state.roomId });
  assert(ack.ok && ack.resynced === true, 'resync failed');
  const room = ack.snapshot.room;
  assert(room.queue.length === 2, `expected 2 queued tracks after resync, got ${room.queue.length}`);
  assert(room.playback.trackId === state.songIds[1], 'playback track lost after resync');
  assert(room.playback.isPlaying === true, 'playback state lost after resync');
  void host;
  return `queue=${room.queue.length} playing=${room.playback.isPlaying} pos=${room.playback.positionMs} ms`;
});

await step('GET /api/rooms/:id/messages returns the chat history', async () => {
  const response = await call('GET', `/rooms/${state.roomId}/messages?limit=10`, { token: state.hostToken });
  assert(response.status === 200, `expected 200, got ${response.status}`);
  assert(response.body.items.some((message) => message.body === 'e2e says hello'), 'chat message was not persisted');
  return `${response.body.items.length} messages`;
});

await step('playlist create → add track → reorder', async () => {
  const created = await call('POST', '/playlists', {
    token: state.hostToken,
    body: { name: 'E2E Mix', description: 'created by the smoke test', visibility: 'public' },
  });
  assert(created.status === 201, `expected 201, got ${created.status}`);
  const playlistId = created.body.playlist.id;

  await call('POST', `/playlists/${playlistId}/songs`, { token: state.hostToken, body: { songId: state.songIds[0] } });
  const added = await call('POST', `/playlists/${playlistId}/songs`, { token: state.hostToken, body: { songId: state.songIds[1] } });
  assert(added.body.playlist.trackCount === 2, `expected 2 tracks, got ${added.body.playlist.trackCount}`);

  const reordered = await call('PUT', `/playlists/${playlistId}/order`, {
    token: state.hostToken,
    body: { songIds: [state.songIds[1], state.songIds[0]] },
  });
  assert(reordered.status === 200, `reorder failed with ${reordered.status}`);
  assert(reordered.body.playlist.songs[0].id === state.songIds[1], 'reorder did not take effect');
  return `tracks=${reordered.body.playlist.trackCount} durationMs=${reordered.body.playlist.durationMs}`;
});

await step('admin stats reflect the real activity', async () => {
  const admin = await call('POST', '/auth/demo-session', { body: { email: 'admin@cadenza.dev', displayName: 'E2E Admin' } });
  assert(admin.status === 201, 'admin demo sign-in failed');
  state.adminToken = admin.body.token;
  assert(admin.body.user.roles.includes('admin'), 'allowlisted email did not receive the admin role');

  const overview = await call('GET', '/stats/overview', { token: state.adminToken });
  assert(overview.status === 200, `expected 200, got ${overview.status}`);
  assert(overview.body.songs === 8, `expected 8 songs in stats, got ${overview.body.songs}`);
  assert(overview.body.rooms >= 1 && overview.body.users >= 3, 'stats under-counted rooms/users');

  const plays = await call('GET', '/stats/plays?days=7', { token: state.adminToken });
  assert(plays.body.buckets.length > 0, 'plays-over-time returned no buckets');

  const top = await call('GET', '/stats/top-tracks?limit=3', { token: state.adminToken });
  assert(top.body.tracks.length > 0, 'top tracks returned nothing');

  const rooms = await call('GET', '/stats/active-rooms?limit=5', { token: state.adminToken });
  assert(rooms.body.rooms.length > 0, 'active rooms returned nothing');

  const denied = await call('GET', '/stats/overview', { token: state.hostToken });
  assert(denied.status === 403, `expected 403 for a listener, got ${denied.status}`);
  return `songs=${overview.body.songs} users=${overview.body.users} playEvents=${overview.body.playEvents} buckets=${plays.body.buckets.length}`;
});

await step('Clerk webhook sync (test-mode verifier) creates the mirror', async () => {
  const { createHmac } = await import('node:crypto');
  const payload = JSON.stringify({
    type: 'user.created',
    data: {
      id: 'user_e2e_webhook',
      first_name: 'Webhook',
      last_name: 'Synced',
      image_url: null,
      primary_email_address_id: 'idn_e2e',
      email_addresses: [{ id: 'idn_e2e', email_address: 'webhook-e2e@cadenza.dev' }],
      public_metadata: { roles: ['listener'] },
    },
  });
  const response = await fetch(`${api}/webhooks/clerk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cadenza-signature': createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex') },
    body: payload,
  });
  const body = await response.json();
  assert(response.status === 200 && body.handled === true, `webhook sync failed: ${response.status} ${JSON.stringify(body)}`);

  const unsigned = await fetch(`${api}/webhooks/clerk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
  assert(unsigned.status === 403, `expected 403 without a signature, got ${unsigned.status}`);
  return `handled=${body.type}, unsigned rejected with ${unsigned.status}`;
});

// ---------------------------------------------------------------------------
// teardown + summary
// ---------------------------------------------------------------------------
for (const socket of state.sockets) {
  if (socket.connected) socket.disconnect();
}
await server.close();
await mongo.stop();

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
const totalMs = results.reduce((sum, result) => sum + result.ms, 0);

process.stdout.write(
  `\n-----------------------------\n` +
    `steps: ${results.length}   PASS: ${passed}   FAIL: ${failed}\n` +
    `step time total: ${totalMs} ms   wall clock: ${Date.now() - bootStarted} ms\n` +
    `RESULT: ${failed === 0 ? 'PASS' : 'FAIL'}\n\n`,
);

if (failed > 0) {
  process.stdout.write('failed steps:\n');
  for (const result of results.filter((entry) => !entry.ok)) {
    process.stdout.write(`  - ${result.name}: ${result.detail}\n`);
  }
}
process.exit(failed === 0 ? 0 : 1);
