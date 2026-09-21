# VERIFY.md — CADENZA gate evidence

Every command below was run by the author on the build machine (Windows 11, git-bash,
Node v22.23.2, npm 12.0.2, ffmpeg 9.0) inside `C:/Users/oliad/Desktop/portfolio-3pack/02-cadenza`.
Outputs are pasted verbatim. Nothing here is projected or estimated.

## 0. Environment facts

| Fact | Value |
|---|---|
| Node / npm | v22.23.2 / 12.0.2 |
| MongoDB | no local `mongod`, no Docker daemon → tests and the e2e script boot `mongodb-memory-server` (real mongod binary, version pinned to **8.2.6**) |
| Clerk | no Clerk keys available → the app is exercised through `AUTH_MODE=demo`; the real Clerk path is covered by tests that call Clerk's own `verifyToken`/`verifyWebhook` code |
| ffmpeg | 9.0 (gyan.dev full build) — used only by `tools/generate-media.mjs` |

**mongodb-memory-server provisioning (verified before any product code was written).**
A throwaway script in `%LOCALAPPDATA%\Temp\mms-probe` downloaded MongoDB 8.2.6 from
`fastdl.mongodb.org` (781 MB, 326 s cold) and performed a real insert + read-back through the
MongoDB driver: `PROBE_URI=mongodb://127.0.0.1:59119/`, `PROBE_AGG=[{"n":1}]`, `PROBE_OK_MS=326545`.
The binary is cached at `C:\Users\oliad\.cache\mongodb-binaries\mongod-x64-win32-8.2.6.exe`, so
subsequent runs boot in under a second. No mirror or system-binary fallback was needed.
**No `MONGOMS_SYSTEM_BINARY` shortcut was used**; the committed test setup is portable (plain
`mongodb-memory-server` with a pinned version, no absolute paths).

**npm 12 blocks install scripts by default.** Both packages that need postinstalls were approved
(`npm install-scripts approve esbuild mongodb-memory-server @clerk/shared --no-allow-scripts-pin`),
which writes `allowScripts` into the **root** `package.json` (committed, so CI honours it), then
`npm rebuild esbuild mongodb-memory-server @clerk/shared --foreground-scripts` ran the scripts for
real — the log shows `Mongodb-Memory-Server* found binary: "C:\Users\oliad\.cache\mongodb-binaries\mongod-x64-win32-8.2.6.exe"`
and both esbuild postinstalls. `npm install-scripts ls` → "No packages with unreviewed install scripts."

## 1. Gates (in the order RULES.md §3 requires)

All five were run back-to-back in one shell session; the exit codes are the observed ones.

```bash
npm run lint        # LINT_EXIT=0
npm run typecheck   # TYPECHECK_EXIT=0
npm test            # TEST_EXIT=0
npm run build       # BUILD_EXIT=0
npm run e2e         # E2E_EXIT=0
```

### 1.1 lint — `npm run lint` (eslint, `--max-warnings 0`, both workspaces) → 0 errors, 0 warnings

```
npm run lint --workspace server && npm run lint --workspace client
eslint . --max-warnings 0      (both workspaces, exit 0)
```

### 1.2 typecheck — `npm run typecheck` → 0 errors

```
tsc -p tsconfig.json --noEmit          # server build config
tsc -p tsconfig.test.json --noEmit     # server sources + test tree
tsc -p tsconfig.json --noEmit          # client
```

### 1.3 tests — `npm test`

**Server: 15 files / 169 tests passed** (22.00 s)

```
 ✓ tests/realtime/socket.test.ts (18 tests)
 ✓ tests/integration/rooms-stats.test.ts (18 tests)
 ✓ tests/integration/media.test.ts (17 tests)
 ✓ tests/integration/catalog.test.ts (24 tests)
 ✓ tests/integration/playlists.test.ts (17 tests)
 ✓ tests/integration/webhook.test.ts (12 tests)
 ✓ tests/integration/ratelimit.test.ts (3 tests)
 ✓ tests/unit/models.test.ts (8 tests)
 ✓ tests/unit/user-service.test.ts (8 tests)
 ✓ tests/unit/playback-clock.test.ts (9 tests)
 ✓ tests/unit/range.test.ts (9 tests)
 ✓ tests/unit/demo-token.test.ts (8 tests)
 ✓ tests/unit/media-signing.test.ts (7 tests)
 ✓ tests/unit/dedupe.test.ts (7 tests)
 ✓ tests/unit/presence.test.ts (4 tests)
      Tests  169 passed (169)
```

**Client: 11 files / 96 tests passed**

```
 ✓ src/player/queue.test.ts (15 tests)
 ✓ src/room/roomSync.test.ts (12 tests)
 ✓ src/stores/playerStore.test.ts (11 tests)
 ✓ src/stores/roomStore.test.ts (10 tests)
 ✓ src/pages/RoomPage.test.tsx (10 tests)
 ✓ src/stores/libraryStore.test.ts (7 tests)
 ✓ src/components/TrackList.test.tsx (7 tests)
 ✓ src/components/PlayerBar.test.tsx (7 tests)
 ✓ src/components/Waveform.test.tsx (6 tests)
 ✓ src/pages/SearchPage.test.tsx (6 tests)
 ✓ src/pages/SignInPage.test.tsx (5 tests)
      Tests  96 passed (96)
```

The realtime suite uses real `socket.io-client` connections against the running server (two and
three clients), not mocks; the REST suites use `supertest` against the real Express app; every
database test runs against a real mongod.

### 1.4 build — `npm run build`

```
tsc -p tsconfig.json                       # server → server/dist (exit 0)
tsc -p tsconfig.json --noEmit && vite build # client
vite v6.4.3 building for production...
✓ 1787 modules transformed.
dist/index.html                   0.71 kB │ gzip:   0.41 kB
dist/assets/index-yoOFsU89.css   21.60 kB │ gzip:   5.07 kB
dist/assets/index-CsVncyx_.js   479.87 kB │ gzip: 146.78 kB
✓ built in 3.61s
```

### 1.5 end-to-end smoke — `npm run e2e` → **20/20 steps PASS**

`scripts/e2e_smoke.mjs` boots the **built** API (`server/dist`) plus an in-memory mongod, seeds the
committed media library, signs in through the demo-session route and walks the real HTTP + Socket.IO
flow. Verbatim output:

```
CADENZA e2e smoke test
======================

[e2e] mongod 8.2.6 + API on http://127.0.0.1:63003 in 848 ms

  PASS  seed the generated media library                 214 ms  4 artists / 4 albums / 8 songs / 333 plays
  PASS  GET /api/health reports the running service       32 ms  authMode=demo realtime=true
  PASS  POST /api/auth/demo-session issues two listeners    54 ms  host=7b7e7e guest=7b7e81
  PASS  GET /api/songs browses the seeded catalogue       20 ms  8 songs, first="Aurora Drift"
  PASS  GET /api/search ranks full-text hits              14 ms  songs=1 artists=0
  PASS  GET /api/songs/:id/stream-url + Range read of real audio    49 ms  206 slice=100B, full=282 KB, ttl=300s
  PASS  POST /api/rooms creates a room and the guest joins    55 ms  room=7b7e92 members=2
  PASS  socket handshake rejects an unauthenticated client    26 ms  rejected with UNAUTHENTICATED
  PASS  both listeners join the room over sockets         40 ms  members=2 queue=0
  PASS  guest queues a track and the host receives it     19 ms  queue=1 track="Glass Harbor"
  PASS  replayed queue:add is idempotent                  25 ms  duplicate=true queue=2
  PASS  host changes track, play/pause/seek propagate     27 ms  track ok, paused at 4004 ms
  PASS  non-host cannot change the track                   3 ms  rejected with FORBIDDEN
  PASS  drift report snaps a lagging client back           7 ms  drift=87996 ms → snapped to 2004 ms
  PASS  chat broadcasts to the room                        8 ms  author=E2E Guest
  PASS  forced disconnect then resync restores full state   172 ms  queue=2 playing=true pos=2000 ms
  PASS  GET /api/rooms/:id/messages returns the chat history    28 ms  1 messages
  PASS  playlist create → add track → reorder             95 ms  tracks=2 durationMs=46000
  PASS  admin stats reflect the real activity            105 ms  songs=8 users=4 playEvents=334 buckets=8
  PASS  Clerk webhook sync (test-mode verifier) creates the mirror    29 ms  handled=user.created, unsigned rejected with 403

-----------------------------
steps: 20   PASS: 20   FAIL: 0
step time total: 1022 ms   wall clock: 2202 ms
RESULT: PASS
```

### 1.6 secret grep — `git grep -nIE '(api[_-]?key|secret|password|token|mongodb\+srv)\s*[:=]' -- . ':!*.example' ':!package-lock.json'`

20 files match; every match is an intentional non-secret, in one of four shapes:

- **function parameters / option keys** — `token: string`, `secret: string`, `secretKey:`, `signingSecret:`
  (e.g. `server/src/auth/demoToken.ts`, `server/src/auth/webhook.ts`);
- **environment variable names** read from `process.env` — `CLERK_SECRET_KEY`, `MEDIA_SIGNING_SECRET`,
  `DEMO_AUTH_SECRET` (`server/src/config/env.ts`);
- **variable passing in the scripts/tests** — `{ token: state.hostToken }` in `scripts/e2e_smoke.mjs`
  and `const token = await getToken()` in `client/src/lib/api.ts`;
- **this repo's own CI allowlist regex** in `.github/workflows/ci.yml`.

Two follow-up scans came back empty:

```bash
git grep -nIE 'sk_(test|live)_|pk_(test|live)_|whsec_|mongodb\+srv://|AKIA[0-9A-Z]{16}|-----BEGIN' -- .
# only hits: two test fixtures that *build* a `whsec_…` value at runtime from a literal
#            ("cadenza-webhook-signing-secret-32b!"), not a real Clerk secret
git grep -nIE "(secret|password|token|key)[\"']?\s*[:=]\s*[\"'][A-Za-z0-9+/=_-]{32,}[\"']" -- . ':!package-lock.json'
# NONE FOUND
```

No `.env` file exists on disk (`ls .env client/.env server/.env` → all missing) and only the two
`.env.example` files are tracked (`git ls-files | grep '\.env'` → `.env.example`, `client/.env.example`).

## 2. Measured realtime propagation latency — `npm run latency`

`scripts/latency_probe.mjs` boots the built API + in-memory mongod, signs in two listeners, puts them
in one room, warms up 20 events, then measures **220 events per channel** as
`receivedAt - sentAt` on the receiving client (single-flight: each event is acked before the next is
sent, so this is propagation latency, not throughput). Verbatim table (milliseconds):

```
channel                                  n     min    p50    p90    p95    p99    max   mean
---------------------------------------------------------------------------------------------
chat:message → chat:message             220      4     17     26     29     35     41  17.78
playback:seek → playback:state          220      6     11     17     18     27     28  12.09
```

`chat:message → chat:message` is the full path (persist the message in Mongo, then fan out);
`playback:seek → playback:state` is the authoritative-clock broadcast. Both channels are localhost
loopback on one machine — these numbers say nothing about WAN latency.

## 3. Generated media library — real audio, checked

```bash
node tools/generate-media.mjs
# [generate-media] 8 tracks, 2.03 MB of MP3, manifest written to media/MANIFEST.json
ffprobe -v error -show_entries format=duration,bit_rate -show_entries stream=codec_name,channels,sample_rate media/tracks/midnight-circuit.mp3
#   codec_name=mp3  sample_rate=44100  channels=1  duration=22.000000  bit_rate=96336
ffmpeg -i media/tracks/midnight-circuit.mp3 -af volumedetect -f null -
#   mean_volume: -18.4 dB   max_volume: -1.6 dB
```

25 files / 2.19 MB in `media/` (8 MP3 + 8 SVG covers + 8 peak files + `MANIFEST.json`), all
committed, all synthesised in-repo — no downloaded or copyrighted audio.

### 1.7 secret scan — `bash scripts/secret_scan.sh` → **clean, and provably not vacuous**

The same script CI runs (kept in the repo so it can be reproduced locally). Three checks: no tracked
`.env` file (only `.env.example`), no provider-shaped credential (`sk_live_…`, `pk_test_…`, `AKIA…`,
`mongodb+srv://…@`, PEM private keys), and no 20+ character string literal assigned to a secret-ish name.

```
1. no tracked .env files (only .env.example):
   ok
2. no provider-shaped credentials:
   ok
3. no hardcoded literal values behind secret-ish names:
   ok
secret scan clean
SCAN_EXIT=0
```

**Detection proof** — a canary file containing a Stripe-shaped key was added to the index, scanned, then
removed (so the gate is not vacuously green):

```
2. no provider-shaped credentials:
canary-secret.ts:1:const stripe = { apiKey: *** };
::error::a provider-shaped credential is committed
SCAN_EXIT_WITH_CANARY=1
SCAN_EXIT_AFTER_REMOVE=0
```

### 1.8 clean-checkout reproduction — `git clone` → `npm ci` → every gate

The strongest check the reviewer can repeat: clone the committed tree somewhere else, install from the
lockfile, and run the same five gates. Run verbatim in `$LOCALAPPDATA/Temp/cadenza-clean`:

```bash
git clone C:/Users/oliad/Desktop/portfolio-3pack/02-cadenza cadenza-clean
cd cadenza-clean
npm ci --no-audit --no-fund
npm install-scripts ls      # -> "No packages with unreviewed install scripts."
npm run lint && npm run typecheck && npm test && npm run build && npm run e2e
```

```
CI_EXIT=0
LINT_EXIT=0
TYPECHECK_EXIT=0
TEST_EXIT=0        (15 server files / 169 tests + 11 client files / 96 tests)
BUILD_EXIT=0
E2E_EXIT=0         (steps: 20   PASS: 20   FAIL: 0)
```

`npm ci` honoured the committed `allowScripts` entry, so the `esbuild` and `mongodb-memory-server`
postinstalls ran on a fresh tree without any manual approval step.

## 4. Frontend boot for the live browser check

**Exact command:** `npm run build && npm run demo`  (root)
**URLs:** client `http://localhost:4173` · API `http://localhost:4000/api`
**Demo-auth flag:** `AUTH_MODE=demo` (API) + `VITE_AUTH_MODE=demo` (client). `npm run demo` sets both
itself; without it, set them in `.env` / `client/.env`.

`npm run demo` (`scripts/demo_boot.mjs`) boots `mongodb-memory-server` on a temporary port, seeds the
generated library, starts the built API on :4000 and `vite preview` on :4173. It exists because this
machine has no mongod and no Docker daemon. If you *do* have a mongod, `npm run preview` starts the
API against `MONGO_URI` plus the client preview instead.

Sign in on the sign-in page with one of the two demo personas — `demo@cadenza.dev` (listener) or
`admin@cadenza.dev` (adds the `admin` role, unlocking `/admin`). The UI shows a permanent amber
**DEMO MODE** banner whenever demo auth is active, and `POST /api/auth/demo-session` returns 404 the
moment `AUTH_MODE=clerk`, so the demo path cannot become a production bypass.

Observed boot evidence (verbatim, then shut down again):

```
[demo] mongod 8.2.6 on mongodb://127.0.0.1:64231/
[demo] seeded 4 artists, 4 albums, 8 songs, 333 play events, 2 playlists, 1 room
[demo] API      http://localhost:4000/api   (auth mode: demo)
[demo] client   http://localhost:4173

$ curl -s http://localhost:4000/api/health
{"status":"ok","service":"cadenza-api","version":"1.0.0","uptimeSeconds":36,"authMode":"demo","realtime":true,"serverTime":"2026-09-21T13:01:32.626Z"}

$ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:4173/library     # SPA deep link
200 text/html

$ curl -s -X POST http://localhost:4000/api/auth/demo-session -H 'content-type: application/json' \
    -d '{"email":"demo@cadenza.dev","displayName":"Demo Listener"}'
{"mode":"demo","warning":"DEMO AUTH MODE — this session was signed locally, not by Clerk. …","token":"eyJzdW…","expiresAt":"…","user":{…}}

$ curl -s "http://localhost:4000/api/playlists?scope=mine" -H "authorization: Bearer $TOKEN"
total 2 Warm-Up Laps (3 tracks), Late Shift Focus (4 tracks)
```

Both listeners were killed afterwards (`taskkill /F /PID …`); `netstat` confirms nothing is left
listening on :4000 or :4173.

## 5. Product bugs found by the gates (all fixed in product code, not by weakening tests)

1. **`models` was not resolvable from the built ESM server.** `import { models } from 'mongoose'`
   worked under `tsx`/vitest but `node server/dist/index.js` died with
   `SyntaxError: Named export 'models' not found` — i.e. the production start command was broken and
   only the e2e gate (which runs the compiled output) could see it. Fixed by reading
   `mongoose.models` off the default export in all 8 model files.
2. **Room host handover never moved `hostId`.** `POST /api/rooms/:id/leave` promoted the next member's
   role but left `hostId` pointing at the departed host, so nobody could change the track. Fixed with
   `roomRepository.transferHost()` (atomic `$set` of `hostId` + `arrayFilters` role update).
3. **`$text` search could run before its index existed**, returning 500 "text index required"
   intermittently. Fixed by building every index (`ensureIndexes()`) during boot before the server
   accepts traffic.
4. **Webhook verifier accepted only `svix-*` header spellings.** Clerk's SDK reads the Svix-era
   aliases while the Standard Webhooks spec names them `webhook-id`/`webhook-timestamp`/
   `webhook-signature`; the verifier now maps the standard names onto the aliases and still verifies
   with Clerk's own `verifyWebhook`. (The failing test was kept, not relaxed.)
5. **Error envelopes lost their JSON content type** when a failure happened after media headers were
   set (the 416 path), so clients saw an unparseable body. Fixed in the error handler and by rejecting
   an unsatisfiable range before any media headers are written.
6. **`enqueueTracks` did not de-duplicate within one batch** — adding `[b, c, c]` to a queue holding
   `[a, b]` produced `[a, b, c, c]`. Found by a client unit test; fixed in `client/src/player/queue.ts`.
7. **The volume slider's accessible name sat on the wrong element** (the wrapper, while Radix puts
   `role="slider"` on the thumb), so screen readers announced an unnamed slider. Fixed in
   `client/src/components/ui/slider.tsx`.
8. **`roomStore.disconnect()` kept the socket reference**, so after leaving a room the next queue
   mutation was emitted over a socket that was no longer in it instead of falling back to the REST
   endpoint. Fixed by clearing the reference on disconnect.

## 6. Test files modified while chasing reds (full disclosure)

An auditor diffing the tests should know exactly what changed and why. **No assertion was deleted,
skipped, or relaxed to make a gate pass**, and no test was deselected; in two cases the *product* was
changed to satisfy an existing assertion (items 1–5 above).

| File | Change | Why |
|---|---|---|
| `server/tests/unit/demo-token.test.ts` | fixture now passes an explicit `subject`; added a test for the generated-subject case | wrong expectation: `issueDemoToken` mints a random `demo:<uuid>` subject when none is given, so the old assertion described a payload the fixture never built |
| `server/tests/unit/playback-clock.test.ts` | corrected one expected value; split it into playing/paused cases | wrong expectation: a stored `-500 ms` is clamped to 0 *before* elapsed time is added, so the result is 2 500 ms, not 2 000 ms |
| `server/tests/integration/ratelimit.test.ts` | removed a `signIn` call from the second test (it asserted 401 instead); second harness reuses the mongoose connection | self-contradictory test: it signed in after the previous test had deliberately exhausted the auth bucket. The 429 assertions remain in the first test |
| `server/tests/integration/catalog.test.ts`, `webhook.test.ts` | added `await ensureIndexes()` in `beforeAll` | mirrors the product fix (the server builds indexes at boot); removes a real race, adds no leniency |
| `server/tests/helpers/harness.ts` | added a `manageConnection` option and a connected-state guard in `close()` | infrastructure: a second harness in one file was dropping a database it did not own |
| `server/tests/realtime/socket.test.ts` | removed one unused type import; temporary debug `console.log` added and removed | lint cleanliness; no assertion touched |
| `client/src/components/Waveform.test.tsx` | the coordinate-click test now uses `fireEvent.click` instead of `userEvent.click(el, {clientX})`; a duplicate of it was folded away | `userEvent` v14's `click()` takes no options, so the old call could not compile; the assertion is unchanged |
| `client/src/components/PlayerBar.test.tsx` | tests pin `audio.paused` explicitly and spy on `play`/`pause` | jsdom always reports `paused === true` (no playback implementation); the transport assertions now describe a real state instead of a jsdom artefact |
| `client/src/room/roomSync.test.ts` | fixtures use numeric `serverTs` | representation change in the client state (anchors are normalised to epoch ms) |
| `client/src/test/setup.ts` | jsdom media stubs are plain functions rather than `vi.fn()` | `restoreMocks: true` strips a mock's implementation between tests, which made `audio.play()` return `undefined` |
| `client/eslint.config.mjs` | `react-refresh/only-export-components` disabled for 3 files | those files intentionally export a hook/helper beside components; the reason is written in the config |
| `client/src/stores/roomStore.test.ts` | **new file** (10 tests) | coverage gap: the socket wiring (join ack, broadcast handling, command routing, rejection surfacing, REST fallback, reset on disconnect) had no test. Writing it exposed product bug #8 below |
| `client/src/pages/SearchPage.test.tsx` | **new file** (6 tests) | coverage gap: the debounce, grouping, empty and error states of the search page were untested. One assertion was corrected during the first run (the fixture song belongs to a different artist, so the searched artist name legitimately appears twice, not three times) |
| `client/src/pages/RoomPage.test.tsx` | **new file** (10 tests) | coverage gap: the room page's mount/unmount lifecycle, presence rendering, chat submission, host-only track control and queue-search wiring had no test |

## 7. Not verified / known gaps

- **No live deployment.** Nothing was pushed to GitHub and nothing was deployed; `docs/DEPLOY.md`
  describes the target setup but those steps were never executed.
- **Real Clerk credentials were never exercised end to end.** The Clerk *code paths* are tested
  (`verifyToken` rejection handling, `verifyWebhook` with a real Standard Webhooks signature produced
  by the `standardwebhooks` library, plus both header spellings), but no request ever hit Clerk's
  servers, because no Clerk account exists on this machine. The same applies to the Clerk Backend API
  top-up (`clerkClient.users.getUser`) used when a session token carries no email claim.
- **No Atlas / production MongoDB.** Everything ran against `mongodb-memory-server` 8.2.6 (real mongod
  binary, ephemeral). Index behaviour, text-search ranking and aggregation were all exercised there.
- **Latency numbers are loopback on one machine**, measured with a single in-flight event per channel;
  they are not throughput numbers and say nothing about WAN or multi-instance behaviour.
- **Single-process realtime.** Presence and the playback dedupe ring are in-memory; two API instances
  behind a load balancer would need a Socket.IO Redis adapter. Room *state* is durable in Mongo and is
  re-read on every resync, so correctness (not presence accuracy) survives a restart.
- **Audio is served from a local directory**, not object storage; the deployment doc flags this.
- **Browser-level UI behaviour is covered by jsdom component tests only** — no Playwright/real-browser
  run, so CSS layout, the actual `<audio>` pipeline and drag-and-drop were verified by inspection and
  by the API-level tests, not by a browser.
- **`npm run demo` leaves nothing behind, but killing it from a shell that does not forward SIGINT can
  orphan the two child processes** (observed once during verification and cleaned up with
  `taskkill /F`); Ctrl+C in an interactive terminal shuts everything down.
- **`client/dist` and `server/dist` are gitignored**, so a clean checkout must run `npm run build`
  before `npm run demo` (the script says so explicitly).
