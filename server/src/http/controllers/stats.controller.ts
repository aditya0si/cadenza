import type { Request, Response } from 'express';
import type { AppContext } from '../../context.js';
import { mongoReadyState } from '../../db/connect.js';
import { query } from '../middleware/validate.js';
import type { StatsActiveRoomsQuery, StatsPlaysQuery, StatsTopTracksQuery } from '../schemas.js';

export const createStatsController = (ctx: AppContext) => ({
  async overview(_req: Request, res: Response): Promise<void> {
    res.json(await ctx.services.stats.overview());
  },

  async plays(req: Request, res: Response): Promise<void> {
    const q = query<StatsPlaysQuery>(req);
    res.json(await ctx.services.stats.playsOverTime(q.days));
  },

  async topTracks(req: Request, res: Response): Promise<void> {
    const q = query<StatsTopTracksQuery>(req);
    res.json({ tracks: await ctx.services.stats.topTracks(q.limit, q.days) });
  },

  async activeRooms(req: Request, res: Response): Promise<void> {
    const q = query<StatsActiveRoomsQuery>(req);
    res.json({ rooms: await ctx.services.stats.activeRooms(q.limit) });
  },
});

export const createHealthController = (ctx: AppContext) => ({
  /** Liveness: the process is up and answering. */
  async live(_req: Request, res: Response): Promise<void> {
    res.json({
      status: 'ok',
      service: 'cadenza-api',
      version: ctx.env.serviceVersion,
      uptimeSeconds: Math.round(process.uptime()),
      authMode: ctx.env.AUTH_MODE,
      realtime: ctx.realtime !== null,
      serverTime: new Date().toISOString(),
    });
  },

  /** Readiness: dependencies (Mongo) are usable. */
  async ready(_req: Request, res: Response): Promise<void> {
    const connected = mongoReadyState() === 1;
    res.status(connected ? 200 : 503).json({
      status: connected ? 'ready' : 'degraded',
      mongo: connected ? 'connected' : 'disconnected',
      realtime: ctx.realtime !== null,
    });
  },
});
