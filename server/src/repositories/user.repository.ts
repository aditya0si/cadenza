import type { FilterQuery, Types } from 'mongoose';
import { User, type UserDocument } from '../models/index.js';

export type UserLean = UserDocument & { _id: Types.ObjectId };

export interface UpsertUserInput {
  clerkId: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  /** Roles asserted by the identity provider, merged with ADMIN_EMAILS by the caller. */
  roles?: string[];
}

const ROLE_VALUES = ['listener', 'artist', 'admin'] as const;
const isRole = (value: string): value is (typeof ROLE_VALUES)[number] =>
  (ROLE_VALUES as readonly string[]).includes(value);

export const userRepository = {
  async findByClerkId(clerkId: string): Promise<UserLean | null> {
    return User.findOne({ clerkId }).lean<UserLean>();
  },

  async findById(id: string | Types.ObjectId): Promise<UserLean | null> {
    return User.findById(id).lean<UserLean>();
  },

  async findByIds(ids: (string | Types.ObjectId)[]): Promise<UserLean[]> {
    if (ids.length === 0) return [];
    return User.find({ _id: { $in: ids } }).lean<UserLean[]>();
  },

  async list(filter: FilterQuery<UserDocument> = {}, limit = 50): Promise<UserLean[]> {
    return User.find(filter).sort({ createdAt: -1 }).limit(limit).lean<UserLean[]>();
  },

  /**
   * Creates or refreshes the local mirror of a provider identity. Used by the
   * Clerk webhook sync and by first-request provisioning for demo sessions.
   */
  async upsertFromIdentity(input: UpsertUserInput): Promise<UserLean> {
    const roles = input.roles?.filter(isRole);
    const existing = await User.findOne({ clerkId: input.clerkId });
    if (existing) {
      existing.email = input.email.toLowerCase();
      existing.displayName = input.displayName;
      if (input.avatarUrl !== undefined) existing.avatarUrl = input.avatarUrl ?? null;
      if (roles && roles.length > 0) existing.roles = roles;
      existing.lastSeenAt = new Date();
      await existing.save();
      return existing.toObject<UserLean>();
    }
    const created = await User.create({
      clerkId: input.clerkId,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      avatarUrl: input.avatarUrl ?? null,
      roles: roles && roles.length > 0 ? roles : ['listener'],
      lastSeenAt: new Date(),
    });
    return created.toObject<UserLean>();
  },

  async setRoles(clerkId: string, roles: string[]): Promise<UserLean | null> {
    return User.findOneAndUpdate({ clerkId }, { $set: { roles } }, { new: true }).lean<UserLean>();
  },

  async touchLastSeen(id: string | Types.ObjectId): Promise<void> {
    await User.updateOne({ _id: id }, { $set: { lastSeenAt: new Date() } });
  },

  async deleteByClerkId(clerkId: string): Promise<boolean> {
    const result = await User.deleteOne({ clerkId });
    return result.deletedCount === 1;
  },

  async count(): Promise<number> {
    return User.countDocuments({});
  },
};
