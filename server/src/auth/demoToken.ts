import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';
import type { Role, VerifiedIdentity } from './types.js';

/**
 * Demo sessions exist so the app can be booted, clicked through and tested
 * without a Clerk account. They are:
 *   - only issued when AUTH_MODE=demo (the route 404s otherwise),
 *   - signed with DEMO_AUTH_SECRET (HMAC-SHA256, base64url),
 *   - short lived (DEMO_SESSION_TTL_SECONDS),
 *   - loudly labelled as demo mode in the API response and in the UI.
 *
 * This is a separate verifier implementation, injected through the same
 * `IdentityVerifier` seam as the real Clerk verifier — there is no branch
 * inside the production auth path that skips verification.
 */
export interface DemoTokenPayload {
  sub: string;
  email: string;
  name: string;
  roles: Role[];
  iat: number;
  exp: number;
  mode: 'demo';
}

/**
 * The longest lifetime the verifier will accept, whatever a token claims. The
 * default session TTL is 12 hours; a token that outlives this is refused, so a
 * leaked signing secret cannot mint a decade-long session.
 */
export const MAX_DEMO_SESSION_TTL_SECONDS = 24 * 60 * 60;

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

const sign = (secret: string, payload: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function issueDemoToken(
  secret: string,
  input: { email: string; displayName: string; roles: Role[]; subject?: string; ttlSeconds: number; now?: number },
): { token: string; payload: DemoTokenPayload } {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1000);
  const payload: DemoTokenPayload = {
    sub: input.subject ?? `demo:${randomUUID()}`,
    email: input.email,
    name: input.displayName,
    roles: input.roles,
    iat: issuedAt,
    exp: issuedAt + input.ttlSeconds,
    mode: 'demo',
  };
  const encoded = b64url(JSON.stringify(payload));
  return { token: `${encoded}.${sign(secret, encoded)}`, payload };
}

export function verifyDemoToken(secret: string, token: string, now = Date.now()): DemoTokenPayload {
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) throw AppError.unauthenticated('Malformed demo session token');

  const expected = sign(secret, encoded);
  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw AppError.unauthenticated('Demo session token signature is not valid');
  }

  let payload: DemoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as DemoTokenPayload;
  } catch {
    throw AppError.unauthenticated('Demo session token payload is not readable');
  }

  if (payload.mode !== 'demo') throw AppError.unauthenticated('Demo session token has the wrong purpose');
  // `exp` is mandatory: a correctly-signed token without one used to compare
  // `undefined * 1000 <= now` (false), i.e. it never expired.
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
    throw AppError.unauthenticated('Demo session token has no issue time');
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw AppError.unauthenticated('Demo session token has no expiry');
  }
  if (payload.exp <= payload.iat) {
    throw AppError.unauthenticated('Demo session token expires before it was issued');
  }
  if (payload.exp - payload.iat > MAX_DEMO_SESSION_TTL_SECONDS) {
    throw AppError.unauthenticated(
      `Demo session token TTL exceeds the ${MAX_DEMO_SESSION_TTL_SECONDS} second maximum`,
    );
  }
  if (payload.exp * 1000 <= now) throw AppError.unauthenticated('Demo session token has expired');
  return payload;
}

export const demoPayloadToIdentity = (payload: DemoTokenPayload): VerifiedIdentity => ({
  subject: payload.sub,
  email: payload.email.toLowerCase(),
  displayName: payload.name,
  avatarUrl: null,
  roles: payload.roles,
});
