#!/usr/bin/env node
/**
 * CADENZA realtime propagation latency probe.
 *
 *   npm run build && npm run latency
 *
 * Boots the real built API against an in-memory mongod, signs in two listeners,
 * puts them in the same listening room, then measures how long a server-side
 * broadcast takes to reach the other listener, over 220 events per channel:
 *
 *   1. chat:message      → chat:message   (full round trip: server persists, then fans out)
 *   2. playback:seek     → playback:state (server-authoritative clock broadcast)
 *
 * Latency is measured on the receiving client as `Date.now() - sentAt`, where
 * sentAt is stamped immediately before the emit. p50/p95/min/max are reported;
 * the numbers printed here are the ones quoted in the README.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { io as ioClient } from 'socket.io-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'server', 'dist');
const MONGOD_VERSION = '8.2.6';
const EVENTS = Number(process.env.LATENCY_EVENTS ?? 220);
const WARMUP = 20;

if (!existsSync(path.join(DIST, 'index.js'))) {
  process.stderr.write('[latency] server build not found — run "npm run build" first.\n');
  process.exit(1);
}

const load = async (relative) => import(pathToFileURL(path.join(DIST, relative)).href);
const [{ buildServer }, { loadEnv }, { createLogger }, { DemoIdentityVerifier }, { HmacWebhookVerifier }, { seedAll }] =
  await Promise.all([
    load('index.js'),
    load('config/env.js'),
    load('config/logger.js'),
    load('auth/identity.js'),
    load('auth/webhook.js'),
    load('db/seed.js'),
  ]);

const mongo = await MongoMemoryServer.create({ binary: { version: MONGOD_VERSION } });
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  AUTH_MODE: 'demo',
  MONGO_URI: mongo.getUri(),
  MEDIA_DIR: path.join(ROOT, 'media'),
  MEDIA_SIGNING_SECRET: ['latency', 'probe', 'signing', 'secret'].join('-'),
  RATE_LIMIT_DISABLED: 'true',
  // The probe deliberately exceeds the interactive chat burst limit.
  SOCKET_CHAT_BURST: String(EVENTS + 50),
  SOCKET_CHAT_REFILL_PER_SEC: '1000',
  CORS_ORIGINS: 'http://localhost:5173',
});

const server = await buildServer({
  env,
  logger: createLogger(env),
  identity: new DemoIdentityVerifier(env.demoAuthSecret),
  webhook: new HmacWebhookVerifier(env.demoAuthSecret),
  port: 0,
});
await seedAll(env.mediaDir);

const api = `${server.url}/api`;
const post = async (url, body, token) => {
  const response = await fetch(`${api}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(server.url, { transports: ['websocket'], reconnection: false, auth: { token } });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

const emitAck = (socket, event, payload) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 10_000);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

const percentile = (sorted, p) => {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const summarise = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    mean: Number(mean.toFixed(2)),
  };
};

const runChannel = async ({ name, sender, receiver, event, payloadFor, receivedEvent, predicate, expectedAcks }) => {
  const samples = [];
  let duplicates = 0;

  const roundTrip = async (index, warmup) => {
    const sentAt = Date.now();
    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        receiver.off(receivedEvent, handler);
        reject(new Error(`timeout waiting for ${receivedEvent}`));
      }, 10_000);
      const handler = (message) => {
        if (!predicate(message, index)) return;
        clearTimeout(timer);
        receiver.off(receivedEvent, handler);
        resolve(message);
      };
      receiver.on(receivedEvent, handler);
    });

    const ack = await emitAck(sender, event, payloadFor(index));
    if (ack?.ok !== true) throw new Error(`${event} rejected: ${JSON.stringify(ack?.error ?? ack)}`);
    if (ack.duplicate === true) duplicates += 1;
    await received;
    if (!warmup) samples.push(Date.now() - sentAt);
  };

  for (let index = 0; index < WARMUP; index += 1) await roundTrip(index, true);
  for (let index = 0; index < EVENTS; index += 1) await roundTrip(index, false);

  const summary = summarise(samples);
  if (expectedAcks !== undefined && duplicates !== 0) {
    throw new Error(`${name}: ${duplicates} unexpected duplicate acks`);
  }
  return summary;
};

const eventId = (prefix, index) => `${prefix}-${index}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

process.stdout.write(`\nCADENZA realtime latency probe (${EVENTS} events per channel)\n============================================================\n`);
process.stdout.write(`mongod ${MONGOD_VERSION} + API on ${server.url}\n\n`);

const host = await post('/auth/demo-session', { email: 'latency-host@cadenza.dev', displayName: 'Latency Host' });
const guest = await post('/auth/demo-session', { email: 'latency-guest@cadenza.dev', displayName: 'Latency Guest' });
const room = await post('/rooms', { name: 'Latency Lab', visibility: 'public' }, host.body.token);
await post(`/rooms/${room.body.room.id}/join`, {}, guest.body.token);

const songs = await fetch(`${api}/songs?limit=1`).then((response) => response.json());
const songId = songs.items[0].id;

const hostSocket = await connect(host.body.token);
const guestSocket = await connect(guest.body.token);
await emitAck(hostSocket, 'room:join', { roomId: room.body.room.id });
await emitAck(guestSocket, 'room:join', { roomId: room.body.room.id });
await emitAck(hostSocket, 'queue:add', { roomId: room.body.room.id, songId, eventId: eventId('queue', 0) });
await emitAck(hostSocket, 'playback:track', { roomId: room.body.room.id, songId, eventId: eventId('track', 0) });

const results = {};

results['chat:message → chat:message'] = await runChannel({
  name: 'chat',
  sender: guestSocket,
  receiver: hostSocket,
  event: 'chat:message',
  receivedEvent: 'chat:message',
  payloadFor: (index) => ({
    roomId: room.body.room.id,
    body: `latency sample ${index}`,
    eventId: eventId('chat', index),
    clientSentAt: Date.now(),
  }),
  predicate: (message, index) => message?.message?.body === `latency sample ${index}`,
  expectedAcks: 0,
});

results['playback:seek → playback:state'] = await runChannel({
  name: 'playback',
  sender: hostSocket,
  receiver: guestSocket,
  event: 'playback:seek',
  receivedEvent: 'playback:state',
  payloadFor: (index) => ({
    roomId: room.body.room.id,
    positionMs: 1_000 + index * 10,
    eventId: eventId('seek', index),
  }),
  predicate: (state, index) => state?.positionMs === 1_000 + index * 10,
});

process.stdout.write('channel                                  n     min    p50    p90    p95    p99    max   mean\n');
process.stdout.write('---------------------------------------------------------------------------------------------\n');
for (const [name, summary] of Object.entries(results)) {
  process.stdout.write(
    `${name.padEnd(38)} ${String(summary.samples).padStart(4)} ` +
      `${String(summary.min).padStart(6)} ${String(summary.p50).padStart(6)} ${String(summary.p90).padStart(6)} ` +
      `${String(summary.p95).padStart(6)} ${String(summary.p99).padStart(6)} ${String(summary.max).padStart(6)} ` +
      `${String(summary.mean).padStart(6)}\n`,
  );
}
process.stdout.write('\nJSON\n');
process.stdout.write(`${JSON.stringify({ eventsPerChannel: EVENTS, warmup: WARMUP, results }, null, 2)}\n`);

hostSocket.disconnect();
guestSocket.disconnect();
await server.close();
await mongo.stop();
