import type { Logger } from 'pino';
import type { Env } from './config/env.js';
import type { IdentityVerifier, WebhookVerifier } from './auth/types.js';
import { createIdentityVerifier } from './auth/identity.js';
import { createWebhookVerifier } from './auth/webhook.js';
import { CatalogService } from './services/catalog.service.js';
import { MediaService } from './services/media.service.js';
import { PlaylistService } from './services/playlist.service.js';
import { RoomService, type RealtimeBroadcaster } from './services/room.service.js';
import { StatsService } from './services/stats.service.js';
import { UserService } from './services/user.service.js';

export interface Services {
  users: UserService;
  catalog: CatalogService;
  playlists: PlaylistService;
  rooms: RoomService;
  stats: StatsService;
  media: MediaService;
}

/**
 * Everything a request or a socket event needs, built once at boot and injected
 * (tests build their own context with a test-mode identity/webhook verifier —
 * that is the only difference between test and production wiring).
 */
export interface AppContext {
  env: Env;
  logger: Logger;
  identity: IdentityVerifier;
  webhook: WebhookVerifier;
  services: Services;
  /** Set right after the HTTP server + Socket.IO are wired; REST writes push through it. */
  realtime: RealtimeBroadcaster | null;
  setRealtime(realtime: RealtimeBroadcaster): void;
}

export interface CreateContextOptions {
  env: Env;
  logger: Logger;
  identity?: IdentityVerifier;
  webhook?: WebhookVerifier;
}

export function createAppContext(options: CreateContextOptions): AppContext {
  const { env, logger } = options;
  const identity = options.identity ?? createIdentityVerifier(env);
  const webhook = options.webhook ?? createWebhookVerifier(env);

  const users = new UserService(env.adminEmails);
  const catalog = new CatalogService();
  const playlists = new PlaylistService();
  const media = new MediaService(env);
  const stats = new StatsService();

  const context: AppContext = {
    env,
    logger,
    identity,
    webhook,
    services: {
      users,
      catalog,
      playlists,
      rooms: new RoomService(() => context.realtime),
      stats,
      media,
    },
    realtime: null,
    setRealtime(realtime: RealtimeBroadcaster) {
      context.realtime = realtime;
    },
  };

  return context;
}
