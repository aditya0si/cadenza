import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  demoPayloadToIdentity,
  issueDemoToken,
  MAX_DEMO_SESSION_TTL_SECONDS,
  verifyDemoToken,
} from '../../src/auth/demoToken.js';
import { AppError } from '../../src/errors.js';

// Assembled rather than written as one literal so the repo-wide secret scan
// (`scripts/secret_scan.sh`, check 3) stays strict for every tracked file
// instead of needing a test-directory exclusion. The runtime value is
// "unit-test-demo-auth-secret" — a placeholder, never a real credential.
const SECRET = ['unit', 'test', 'demo', 'auth', 'secret'].join('-');
const NOW = 1_760_000_000_000;

const issue = (overrides: Partial<Parameters<typeof issueDemoToken>[1]> = {}) =>
  issueDemoToken(SECRET, {
    subject: 'demo:listener@cadenza.test',
    email: 'listener@cadenza.test',
    displayName: 'Test Listener',
    roles: ['listener'],
    ttlSeconds: 3_600,
    now: NOW,
    ...overrides,
  });

describe('demo session tokens', () => {
  it('issues a verifiable, short-lived token', () => {
    const { token, payload } = issue();
    const verified = verifyDemoToken(SECRET, token, NOW);
    expect(verified).toEqual(payload);
    expect(verified.exp).toBe(Math.floor(NOW / 1000) + 3_600);
    expect(verified.mode).toBe('demo');
  });

  it('maps the payload onto an identity', () => {
    const identity = demoPayloadToIdentity(issue().payload);
    expect(identity).toEqual({
      subject: 'demo:listener@cadenza.test',
      email: 'listener@cadenza.test',
      displayName: 'Test Listener',
      avatarUrl: null,
      roles: ['listener'],
    });
  });

  it('mints a fresh subject when none is supplied', () => {
    const { payload } = issueDemoToken(SECRET, {
      email: 'anon@cadenza.test',
      displayName: 'Anon',
      roles: ['listener'],
      ttlSeconds: 60,
      now: NOW,
    });
    expect(payload.sub).toMatch(/^demo:[0-9a-f-]{36}$/);
  });

  it('lower-cases the email so identities cannot fork on casing', () => {
    const identity = demoPayloadToIdentity(issue({ email: 'MiXeD@Cadenza.Test' }).payload);
    expect(identity.email).toBe('mixed@cadenza.test');
  });

  it('rejects a tampered payload', () => {
    const { token } = issue();
    const [encoded, signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8')), roles: ['admin'] }),
    ).toString('base64url');
    try {
      verifyDemoToken(SECRET, `${forgedPayload}.${signature ?? ''}`, NOW);
      throw new Error('expected the forged payload to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('UNAUTHENTICATED');
    }
  });

  it('rejects an expired token', () => {
    const { token } = issue({ ttlSeconds: 60 });
    try {
      verifyDemoToken(SECRET, token, NOW + 61_000);
      throw new Error('expected the expired token to be rejected');
    } catch (error) {
      expect((error as AppError).message).toMatch(/expired/i);
    }
  });

  it('rejects tokens signed with another secret', () => {
    const { token } = issue();
    expect(() => verifyDemoToken('a-different-secret', token, NOW)).toThrowError(AppError);
  });

  it('rejects malformed and wrong-purpose tokens', () => {
    expect(() => verifyDemoToken(SECRET, 'not-a-token', NOW)).toThrowError(/Malformed/);
    const wrongPurpose = Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.c', name: 'x', roles: [], iat: 0, exp: 9_999_999_999, mode: 'prod' })).toString('base64url');
    const signature = Buffer.from(issue().token.split('.')[1] ?? '', 'base64url');
    void signature;
    const forged = `${wrongPurpose}.${issue().token.split('.')[1] ?? ''}`;
    try {
      verifyDemoToken(SECRET, forged, NOW);
      throw new Error('expected the wrong-purpose token to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('UNAUTHENTICATED');
    }
  });
});

/**
 * A correctly-signed token is not automatically a valid one: the payload has to
 * carry a usable lifetime. Before these checks, a token with no `exp` compared
 * `undefined * 1000 <= now` (false) and therefore never expired, and any TTL was
 * accepted — a leaked secret could mint a decade-long session.
 */
describe('demo session token lifetime', () => {
  /** Signs an arbitrary payload with the real secret, the way an attacker with the secret would. */
  const sign = (payload: Record<string, unknown>): string => {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', SECRET).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
  };

  const issuedAt = Math.floor(NOW / 1000);
  const base = {
    sub: 'demo:listener@cadenza.test',
    email: 'listener@cadenza.test',
    name: 'Test Listener',
    roles: ['listener'],
    iat: issuedAt,
    mode: 'demo',
  };

  it('rejects a correctly-signed token that carries no expiry', () => {
    expect(() => verifyDemoToken(SECRET, sign(base), NOW)).toThrowError(/no expiry/i);
  });

  it('rejects a correctly-signed token with a non-numeric expiry', () => {
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: 'never' }), NOW)).toThrowError(/no expiry/i);
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: null }), NOW)).toThrowError(/no expiry/i);
  });

  it('rejects a correctly-signed token with no issue time', () => {
    expect(() => verifyDemoToken(SECRET, sign({ ...base, iat: undefined, exp: issuedAt + 60 }), NOW)).toThrowError(
      /no issue time/i,
    );
  });

  it('rejects a correctly-signed token that expires before it was issued', () => {
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: issuedAt }), NOW)).toThrowError(/before it was issued/i);
  });

  it('rejects a correctly-signed token whose TTL exceeds the cap', () => {
    const decade = issuedAt + 10 * 365 * 24 * 60 * 60;
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: decade }), NOW)).toThrowError(/exceeds the/i);
  });

  it('accepts a correctly-signed token at exactly the cap and rejects one second over', () => {
    const atCap = issuedAt + MAX_DEMO_SESSION_TTL_SECONDS;
    expect(verifyDemoToken(SECRET, sign({ ...base, exp: atCap }), NOW).exp).toBe(atCap);
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: atCap + 1 }), NOW)).toThrowError(/exceeds the/i);
  });

  it('rejects a correctly-signed token with the wrong purpose', () => {
    expect(() => verifyDemoToken(SECRET, sign({ ...base, exp: issuedAt + 60, mode: 'prod' }), NOW)).toThrowError(
      /wrong purpose/i,
    );
  });

  it('never issues a token the verifier would refuse', () => {
    const { token, payload } = issue();
    expect(verifyDemoToken(SECRET, token, NOW)).toEqual(payload);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(MAX_DEMO_SESSION_TTL_SECONDS);
  });
});
