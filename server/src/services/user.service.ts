import type { Types } from 'mongoose';
import { AppError } from '../errors.js';
import type { AuthenticatedUser, Role, VerifiedIdentity } from '../auth/types.js';
import { userRepository, type UserLean } from '../repositories/user.repository.js';
import { serializeUser, type UserDto } from '../http/serializers.js';

/**
 * The keys of MongoDB's duplicate-key error, or `null` for anything else. Kept local to
 * provisioning on purpose: the HTTP error handler has its own predicate and this fix does not
 * need to widen its blast radius.
 */
const duplicateKeyFields = (error: unknown): string[] | null => {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as { code?: unknown; keyPattern?: Record<string, unknown> };
  if (candidate.code !== 11000) return null;
  return Object.keys(candidate.keyPattern ?? {});
};

/**
 * Every request identity is materialised as a Mongo row before it is used, so
 * playlists/rooms/plays always point at a real user. Roles come from the
 * identity provider plus the ADMIN_EMAILS allowlist.
 */
export class UserService {
  constructor(private readonly adminEmails: string[]) {}

  mergeRoles(identity: VerifiedIdentity): Role[] {
    const roles = new Set<Role>(identity.roles.length > 0 ? identity.roles : ['listener']);
    if (this.adminEmails.includes(identity.email.toLowerCase())) roles.add('admin');
    return [...roles];
  }

  private toAuthenticated(user: UserLean): AuthenticatedUser {
    return {
      id: String(user._id),
      clerkId: user.clerkId,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      roles: [...user.roles] as Role[],
      createdAt: new Date(user.createdAt).toISOString(),
    };
  }

  /**
   * Materialises the local mirror of a provider identity.
   *
   * `upsertFromIdentity` looks the mirror up by `clerkId`, but `users.email` carries its own
   * unique index, so a *second* subject presenting an email that is already mirrored (the same
   * person signing up again, a demo session that already claimed the address, a second Clerk
   * instance) lands on that index — and whether it threw at all depended on whether autoIndex
   * had finished building `email_1` yet. That leaked a raw `MongoServerError: E11000`.
   *
   * The local row is the account: playlists, rooms and plays hang off it. So "adopt the row
   * that owns the email" is not safe here — returning it would hand this subject someone
   * else's library, and re-pointing its `clerkId` would take the account away from its real
   * owner. Two principals cannot share one mirror, so the second subject is refused with the
   * typed 409 the HTTP layer already reports for duplicate keys, instead of a driver error.
   *
   * The one duplicate that is genuinely benign is a `clerkId` collision: two concurrent first
   * requests for the same brand-new subject can both miss the pre-read and both insert, and the
   * row that won is this identity's own mirror. That case adopts the winner instead of failing
   * a request that has, in fact, already succeeded.
   */
  async ensureUser(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const roles = this.mergeRoles(identity);
    try {
      const user = await userRepository.upsertFromIdentity({
        clerkId: identity.subject,
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        roles,
      });
      return this.toAuthenticated(user);
    } catch (error) {
      const collidedFields = duplicateKeyFields(error);
      if (!collidedFields) throw error;

      if (collidedFields.includes('clerkId')) {
        const raced = await userRepository.findByClerkId(identity.subject);
        if (raced) return this.toAuthenticated(raced);
      }

      throw AppError.conflict('That email address is already linked to another account', {
        keys: collidedFields,
      });
    }
  }

  async getById(id: string | Types.ObjectId): Promise<AuthenticatedUser | null> {
    const user = await userRepository.findById(id);
    return user ? this.toAuthenticated(user) : null;
  }

  async list(limit = 50): Promise<UserDto[]> {
    const users = await userRepository.list({}, limit);
    return users.map(serializeUser);
  }

  async deleteByClerkId(clerkId: string): Promise<boolean> {
    return userRepository.deleteByClerkId(clerkId);
  }

  async requireById(id: string): Promise<AuthenticatedUser> {
    const user = await this.getById(id);
    if (!user) throw AppError.notFound('User not found');
    return user;
  }
}
