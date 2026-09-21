import { createServer } from 'node:http';
import cors from 'cors';
import express, { type Express, type Request } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import { createApiRouter } from './routes/index.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';

/**
 * The HTTP app: correlation ids + structured logs first, then security headers,
 * a strict CORS allowlist, JSON body parsing (which also captures the raw body
 * for webhook signature checks), the API, and finally the typed error envelope.
 */
export function createApp(ctx: AppContext): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId());
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => (req as unknown as Request).id,
      customProps: (req) => ({ requestId: (req as unknown as Request).id }),
      customLogLevel: (_req, res) => {
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/health/ready' },
    }),
  );

  app.use(
    helmet({
      // Cover art is fetched cross-origin by the Vite client.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header: server-to-server calls, curl, health probes, tests.
        if (!origin || ctx.env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError('FORBIDDEN', `Origin ${origin} is not in CORS_ORIGINS`));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'x-request-id', 'x-cadenza-signature', 'Range'],
      exposedHeaders: ['Content-Range', 'Accept-Ranges', 'x-request-id'],
    }),
  );

  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as Request).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.use('/api', createApiRouter(ctx));
  app.use(notFoundHandler);
  app.use(createErrorHandler(ctx.logger));

  return app;
}

export { createServer };
