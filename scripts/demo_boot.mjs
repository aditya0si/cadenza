#!/usr/bin/env node
/**
 * One-command local demo: in-memory MongoDB + the built API + the built client.
 *
 *   npm run build && npm run demo        # then open http://localhost:4173
 *
 * This exists because the reviewer's machine has no mongod and no Docker daemon:
 * the same `mongodb-memory-server` binary the tests use is booted on a temporary
 * port, the generated media library is seeded into it, and the API runs in demo
 * auth mode so the UI is usable without Clerk keys. Nothing about the production
 * code path changes — only the three environment variables below.
 *
 * Set PORT / WEB_PORT to move either service. Ctrl+C shuts everything down.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'server', 'dist');
const API_PORT = Number(process.env.PORT ?? 4000);
const WEB_PORT = Number(process.env.WEB_PORT ?? 4173);
const MONGOD_VERSION = '8.2.6';

if (!existsSync(path.join(DIST, 'index.js')) || !existsSync(path.join(ROOT, 'client', 'dist', 'index.html'))) {
  process.stderr.write('[demo] build output missing — run "npm run build" first.\n');
  process.exit(1);
}

const load = async (relative) => import(pathToFileURL(path.join(DIST, relative)).href);
const [{ buildServer }, { loadEnv }, { createLogger }, { seedAll }] = await Promise.all([
  load('index.js'),
  load('config/env.js'),
  load('config/logger.js'),
  load('db/seed.js'),
]);

process.stdout.write('\nCADENZA demo boot\n=================\n\n');
const mongo = await MongoMemoryServer.create({ binary: { version: MONGOD_VERSION } });
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'development',
  AUTH_MODE: 'demo',
  MONGO_URI: mongo.getUri(),
  MEDIA_DIR: path.join(ROOT, 'media'),
  MEDIA_SIGNING_SECRET: 'demo-media-signing-secret-value',
  CORS_ORIGINS: `http://localhost:${WEB_PORT},http://localhost:5173`,
  ADMIN_EMAILS: 'admin@cadenza.dev',
  PORT: String(API_PORT),
});

const server = await buildServer({ env, logger: createLogger(env) });
const report = await seedAll(env.mediaDir);

process.stdout.write(
  `[demo] mongod ${MONGOD_VERSION} on ${mongo.getUri()}\n` +
    `[demo] seeded ${report.artists} artists, ${report.albums} albums, ${report.songs} songs, ` +
    `${report.playEvents} play events, ${report.playlists} playlists, ${report.rooms} room\n` +
    `[demo] API      http://localhost:${server.port}/api   (auth mode: ${env.AUTH_MODE})\n`,
);

const web = spawn(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'preview', '--workspace', 'client', '--', '--port', String(WEB_PORT), '--strictPort'],
  { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
);

web.on('exit', (code) => {
  process.stdout.write(`[demo] client preview exited with code ${code}\n`);
});

process.stdout.write(
  `[demo] client   http://localhost:${WEB_PORT}\n\n` +
    `[demo] sign in with demo@cadenza.dev (listener) or admin@cadenza.dev (admin dashboard).\n` +
    `[demo] the UI is in DEMO MODE: sessions are signed locally, not by Clerk.\n` +
    `[demo] Ctrl+C to stop.\n\n`,
);

const shutdown = async (signal) => {
  process.stdout.write(`\n[demo] ${signal} — shutting down\n`);
  web.kill();
  await server.close();
  await mongo.stop();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
