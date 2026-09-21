import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createTestHarness, type TestHarness } from '../helpers/harness.js';
import { seedCatalog } from '../helpers/factory.js';

const mongoUri = inject('mongoUri');

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness(mongoUri, {
    envOverrides: {
      RATE_LIMIT_DISABLED: 'false',
      RATE_LIMIT_AUTH_MAX: '5',
      RATE_LIMIT_WRITE_MAX: '8',
      RATE_LIMIT_READ_MAX: '1000',
    },
  });
  await seedCatalog(2);
});

afterAll(async () => {
  await harness.close();
});

describe('auth rate limiting', () => {
  it('allows the configured burst and then answers 429 with a typed error', async () => {
    const statuses: number[] = [];
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const response = await harness
        .request()
        .post('/api/auth/demo-session')
        .send({ email: `ratelimit${attempt}@cadenza.test` });
      statuses.push(response.status);
      if (response.status === 429) {
        expect(response.body.error.code).toBe('RATE_LIMITED');
        expect(response.body.error.message).toMatch(/Rate limit reached for auth requests \(5 per 60s\)/);
        expect(response.headers['ratelimit']).toBeTruthy();
      }
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('keeps the write bucket separate from the auth bucket', async () => {
    // The auth bucket for this harness is already exhausted above; an
    // unauthenticated write must still be rejected as UNAUTHENTICATED (401)
    // rather than 429, proving the buckets are independent.
    const response = await harness.request().post('/api/playlists').send({ name: 'No auth header' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('rate limiting can be switched off for the e2e script', () => {
  let openHarness: TestHarness;

  beforeAll(async () => {
    openHarness = await createTestHarness(mongoUri, {
      envOverrides: { RATE_LIMIT_DISABLED: 'true' },
      manageConnection: false,
    });
  });

  afterAll(async () => {
    await openHarness.close();
  });

  it('accepts far more than the configured burst when disabled', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await openHarness
        .request()
        .post('/api/auth/demo-session')
        .send({ email: `open${attempt}@cadenza.test` });
      statuses.push(response.status);
    }
    expect(statuses.every((status) => status === 201)).toBe(true);
  });
});
