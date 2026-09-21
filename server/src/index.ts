import { createServer, type Server as HttpServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { Logger } from 'pino';
import { loadEnv, type Env } from './config/env.js';
import { createLogger } from './config/logger.js';
import { connectMongo, disconnectMongo } from './db/connect.js';
import { createAppContext, type AppContext } from './context.js';
import { createApp } from './http/app.js';
import { createRealtimeServer, type RealtimeServer } from './realtime/server.js';
import type { IdentityVerifier, WebhookVerifier } from './auth/types.js';
import type { Express } from 'express';

export interface RunningServer {
  app: Express;
  httpServer: HttpServer;
  realtime: RealtimeServer;
  ctx: AppContext;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface BuildServerOptions {
  env?: Env;
  logger?: Logger;
  /** Injected by tests/e2e to swap Clerk for the demo/test-mode verifiers. */
  identity?: IdentityVerifier;
  webhook?: WebhookVerifier;
  /** Skip the Mongo connection when the caller manages it (tests). */
  connectDatabase?: boolean;
  /** 0 asks the OS for a free port. */
  port?: number;
}

/**
 * Wires env → Mongo → context → Express → Socket.IO and starts listening.
 * Everything is constructed here (and only here) so tests can boot the real
 * server with injected verifiers instead of mocking the product code.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<RunningServer> {
  const env = options.env ?? loadEnv();
  const logger = options.logger ?? createLogger(env);

  if (options.connectDatabase !== false) {
    await connectMongo(env.MONGO_URI);
  }

  const ctx = createAppContext({
    env,
    logger,
    ...(options.identity ? { identity: options.identity } : {}),
    ...(options.webhook ? { webhook: options.webhook } : {}),
  });

  const app = createApp(ctx);
  const httpServer = createServer(app);
  const realtime = createRealtimeServer(httpServer, ctx);
  ctx.setRealtime(realtime);

  const port = options.port ?? env.PORT;
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => resolve());
  });
  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : port;

  let closed = false;
  return {
    app,
    httpServer,
    realtime,
    ctx,
    port: actualPort,
    url: `http://127.0.0.1:${actualPort}`,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // io.close() also closes the HTTP server it is attached to.
      await realtime.close();
      if (httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
      if (options.connectDatabase !== false) await disconnectMongo();
    },
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env);
  const server = await buildServer({ env, logger });

  logger.info(
    {
      port: server.port,
      url: server.url,
      authMode: env.AUTH_MODE,
      identityVerifier: server.ctx.identity.mode,
      webhookVerifier: server.ctx.webhook.mode,
      mediaDir: env.mediaDir,
      corsOrigins: env.corsOrigins,
    },
    'cadenza api listening',
  );
  if (env.AUTH_MODE === 'demo') {
    logger.warn(
      'AUTH_MODE=demo — sessions are signed locally for development. POST /api/auth/demo-session issues them; set AUTH_MODE=clerk with real Clerk keys for production auth.',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down gracefully');
    try {
      await server.close();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error instanceof Error ? error.message : String(error) }, 'shutdown failed');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    process.stderr.write(`[cadenza] fatal startup error: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
