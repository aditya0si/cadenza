import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ */
const serverRoot = path.resolve(here, '..', '..');
/** repo root (one level above server/) */
const repoRoot = path.resolve(serverRoot, '..');

// `server/.env` wins, then the repo-root `.env`. Both are optional: every value
// below except the Clerk keys has a working development default.
dotenv.config({ path: path.join(serverRoot, '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

const csv = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/cadenza'),

  AUTH_MODE: z.enum(['clerk', 'demo']).default('clerk'),
  CLERK_PUBLISHABLE_KEY: z.string().default(''),
  CLERK_SECRET_KEY: z.string().default(''),
  CLERK_WEBHOOK_SECRET: z.string().default(''),
  /** Secret used to sign demo sessions; falls back to MEDIA_SIGNING_SECRET. */
  DEMO_AUTH_SECRET: z.string().default(''),
  DEMO_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).default(12 * 60 * 60),
  ADMIN_EMAILS: z.string().default('admin@cadenza.dev'),

  MEDIA_DIR: z.string().default('./media'),
  MEDIA_SIGNING_SECRET: z.string().min(16).default('dev-only-media-signing-secret-change-me'),
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(10).max(86_400).default(300),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),

  PLAYBACK_DRIFT_THRESHOLD_MS: z.coerce.number().int().min(50).default(750),

  RATE_LIMIT_DISABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(20),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_READ_MAX: z.coerce.number().int().min(1).default(600),

  /** Per-socket token buckets: burst size and refill rate for chat and queue events. */
  SOCKET_CHAT_BURST: z.coerce.number().int().min(1).default(10),
  SOCKET_CHAT_REFILL_PER_SEC: z.coerce.number().min(0.1).default(2),
  SOCKET_QUEUE_BURST: z.coerce.number().int().min(1).default(30),
  SOCKET_QUEUE_REFILL_PER_SEC: z.coerce.number().min(0.1).default(5),
});

export type Env = z.infer<typeof envSchema> & {
  /** Absolute path of the audio library. */
  mediaDir: string;
  corsOrigins: string[];
  adminEmails: string[];
  demoAuthSecret: string;
  isProduction: boolean;
  isTest: boolean;
  serviceVersion: string;
};

function resolveMediaDir(value: string): string {
  if (path.isAbsolute(value)) return value;
  return path.resolve(serverRoot, value);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const raw = parsed.data;

  if (raw.AUTH_MODE === 'clerk' && raw.NODE_ENV === 'production' && !raw.CLERK_SECRET_KEY) {
    throw new Error('AUTH_MODE=clerk in production requires CLERK_SECRET_KEY');
  }
  if (raw.AUTH_MODE === 'clerk' && !raw.CLERK_SECRET_KEY) {
    // Loud but non-fatal: a developer may be booting the API before wiring Clerk.
    process.stderr.write(
      '[cadenza] WARNING: AUTH_MODE=clerk but CLERK_SECRET_KEY is empty — protected routes will reject every request.\n',
    );
  }

  return {
    ...raw,
    mediaDir: resolveMediaDir(raw.MEDIA_DIR),
    corsOrigins: csv(raw.CORS_ORIGINS),
    adminEmails: csv(raw.ADMIN_EMAILS).map((email) => email.toLowerCase()),
    demoAuthSecret: raw.DEMO_AUTH_SECRET || raw.MEDIA_SIGNING_SECRET,
    isProduction: raw.NODE_ENV === 'production',
    isTest: raw.NODE_ENV === 'test',
    serviceVersion: process.env.npm_package_version ?? '1.0.0',
  };
}

export const REPO_ROOT = repoRoot;
export const SERVER_ROOT = serverRoot;
export const newRequestId = (): string => randomUUID();
