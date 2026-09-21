import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { UserService } from '../../src/services/user.service.js';
import { userRepository } from '../../src/repositories/user.repository.js';
import { User } from '../../src/models/index.js';
import { AppError } from '../../src/errors.js';
import type { VerifiedIdentity } from '../../src/auth/types.js';

const mongoUri = inject('mongoUri');

/**
 * A fresh address for every fixture. These tests used to share one literal email
 * (`listener@cadenza.test`) across *different* Clerk subjects. `ensureUser` keys the mirror by
 * subject, so each new subject inserted another document carrying an already-used email, and the
 * insert only survived while the unique `email_1` index was still being built in the background
 * (autoIndex is asynchronous). With a cold index that is a real E11000 — the flake this file had.
 * Unique addresses per fixture remove the shared state, so every test owns its own user.
 */
const uniqueEmail = (label: string): string => `${label}-${randomBytes(6).toString('hex')}@cadenza.test`;

const identity = (overrides: Partial<VerifiedIdentity> = {}): VerifiedIdentity => ({
  subject: `user_clerk_${randomBytes(6).toString('hex')}`,
  email: uniqueEmail('listener'),
  displayName: 'Clerk Listener',
  avatarUrl: 'https://img.clerk.test/avatar.png',
  roles: [],
  ...overrides,
});

let service: UserService;

beforeAll(async () => {
  // Vitest runs every file in one fork (poolOptions.forks.singleFork), and mongoose's default
  // connection is a process-wide singleton: if an earlier file left a connection open, this
  // `connect()` is a no-op and the `dbName` below is silently ignored, so this file ends up writing
  // into the previous file's database (observed as a flaky E11000 on a shared fixture email).
  // Close whatever is open first so this file deterministically owns its own database.
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  await mongoose.connect(mongoUri, { dbName: `cadenza_users_${randomBytes(4).toString('hex')}` });
  // Build the unique indexes (clerkId, email) before the first test. They are otherwise created in
  // the background, which would make the duplicate-email assertions below a race against the index
  // builder instead of a deterministic answer from the database.
  await User.init();
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
    const clerk = identity({ subject: 'user_clerk_123' });
    const first = await service.ensureUser(clerk);
    expect(first.clerkId).toBe('user_clerk_123');
    expect(first.roles).toEqual(['listener']);
    expect(first.createdAt).toBeTruthy();

    const second = await service.ensureUser({ ...clerk, displayName: 'Renamed' });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Renamed');
    expect(await userRepository.count()).toBe(1);
  });

  it('grants admin from the allowlist on provisioning', async () => {
    const admin = await service.ensureUser(identity({ subject: 'user_clerk_admin', email: 'admin@cadenza.test' }));
    expect(admin.roles).toContain('admin');
  });

  // Both tests below used to reuse the fixture's default email while introducing a new subject, so
  // their setup — not their assertion — was the part passing by accident of index timing: the second
  // insert only succeeded while `email_1` was still missing. The assertions themselves (roles are
  // filtered, delete is a no-op the second time) were always correct; they now get their own email.
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

describe('UserService duplicate-email provisioning', () => {
  /**
   * Pins the product decision: the local row *is* the account (its playlists, rooms and plays hang
   * off it), so a second provider subject that presents an email another account already owns is
   * refused with a typed 409 — never merged onto that row, and never a raw MongoServerError.
   */
  it('refuses a second subject claiming an email that is already mirrored', async () => {
    const email = uniqueEmail('contested');
    const owner = await service.ensureUser(identity({ subject: 'user_clerk_owner', email }));
    const before = await userRepository.count();

    const failure = await service
      .ensureUser(identity({ subject: 'user_clerk_impostor', email }))
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(AppError);
    const conflict = failure as AppError;
    expect(conflict.code).toBe('CONFLICT');
    expect(conflict.status).toBe(409);
    expect(conflict.message).toMatch(/already linked to another account/i);
    expect(conflict.details).toEqual({ keys: ['email'] });

    // The owner keeps the row, and the refused insert left nothing behind.
    const stillOwner = await userRepository.findByClerkId('user_clerk_owner');
    expect(String(stillOwner?._id)).toBe(owner.id);
    expect(stillOwner?.email).toBe(email);
    expect(await userRepository.count()).toBe(before);
  });

  it('adopts the mirror when a concurrent first request wins the clerkId race', async () => {
    const clerk = identity({ subject: 'user_clerk_race' });
    const winner = await service.ensureUser(clerk);

    // The loser's pre-read (`User.findOne` by clerkId) misses because the winner's insert was not
    // visible yet, so the loser's insert collides on clerkId. The race window cannot be forced from
    // a single-threaded test, so the miss is simulated for exactly one call.
    const spy = vi.spyOn(User, 'findOne').mockImplementationOnce(() => null as never);
    try {
      const loser = await service.ensureUser(clerk);
      expect(loser.id).toBe(winner.id);
      expect(loser.clerkId).toBe('user_clerk_race');
    } finally {
      spy.mockRestore();
    }

    // The loser adopted the winner's row instead of inserting a second mirror for the subject.
    const mirrors = await userRepository.list({ clerkId: 'user_clerk_race' });
    expect(mirrors).toHaveLength(1);
    expect(String(mirrors[0]?._id)).toBe(winner.id);
  });
});
