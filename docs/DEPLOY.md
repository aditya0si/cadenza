# Deploying CADENZA

Nothing here has been deployed by the author. This is the exact set of pieces a
live deployment needs, and the env vars each one must be given.

| Piece | Host | Why |
|---|---|---|
| Web client (`client/`) | Vercel (static build) | `npm run build` emits a static SPA in `client/dist` |
| API + Socket.IO (`server/`) | Render (Node web service) | Needs a long-lived process with WebSocket support |
| Database | MongoDB Atlas (free M0 cluster) | `mongodb-memory-server` is for tests/dev only |
| Auth | Clerk (free tier) | Production identity provider |
| Audio files | Render persistent disk **or** object storage | the generated library lives in `media/` |

## 1. MongoDB Atlas

1. Create a free M0 cluster, database user and network access rule (`0.0.0.0/0` is
   the quick start; tighten it to Render's egress IPs for anything real).
2. Copy the SRV connection string → `MONGO_URI` (server only; never commit it).

**Upgrading an existing database.** The chat idempotency index changed from `{roomId, eventId}` to
`{roomId, authorId, eventId}` (per-member event ids). `ensureIndexes()` builds the new one at boot but does
not drop the old one, so a database created before that change still carries the old unique constraint and
would keep rejecting a second listener's event id. Drop it once:

```js
db.messages.dropIndex('roomId_1_eventId_1')   // mongosh
```

## 2. API on Render

- Root directory: repository root. Build command: `npm ci && npm run build --workspace server`.
- Start command: `npm run start --workspace server` (runs `server/dist/index.js`).
- Health check path: `/api/health` (liveness) — Render should use `/api/health/ready`
  if you want the deploy to wait for Mongo.
- Persistent disk mounted at `/opt/cadenza/media`, then set `MEDIA_DIR=/opt/cadenza/media`
  and copy the committed `media/` directory there once (or regenerate it inside the
  container with `npm run media:generate` if ffmpeg is available).
- Environment variables:

  | Variable | Value |
  |---|---|
  | `NODE_ENV` | `production` |
  | `PORT` | Render injects this; the server honours `PORT` |
  | `MONGO_URI` | Atlas SRV string |
  | `AUTH_MODE` | `clerk` |
  | `CLERK_SECRET_KEY` | Clerk dashboard → API keys |
  | `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → signing secret |
  | `MEDIA_SIGNING_SECRET` | 32+ random bytes (`openssl rand -hex 32`) |
  | `DEMO_AUTH_SECRET` | optional in production; if set, it must not be a placeholder |
  | `MEDIA_URL_TTL_SECONDS` | `300` |
  | `CORS_ORIGINS` | the Vercel URL, e.g. `https://cadenza.vercel.app` |
  | `ADMIN_EMAILS` | comma-separated list of admin accounts |
  | `LOG_LEVEL` | `info` |
  | `SOCKET_MAX_PAYLOAD_BYTES` | optional; defaults to `65536` |
  | `SOCKET_*_BURST` / `SOCKET_*_REFILL_PER_SEC` | optional; per-socket token buckets |

- The API **refuses to start** if `NODE_ENV=production` is combined with `AUTH_MODE=demo`, or if
  `MEDIA_SIGNING_SECRET` / `DEMO_AUTH_SECRET` still hold the placeholder committed in `.env.example`.
  A misconfigured Render service fails its health check instead of serving demo-signed sessions.

- WebSockets: Socket.IO uses the same port and the default `/socket.io` path; no
  extra Render configuration is required (sticky sessions are not needed because
  room state is re-read from Mongo on resync).
- Webhook: point a Clerk webhook at `https://<api-host>/api/webhooks/clerk` for
  `user.created`, `user.updated`, `user.deleted`. The signature is verified with
  Clerk's `verifyWebhook` before anything is written.

## 3. Client on Vercel

- Root directory: repository root; build command `npm run build --workspace client`;
  output directory `client/dist`.
- Environment variables (build-time, Vite inlines them):

  | Variable | Value |
  |---|---|
  | `VITE_API_URL` | `https://<api-host>/api` |
  | `VITE_SOCKET_URL` | `https://<api-host>` |
  | `VITE_AUTH_MODE` | `clerk` |
  | `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key |

- Add the Vercel origin to the API's `CORS_ORIGINS` **before** opening the site, or
  every request is rejected by the allowlist (by design).

## 4. Post-deploy checks

```bash
curl -s https://<api-host>/api/health          # {"status":"ok","authMode":"clerk",...}
curl -s https://<api-host>/api/health/ready    # {"status":"ready","mongo":"connected",...}
```

Then sign in on the client and: play a track (exercises the signed-URL path),
create a room, and open it in a second browser profile (exercises the socket
handshake with a real Clerk token).

## What is deliberately not included

- No container image and no Kubernetes manifests: two managed services are enough
  for this project's traffic.
- No CI deploy step: `.github/workflows/ci.yml` verifies the repo, it does not ship
  it. Add a deploy job only after the secrets above exist in the hosting accounts.
