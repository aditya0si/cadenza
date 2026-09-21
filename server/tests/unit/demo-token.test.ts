import { describe, expect, it } from 'vitest';
import { demoPayloadToIdentity, issueDemoToken, verifyDemoToken } from '../../src/auth/demoToken.js';
import { AppError } from '../../src/errors.js';

const SECRET = 'unit-test-demo-auth-secret';
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
