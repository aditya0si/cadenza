import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import request from 'supertest';
import { io as ioClient, type Socket } from 'socket.io-client';
import { buildServer, type RunningServer } from '../../src/index.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { DemoIdentityVerifier } from '../../src/auth/identity.js';
import { HmacWebhookVerifier } from '../../src/auth/webhook.js';
import type { UserDto } from '../../src/http/serializers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The real generated library committed in the repo — not a fixture copy. */
export const REPO_MEDIA_DIR = path.resolve(here, '..', '..', '..', 'media');

export interface TestHarness {
  server: RunningServer;
  env: Env;
  api: string;
  request: () => request.Agent;
  /** Signs a demo session through the real HTTP route and returns the bearer token. */
  signIn: (email: string, displayName?: string) => Promise<{ token: string; user: UserDto }>;
  /** Connects a real socket.io client with a session token in the handshake. */
  connectSocket: (token: string) => Promise<Socket>;
  close: () => Promise<void>;
}

export interface HarnessOptions {
  envOverrides?: Record<string, string>;
  webhookSecret?: string;
  mediaDir?: string;
  /**
   * When a test file boots more than one harness, only the first should own the
   * mongoose connection; later ones reuse it (the default connection is a
   * process-wide singleton).
   */
  manageConnection?: boolean;
}

const TEST_WEBHOOK_SECRET = ['test', 'webhook', 'signing', 'secret'].join('-');

export async function createTestHarness(mongoUri: string, options: HarnessOptions = {}): Promise<TestHarness> {
  const manageConnection = options.manageConnection ?? true;
  const dbName = `cadenza_test_${randomBytes(5).toString('hex')}`;
  if (manageConnection) {
    await mongoose.connect(mongoUri, { dbName, serverSelectionTimeoutMS: 10_000 });
  }

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    AUTH_MODE: 'demo',
    MONGO_URI: mongoUri,
    MEDIA_DIR: options.mediaDir ?? REPO_MEDIA_DIR,
    MEDIA_SIGNING_SECRET: ['test', 'media', 'signing', 'secret', 'value'].join('-'),
    RATE_LIMIT_DISABLED: 'true',
    CORS_ORIGINS: 'http://localhost:5173',
    ADMIN_EMAILS: 'admin@cadenza.test',
    ...options.envOverrides,
  } as NodeJS.ProcessEnv);

  const server = await buildServer({
    env,
    logger: createLogger(env),
    identity: new DemoIdentityVerifier(env.demoAuthSecret),
    webhook: new HmacWebhookVerifier(options.webhookSecret ?? TEST_WEBHOOK_SECRET),
    connectDatabase: false,
    port: 0,
  });

  const api = `${server.url}/api`;

  const harness: TestHarness = {
    server,
    env,
    api,
    request: () => request(server.app) as unknown as request.Agent,
    async signIn(email, displayName) {
      const response = await request(server.app)
        .post('/api/auth/demo-session')
        .send({ email, ...(displayName ? { displayName } : {}) })
        .expect(201);
      return { token: response.body.token as string, user: response.body.user as UserDto };
    },
    async connectSocket(token) {
      const socket = ioClient(server.url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token },
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8_000);
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('connect_error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
      return socket;
    },
    async close() {
      await server.close();
      if (!manageConnection) return;
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
      }
    },
  };

  return harness;
}

export const TEST_WEBHOOK_SIGNING_SECRET = TEST_WEBHOOK_SECRET;

/** Waits for a socket event, with a predicate and a hard timeout. */
export function awaitEvent<T = unknown>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 6_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T): void => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Emits with an ack and resolves with the ack payload. */
export function emitWithAck<T = Record<string, unknown>>(
  socket: Socket,
  event: string,
  payload: Record<string, unknown>,
  timeoutMs = 6_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for "${event}"`)), timeoutMs);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export const closeSockets = async (...sockets: Socket[]): Promise<void> => {
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (!socket.connected) {
            resolve();
            return;
          }
          socket.once('disconnect', () => resolve());
          socket.disconnect();
        }),
    ),
  );
};

/** Collects a binary response body so byte-exact assertions are possible. */
export const binaryParser = (res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void): void => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', (error: Error) => callback(error, Buffer.alloc(0)));
};
