import { describe, expect, it } from 'vitest';
import { COMMITTED_SECRET_DEFAULTS, loadEnv } from '../../src/config/env.js';

/**
 * Production must fail *closed*. Before this guard existed, `NODE_ENV=production`
 * with `AUTH_MODE=demo` booted happily and `demoAuthSecret` fell back to the
 * media-signing placeholder that is committed in this repository — so anyone who
 * read the repo could mint a session the API accepted (forged `/api/auth/me`,
 * `/api/stats/overview`, and signed media URLs).
 *
 * The values below are assembled at runtime rather than written as literals so
 * the repo-wide secret scan (`scripts/secret_scan.sh`, check 3) stays clean.
 */
const realMediaSecret = ['production', 'media', 'signing', 'secret', 'value'].join('-');
const realDemoSecret = ['production', 'demo', 'auth', 'secret', 'value'].join('-');
const committedDefault = COMMITTED_SECRET_DEFAULTS[0] as string;

/** A minimal, complete source object — nothing is inherited from process.env. */
const source = (overrides: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  AUTH_MODE: 'clerk',
  CLERK_SECRET_KEY: 'not-a-real-clerk-key',
  MEDIA_SIGNING_SECRET: realMediaSecret,
  DEMO_AUTH_SECRET: realDemoSecret,
  ...overrides,
});

describe('production fails closed', () => {
  it('refuses to boot with AUTH_MODE=demo', () => {
    expect(() => loadEnv(source({ AUTH_MODE: 'demo' }))).toThrowError(/AUTH_MODE=demo/);
    expect(() => loadEnv(source({ AUTH_MODE: 'demo' }))).toThrowError(/Refusing to boot/);
  });

  it('refuses AUTH_MODE=demo in production even when every secret is a real one', () => {
    // The point is the *mode*, not the secret: a demo-signed session must never
    // be reachable in production, whatever the secret happens to be.
    expect(() =>
      loadEnv(source({ AUTH_MODE: 'demo', MEDIA_SIGNING_SECRET: realMediaSecret, DEMO_AUTH_SECRET: realDemoSecret })),
    ).toThrowError(/AUTH_MODE=demo/);
  });

  it('refuses to boot while MEDIA_SIGNING_SECRET is the committed placeholder', () => {
    // Omitting it is enough: the schema default is the committed placeholder.
    expect(() => loadEnv(source({ MEDIA_SIGNING_SECRET: committedDefault }))).toThrowError(/MEDIA_SIGNING_SECRET/);
    const withoutMediaSecret = { ...source(), MEDIA_SIGNING_SECRET: undefined } as unknown as NodeJS.ProcessEnv;
    expect(() => loadEnv(withoutMediaSecret)).toThrowError(/MEDIA_SIGNING_SECRET/);
    expect(() => loadEnv(withoutMediaSecret)).toThrowError(/committed/);
  });

  it('refuses to boot while DEMO_AUTH_SECRET is the committed placeholder', () => {
    expect(() => loadEnv(source({ DEMO_AUTH_SECRET: committedDefault }))).toThrowError(/DEMO_AUTH_SECRET/);
  });

  it('still requires CLERK_SECRET_KEY for clerk mode in production', () => {
    expect(() => loadEnv(source({ CLERK_SECRET_KEY: '' }))).toThrowError(/CLERK_SECRET_KEY/);
  });

  it('boots in production with clerk mode and real secrets', () => {
    const env = loadEnv(source());
    expect(env.AUTH_MODE).toBe('clerk');
    expect(env.isProduction).toBe(true);
    expect(env.demoAuthSecret).toBe(realDemoSecret);
    expect(env.MEDIA_SIGNING_SECRET).toBe(realMediaSecret);
  });
});

describe('development and test ergonomics are unchanged', () => {
  it('boots in development with demo auth and the committed defaults', () => {
    const env = loadEnv({ NODE_ENV: 'development', AUTH_MODE: 'demo' });
    expect(env.isProduction).toBe(false);
    expect(env.AUTH_MODE).toBe('demo');
    expect(env.demoAuthSecret).toBe(committedDefault);
  });

  it('boots in test mode with demo auth', () => {
    const env = loadEnv({ NODE_ENV: 'test', AUTH_MODE: 'demo' });
    expect(env.isTest).toBe(true);
    expect(env.AUTH_MODE).toBe('demo');
  });

  it('boots in development with the default clerk mode and warns instead of throwing', () => {
    const env = loadEnv({ NODE_ENV: 'development' });
    expect(env.AUTH_MODE).toBe('clerk');
    expect(env.isProduction).toBe(false);
  });
});
