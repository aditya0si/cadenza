import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { createTestHarness, TEST_WEBHOOK_SIGNING_SECRET, type TestHarness } from '../helpers/harness.js';
import { ClerkWebhookVerifier, HmacWebhookVerifier } from '../../src/auth/webhook.js';
import { userRepository } from '../../src/repositories/user.repository.js';
import { ensureIndexes } from '../../src/db/connect.js';
import { AppError } from '../../src/errors.js';
import type { Request as ExpressRequest } from 'express';

const mongoUri = inject('mongoUri');

let harness: TestHarness;

beforeAll(async () => {
  harness = await createTestHarness(mongoUri);
  await ensureIndexes();
});

afterAll(async () => {
  await harness.close();
});

const clerkUserEvent = (id: string, email: string) => ({
  type: 'user.created',
  data: {
    id,
    first_name: 'Webhook',
    last_name: 'Listener',
    username: 'webhook-listener',
    image_url: 'https://img.clerk.test/w.png',
    primary_email_address_id: 'idn_1',
    email_addresses: [{ id: 'idn_1', email_address: email }],
    public_metadata: { roles: ['artist'] },
  },
});

const sign = (payload: unknown): string =>
  createHmac('sha256', TEST_WEBHOOK_SIGNING_SECRET).update(JSON.stringify(payload)).digest('hex');

describe('webhook sync over the test-mode verifier', () => {
  it('creates the local user mirror for a signed user.created event', async () => {
    const payload = clerkUserEvent('user_webhook_1', 'webhook1@cadenza.test');
    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(payload))
      .send(JSON.stringify(payload))
      .expect(200);

    expect(response.body).toMatchObject({ received: true, type: 'user.created', handled: true, verifier: 'test' });
    const user = await userRepository.findByClerkId('user_webhook_1');
    expect(user?.email).toBe('webhook1@cadenza.test');
    expect(user?.displayName).toBe('Webhook Listener');
    expect(user?.roles).toEqual(['artist']);
  });

  it('updates an existing mirror on user.updated', async () => {
    const payload = {
      type: 'user.updated',
      data: {
        ...clerkUserEvent('user_webhook_1', 'webhook1@cadenza.test').data,
        first_name: 'Renamed',
        last_name: 'Person',
        public_metadata: { roles: [] },
      },
    };
    await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(payload))
      .send(JSON.stringify(payload))
      .expect(200);

    const user = await userRepository.findByClerkId('user_webhook_1');
    expect(user?.displayName).toBe('Renamed Person');
  });

  it('deletes the mirror on user.deleted', async () => {
    const payload = { type: 'user.deleted', data: { id: 'user_webhook_1' } };
    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(payload))
      .send(JSON.stringify(payload))
      .expect(200);
    expect(response.body.handled).toBe(true);
    expect(await userRepository.findByClerkId('user_webhook_1')).toBeNull();
  });

  it('refuses a second subject that presents an email another mirror already owns', async () => {
    // Two Clerk ids for one address: the mirror is keyed by clerkId but owns a unique email, and the
    // local row is the account (its playlists, rooms and plays). The second subject must get a typed
    // 409 instead of a raw driver error, and must never inherit the first subject's row.
    const owner = clerkUserEvent('user_webhook_collide_a', 'collide@cadenza.test');
    await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(owner))
      .send(JSON.stringify(owner))
      .expect(200);

    const claimant = clerkUserEvent('user_webhook_collide_b', 'collide@cadenza.test');
    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(claimant))
      .send(JSON.stringify(claimant))
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
    expect(response.body.error.details).toEqual({ keys: ['email'] });
    expect(await userRepository.findByClerkId('user_webhook_collide_a')).not.toBeNull();
    expect(await userRepository.findByClerkId('user_webhook_collide_b')).toBeNull();
  });

  it('rejects a missing or wrong signature before touching the database', async () => {
    const payload = clerkUserEvent('user_webhook_forged', 'forged@cadenza.test');

    const missing = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(403);
    expect(missing.body.error.code).toBe('INVALID_SIGNATURE');

    const wrong = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', 'f'.repeat(64))
      .send(JSON.stringify(payload))
      .expect(403);
    expect(wrong.body.error.code).toBe('INVALID_SIGNATURE');

    expect(await userRepository.findByClerkId('user_webhook_forged')).toBeNull();
  });

  it('rejects a body whose bytes changed after signing', async () => {
    const payload = clerkUserEvent('user_webhook_tampered', 'tampered@cadenza.test');
    const signature = sign(payload);
    const tampered = JSON.stringify({ ...payload, data: { ...payload.data, id: 'user_webhook_other' } });

    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', signature)
      .send(tampered)
      .expect(403);
    expect(response.body.error.code).toBe('INVALID_SIGNATURE');
    expect(await userRepository.findByClerkId('user_webhook_other')).toBeNull();
  });

  it('rejects a payload that is signed but not a Clerk event', async () => {
    const payload = { hello: 'world' };
    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(payload))
      .send(JSON.stringify(payload))
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports an unhandled event type without failing the delivery', async () => {
    const payload = { type: 'session.created', data: { id: 'sess_1' } };
    const response = await harness
      .request()
      .post('/api/webhooks/clerk')
      .set('content-type', 'application/json')
      .set('x-cadenza-signature', sign(payload))
      .send(JSON.stringify(payload))
      .expect(200);
    expect(response.body).toMatchObject({ received: true, handled: false });
  });
});

describe('production webhook verifier (Clerk verifyWebhook + Standard Webhooks signature)', () => {
  const rawSecret = 'cadenza-webhook-signing-secret-32b!';
  const signingSecret = `whsec_${Buffer.from(rawSecret).toString('base64')}`;
  const verifier = new ClerkWebhookVerifier(signingSecret);

  const requestWith = (body: string, headers: Record<string, string>): ExpressRequest =>
    ({
      headers,
      method: 'POST',
      url: '/api/webhooks/clerk',
      originalUrl: '/api/webhooks/clerk',
      rawBody: Buffer.from(body, 'utf8'),
      body: Buffer.from(body, 'utf8'),
    }) as unknown as ExpressRequest;

  it('accepts a payload signed with the Clerk/svix scheme', async () => {
    const webhook = new Webhook(signingSecret);
    const body = JSON.stringify(clerkUserEvent('user_svix_1', 'svix1@cadenza.test'));
    const timestamp = new Date();
    const signature = webhook.sign('msg_cadenza_1', timestamp, body);

    const event = await verifier.verify(
      requestWith(body, {
        'svix-id': 'msg_cadenza_1',
        'svix-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
        'svix-signature': signature,
      }),
    );
    expect(event.type).toBe('user.created');
    expect((event.data as { id: string }).id).toBe('user_svix_1');
  });

  it('accepts the equivalent Standard Webhooks header names too', async () => {
    const webhook = new Webhook(signingSecret);
    const body = JSON.stringify(clerkUserEvent('user_svix_std', 'svix-std@cadenza.test'));
    const timestamp = new Date();
    const signature = webhook.sign('msg_cadenza_std', timestamp, body);

    const event = await verifier.verify(
      requestWith(body, {
        'webhook-id': 'msg_cadenza_std',
        'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
        'webhook-signature': signature,
      }),
    );
    expect((event.data as { id: string }).id).toBe('user_svix_std');
  });

  it('rejects a payload whose signature does not match the body', async () => {
    const webhook = new Webhook(signingSecret);
    const body = JSON.stringify(clerkUserEvent('user_svix_2', 'svix2@cadenza.test'));
    const timestamp = new Date();
    const signature = webhook.sign('msg_cadenza_2', timestamp, body);
    const tamperedBody = body.replace('user_svix_2', 'user_svix_evil');

    try {
      await verifier.verify(
        requestWith(tamperedBody, {
          'webhook-id': 'msg_cadenza_2',
          'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
          'webhook-signature': signature,
        }),
      );
      throw new Error('expected the tampered body to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects a payload signed with a different secret', async () => {
    const otherWebhook = new Webhook(`whsec_${Buffer.from('a-completely-different-secret-32!').toString('base64')}`);
    const body = JSON.stringify(clerkUserEvent('user_svix_3', 'svix3@cadenza.test'));
    const timestamp = new Date();
    const signature = otherWebhook.sign('msg_cadenza_3', timestamp, body);

    await expect(
      verifier.verify(
        requestWith(body, {
          'webhook-id': 'msg_cadenza_3',
          'webhook-timestamp': String(Math.floor(timestamp.getTime() / 1000)),
          'webhook-signature': signature,
        }),
      ),
    ).rejects.toThrowError(AppError);
  });

  it('exposes the test-mode verifier as a distinct implementation', async () => {
    const testVerifier = new HmacWebhookVerifier(TEST_WEBHOOK_SIGNING_SECRET);
    expect(testVerifier.mode).toBe('test');
    expect(verifier.mode).toBe('clerk');
    const body = JSON.stringify({ type: 'user.created', data: { id: 'x' } });
    await expect(testVerifier.verify(requestWith(body, {}))).rejects.toThrowError(/Missing x-cadenza-signature/);
  });
});
