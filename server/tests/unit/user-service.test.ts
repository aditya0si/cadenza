import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { UserService } from '../../src/services/user.service.js';
import { userRepository } from '../../src/repositories/user.repository.js';
import { AppError } from '../../src/errors.js';
import type { VerifiedIdentity } from '../../src/auth/types.js';

const mongoUri = inject('mongoUri');

const identity = (overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  subject: 'user_clerk_123',
  email: 'listener@cadenza.test',
  displayName: 'Clerk Listener',
  avatarUrl: 'https://img.clerk.test/avatar.png',
  roles: [],
  ...overrides,
});

let service: UserService;

beforeAll(async () => {
  await mongoose.connect(mongoUri, { dbName: `cadenza_users_${randomBytes(4).toString('hex')}` });
  service = new UserService(['admin@cadenza.test']);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe('UserService role merging', () => {
  it('defaults to listener', () => {
    expect(service.mergeRoles(identity())).toEqual(['listener']);
  });

  it('keeps provider roles and adds admin for allowlisted emails', () => {
    expect(service.mergeRoles(identity({ roles: ['artist'] }))).toEqual(['artist']);
    expect(service.mergeRoles(identity({ email: 'ADMIN@cadenza.test' }))).toEqual(['listener', 'admin']);
  });

  it('never duplicates a role that is both provided and allowlisted', () => {
    expect(service.mergeRoles(identity({ email: 'admin@cadenza.test', roles: ['admin', 'listener'] }))).toEqual([
      'admin',
      'listener',
    ]);
  });
});

describe('UserService provisioning', () => {
  it('creates the local mirror on first sight and reuses it afterwards', async () => {
    const first = await service.ensureUser(identity());
    expect(first.clerkId).toBe('user_clerk_123');
    expect(first.roles).toEqual(['listener']);
    expect(first.createdAt).toBeTruthy();

    const second = await service.ensureUser(identity({ displayName: 'Renamed' }));
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed');
    expect(await userRepository.count()).toBe(1);
  });

  it('grants admin from the allowlist on provisioning', async () => {
    const admin = await service.ensureUser(identity({ subject: 'user_clerk_admin', email: 'admin@cadenza.test' }));
    expect(admin.roles).toContain('admin');
  });

  it('filters out roles the provider should not be able to invent', async () => {
    const user = await service.ensureUser(identity({ subject: 'user_clerk_weird', roles: ['wizard' as never] }));
    expect(user.roles).toEqual(['listener']);
  });

  it('throws a typed NOT_FOUND when a user id is unknown', async () => {
    const missing = new mongoose.Types.ObjectId().toHexString();
    await expect(service.requireById(missing)).rejects.toThrowError(AppError);
    try {
      await service.requireById(missing);
    } catch (error) {
      expect((error as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('deletes a user by clerk id (Clerk user.deleted sync)', async () => {
    await service.ensureUser(identity({ subject: 'user_clerk_gone' }));
    expect(await service.deleteByClerkId('user_clerk_gone')).toBe(true);
    expect(await service.deleteByClerkId('user_clerk_gone')).toBe(false);
  });
});
