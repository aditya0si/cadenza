# CADENZA — progress log

Append-only. One dated line per milestone: what changed, what passed, what is blocked.

## 2026-09-21
- Recon: read `../RULES.md` + `SPEC.md`. Environment verified: node v22.23.2, npm 12.0.2, ffmpeg 9.0 present,
  git 2.53.0, no Docker daemon, no Clerk keys, no local mongod.
- Risk probe (mongodb-memory-server binary download): PASS. Throwaway script in `%LOCALAPPDATA%\Temp\mms-probe`
  downloaded MongoDB 8.2.6 from fastdl.mongodb.org and performed a real insert + read-back via the MongoDB
  driver (`PROBE_OK_MS=326545`, cold download included). No mirror/system-binary fallback needed.
- npm 12 install-script blocking noted: `install-scripts approve` writes `allowScripts` into the root
  `package.json` (committed), so `esbuild` + `mongodb-memory-server` postinstalls are provisioned in CI too.
- Milestone 1 — backend: layered Express/TS API (routes → controllers → services → repositories), 8 Mongoose
  models with real indexes, zod validation on every endpoint, request-id + pino JSON logs, three rate-limit
  buckets, helmet + strict CORS allowlist, Clerk identity verifier behind an injectable seam, Clerk webhook
  sync via `verifyWebhook`, HMAC signed short-lived stream URLs with Range support, Socket.IO with a
  server-authoritative playback clock, drift snapping, idempotent events and presence. `tsc --noEmit` and
  eslint clean.
- Milestone 2 — media: `tools/generate-media.mjs` synthesised 8 royalty-free tracks (2.03 MB of MP3 at
  96 kbps mono, 44.1 kHz) plus gradient cover SVGs and 120-bucket waveform peaks; `ffprobe` confirms real
  audio (22.0 s, mean −18.4 dB, max −1.6 dB) and the peaks are non-zero.
- Milestone 3 — server tests: 15 files / 169 tests green (unit + REST integration + realtime sockets with two
  and three real socket.io clients). Three product bugs found and fixed while getting them green: the room
  host handover never updated `hostId`, `$text` search could run before its index was built, and the webhook
  verifier only accepted `svix-*` header spellings.
- Milestone 4 — client: React + Vite + Tailwind + shadcn-style primitives, Clerk/demo auth seam, Zustand
  player/room/library stores with pure reducers, persistent `<audio>` player with keyboard shortcuts,
  Discover/Album/Artist/Playlist/Search/Library/Rooms/Room/Admin pages, 8 test files / 70 tests green.
  One product bug found by the client tests: `enqueueTracks` did not de-duplicate within a single batch.
- Milestone 5 — first `npm run build && npm run e2e`: build PASS (server tsc + vite, 479.87 kB JS /
  146.78 kB gzip); e2e FAILED on a real production-only bug — the compiled ESM server imported `models` as a
  named export from the CommonJS mongoose package, which Node's ESM loader cannot resolve (`tsx`/vitest hid
  it). Fixed by reading `mongoose.models` off the default export in all 8 model files.
- Milestone 6 — full gate chain green in one session: lint 0/0, typecheck 0 errors, 169 server + 80 client
  tests, build, e2e 20/20 steps. Eight product bugs were found by the gates themselves and fixed in product
  code (see VERIFY.md §5): the ESM mongoose import, room `hostId` handover, `$text` index timing, the
  webhook header spellings, the 416 error envelope, in-batch queue de-duplication, the volume slider's
  accessible name, and the room store keeping a stale socket reference after leaving a room.
- Milestone 7 — docs: README (architecture, API + socket tables, measured results, limitations),
  VERIFY.md (every gate with pasted output, the disclosed test-file changes, an honest gap list),
  docs/DEPLOY.md, `.github/workflows/ci.yml` running the same five gates on ubuntu-latest plus a manual
  latency job, and `npm run demo` so the reviewer can boot the whole stack without mongod or Docker.
  Latency probe: chat p50 17 ms / p95 29 ms, playback:seek p50 11 ms / p95 18 ms over 220 events each.
- Milestone 8 — coverage top-up + final gate run: added `SearchPage` and `RoomPage` component tests
  (client suite now 11 files / 96 tests) and the room-store socket-wiring tests. The last full chain
  (lint → typecheck → test → build → e2e) is green: 0 lint problems, 0 type errors, 169 server + 96 client
  tests, build OK, e2e 20/20 steps in 2.20 s wall clock. Nothing is left running; all ports are free.
- Milestone 9 — adversarial-review round (findings closed in `e5164cc` + `f72746d`): the secret scan is
  green on a pristine clone without weakening it (every check runs, the exit code aggregates, secret-ish
  names are matched case-insensitively in every tracked file, CI runs the same script instead of a copy);
  production refuses to boot with `AUTH_MODE=demo` or a committed placeholder secret; room chat reads are
  member-only on both transports; REST `leave` evicts the caller's sockets; idempotency is per member, not
  per room; oversized bodies answer 413; demo tokens need an `exp` and are TTL-capped; `playback:report` is
  bucketed and sockets have a payload bound with a typed refusal. Evidence and the disclosed test changes
  are in VERIFY.md §1.7, §2, §4, §5 (items 9–16) and §6.1.
