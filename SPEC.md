# SPEC — CADENZA (music streaming platform, full-stack MERN/TypeScript)

Target repo dir: `C:/Users/oliad/Desktop/portfolio-3pack/02-cadenza`
Portfolio source: resume bullet "STREAMIFY – Music Streaming Platform / Full-Stack MERN Application".
**The project is renamed CADENZA** (a cadenza is a virtuoso solo passage) — do not use the old name anywhere.

**Read `../RULES.md` first — the finish criteria and forbidden shortcuts live there.**

## Problem
A music streaming platform where listeners browse albums and playlists, play tracks, see synchronized lyrics,
and — the differentiator — join a **listening room** where several users share a playback queue and chat in
real time. Think Spotify's collaborative session, built properly.

## Stack (fixed by the resume — do not substitute)
React + TypeScript + Vite + Tailwind CSS + shadcn/ui, Zustand; Node.js + Express + TypeScript;
MongoDB via Mongoose; Clerk for authentication; Socket.IO for real time.

## Deliverables

### 1. Backend (`server/`) — Express + TS + Mongoose
- Layered: routes → controllers → services → repositories. Zod (or equivalent) request validation on EVERY
  endpoint, centralised error handling with typed error codes, request-id + structured JSON logging, rate
  limiting on auth/write routes, `helmet`, strict CORS allowlist from env, graceful shutdown.
- **Clerk is the real auth path**: `@clerk/express` middleware verifying session tokens on protected routes;
  a `requireAuth` and `requireRole('admin')` guard; the webhook endpoint that syncs Clerk users into Mongo
  (verify the webhook signature — use Clerk's `verifyWebhook`; in tests, a documented test-mode verifier replaced
  via dependency injection, NOT a hardcoded bypass in production code paths).
- Models: `User` (clerkId, roles, profile), `Artist`, `Album`, `Song` (duration, waveform peaks, audio key,
  playCount), `Playlist` (owner, songs, visibility), `Room` (host, members, shared queue, playback state),
  `Message` (room, author, body, ts), plus `PlayEvent` for the analytics. Indexes for the real query paths.
- REST API (documented in a table in the README): songs/albums/artists browse + search (text index), playlists
  CRUD + add/remove tracks, rooms create/join/leave, room queue manipulation, chat history pagination,
  `/api/stats/*` for the admin dashboard (plays over time, top tracks, active rooms), health/liveness.
- Audio serving: streams from a local `media/` directory behind a signed short-lived URL issued by the API
  (HMAC + expiry, single-purpose token) — NOT a public static dump of the whole library. Support HTTP Range
  requests so seeking works; assert on that in a test.
- Tests (vitest + supertest + **mongodb-memory-server**): model/service unit tests, full REST integration tests
  against an in-memory Mongo and a mocked Clerk identity, authz matrix (owner vs other user vs admin), range
  request behaviour, signed-URL expiry, pagination, and rate-limit behaviour. Real counts reported.

### 2. Real time (`server/src/realtime/`) — Socket.IO
- Authenticated socket handshake (Clerk token in the handshake, verified server-side; unauthenticated sockets
  rejected). Rooms: join/leave with membership checks; events for `play`, `pause`, `seek`, `track:change`,
  `queue:add`, `queue:remove`, `chat:message`, `presence`.
- **Server-authoritative playback clock**: clients receive the authoritative state (trackId, positionMs,
  serverTs) and derive position locally. Drift correction: a client reporting a position off by more than a
  threshold is snapped back (test this).
- Reconnect → state resync (full room snapshot), presence updates, and idempotent event handling so a duplicate
  `queue:add` from a flaky client does not duplicate the track (client-supplied event id, deduped server-side).
- Socket tests with two/three real socket.io clients against the running server: propagation, authz rejection,
  queue ordering, drift snap, resync after a forced disconnect, chat broadcast. Report actual measured
  propagation latency (p50/p95 over ≥ 200 events) from a script you ran — no invented numbers.

### 3. Frontend (`client/`) — React + TS + Vite + Tailwind + shadcn/ui
- Clerk provider with protected routes; Zustand stores for player, room, and library; a persistent audio player
  (real `<audio>` element, seek, volume, next/prev, queue) that survives navigation; keyboard shortcuts.
- Pages: Discover (featured albums/artists), Album detail, Playlist detail (drag-to-reorder), Search,
  Library, **Room** (shared queue + live chat + synced playback + presence avatars), Admin dashboard
  (plays chart, top tracks, active rooms — backed by the real `/api/stats` endpoints, or a headless chart lib).
- Responsive (mobile → desktop), accessible (keyboard-navigable player, aria labels, focus states), dark theme
  by default, skeleton loading states, error boundaries, empty states. No lorem ipsum anywhere.
- Component tests with Vitest + @testing-library/react (player reducer/queue logic, store actions, room sync
  reducer), and `npm run build` must succeed with zero TS errors.
- **Media assets**: generate the sample library yourself — 6-10 short royalty-free tracks created locally
  (e.g. synthesized tones/chords via ffmpeg or a Python script writing WAV, then to mp3/ogg) with SVG/gradient
  cover art generated in-repo, and a generated waveform-peaks JSON per track. NO copyrighted music, no random
  downloads from the internet. Document the generator script and commit the generated media (small, < 5 MB total).

### 4. Infra + docs
- `docker-compose.dev.yml` for a local mongo (documented; not required for tests since memory-server is used).
- `.env.example` for both apps (MONGO_URI, CLERK_*, MEDIA_SIGNING_SECRET, CORS_ORIGINS, PORT, VITE_API_URL,
  VITE_SOCKET_URL, VITE_CLERK_PUBLISHABLE_KEY). A `docs/DEPLOY.md` that states exactly what a live deployment
  needs (Vercel for the client, Render for the API, MongoDB Atlas free cluster, Clerk free tier) and which env
  vars must be set — but do NOT deploy anything.
- Root `package.json` with workspaces + scripts (`dev`, `build`, `test`, `lint`, `typecheck`, `e2e`) so a single
  `npm run build && npm test` from the root exercises both apps. README covers architecture (mermaid), the socket
  event contract table, the REST table, setup, and measured results.

## Finish criteria (all must hold)
- Root `npm run lint && npm run typecheck && npm run build && npm test` green from a clean checkout
  (`npm ci`), with real test counts.
- `scripts/e2e_smoke.mjs` (or .ts): boots the API + in-memory Mongo + media dir, registers a test identity
  through the test-mode auth path, then walks the real HTTP + socket flow (create room → join as 2 users →
  queue a track → play/pause/seek → chat → reconnect resync) and prints a PASS/FAIL summary with timings.
  Run it and paste the real output into VERIFY.md.
- The frontend must be runnable by the orchestrator for a live browser check: state the exact
  `npm run preview` / `npm run dev` command and port in VERIFY.md, and make sure the app boots with a
  **mock/test auth mode** enabled by an env flag so the UI is reachable without Clerk keys (clearly labelled
  as demo mode in the UI, with real Clerk wired for real keys).
- Everything in `../RULES.md` §2-§8 satisfied. Nothing pushed to GitHub.
