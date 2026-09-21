import { AppError } from '../errors.js';
import type { Env } from '../config/env.js';
import { demoPayloadToIdentity, verifyDemoToken } from './demoToken.js';
import type { IdentityVerifier, Role, VerifiedIdentity } from './types.js';

const ROLES: Role[] = ['listener', 'artist', 'admin'];
const coerceRoles = (value: unknown): Role[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Role => typeof entry === 'string' && ROLES.includes(entry as Role));
};

/**
 * Production auth path: verifies a real Clerk session token with Clerk's own
 * `verifyToken`, then tops the identity up from the Clerk Backend API when the
 * session token does not carry an email claim (the default for Clerk sessions).
 */
export class ClerkIdentityVerifier implements IdentityVerifier {
  readonly mode = 'clerk' as const;

  constructor(private readonly secretKey: string) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    if (!this.secretKey) {
      throw AppError.unavailable('CLERK_SECRET_KEY is not configured on the API');
    }
    const { verifyToken, clerkClient } = await import('@clerk/express');

    let payload: Record<string, unknown> | undefined;
    try {
      payload = (await verifyToken(token, { secretKey: this.secretKey })) as Record<string, unknown> | undefined;
    } catch (error) {
      throw AppError.unauthenticated(
        `Clerk rejected the session token: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    const subject = typeof payload?.sub === 'string' ? payload.sub : undefined;
    if (!subject) throw AppError.unauthenticated('Clerk session token has no subject');

    let email = typeof payload?.email === 'string' ? payload.email : undefined;
    let displayName = typeof payload?.name === 'string' ? payload.name : undefined;
    let avatarUrl = typeof payload?.picture === 'string' ? payload.picture : null;
    let roles = coerceRoles((payload?.publicMetadata as { roles?: unknown } | undefined)?.roles);

    if (!email) {
      const user = await clerkClient.users.getUser(subject);
      email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress;
      displayName = displayName ?? user.fullName ?? user.username ?? 'Listener';
      avatarUrl = avatarUrl ?? user.imageUrl ?? null;
      roles = roles.length > 0 ? roles : coerceRoles((user.publicMetadata as { roles?: unknown } | undefined)?.roles);
    }
    if (!email) throw AppError.unauthenticated('Clerk user has no email address');

    return {
      subject,
      email: email.toLowerCase(),
      displayName: displayName ?? email.split('@')[0] ?? 'Listener',
      avatarUrl,
      roles,
    };
  }
}

/** Development / test auth path — see `demoToken.ts` for the guarantees. */
export class DemoIdentityVerifier implements IdentityVerifier {
  readonly mode = 'demo' as const;

  constructor(private readonly secret: string) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    return demoPayloadToIdentity(verifyDemoToken(this.secret, token));
  }
}

export function createIdentityVerifier(env: Env): IdentityVerifier {
  return env.AUTH_MODE === 'demo'
    ? new DemoIdentityVerifier(env.demoAuthSecret)
    : new ClerkIdentityVerifier(env.CLERK_SECRET_KEY);
}
