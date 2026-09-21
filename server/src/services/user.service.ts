import type { Types } from 'mongoose';
import { AppError } from '../errors.js';
import type { AuthenticatedUser, Role, VerifiedIdentity } from '../auth/types.js';
import { userRepository, type UserLean } from '../repositories/user.repository.js';
import { serializeUser, type UserDto } from '../http/serializers.js';

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

  async ensureUser(identity: VerifiedIdentity): Promise<AuthenticatedUser> {
    const roles = this.mergeRoles(identity);
    const user = await userRepository.upsertFromIdentity({
      clerkId: identity.subject,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      roles,
    });
    return this.toAuthenticated(user);
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
