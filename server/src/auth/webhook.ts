import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request as ExpressRequest } from 'express';
import { AppError } from '../errors.js';
import type { VerifiedWebhookEvent, WebhookVerifier } from './types.js';

export const TEST_WEBHOOK_SIGNATURE_HEADER = 'x-cadenza-signature';

/** Standard Webhooks header → the Svix-era alias Clerk's SDK reads. */
export const STANDARD_WEBHOOK_HEADER_ALIASES: Record<string, string> = {
  'webhook-id': 'svix-id',
  'webhook-timestamp': 'svix-timestamp',
  'webhook-signature': 'svix-signature',
};

/** Reads the exact bytes the client signed (captured by the JSON body parser). */
const rawBodyOf = (request: ExpressRequest): Buffer => {
  if (request.rawBody) return request.rawBody;
  if (typeof request.body === 'string') return Buffer.from(request.body, 'utf8');
  if (Buffer.isBuffer(request.body)) return request.body;
  throw AppError.validation('Webhook request has no raw body to verify');
};

const headerValue = (request: ExpressRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Production webhook path: Clerk's own `verifyWebhook` from `@clerk/express`,
 * which validates the Standard Webhooks signature. The Express request is
 * forwarded with its raw body so the signature is checked over the original
 * bytes.
 *
 * Standard Webhooks names its headers `webhook-id` / `webhook-timestamp` /
 * `webhook-signature`; Clerk's SDK implementation only reads the Svix-era
 * aliases (`svix-*`). Both spellings are therefore accepted here by copying a
 * standard header onto its Svix alias when the alias is absent — the signature
 * itself is still verified by Clerk's own code, never by ours.
 */
export class ClerkWebhookVerifier implements WebhookVerifier {
  readonly mode = 'clerk' as const;

  constructor(private readonly signingSecret: string) {}

  async verify(request: ExpressRequest): Promise<VerifiedWebhookEvent> {
    const { verifyWebhook } = await import('@clerk/express/webhooks');
    const raw = rawBodyOf(request);

    const headers: Record<string, string | string[] | undefined> = { ...request.headers };
    for (const [standard, svix] of Object.entries(STANDARD_WEBHOOK_HEADER_ALIASES)) {
      if (headers[svix] === undefined && headers[standard] !== undefined) {
        headers[svix] = headers[standard];
      }
    }

    // Clerk's express helper reads `req.body`; hand it the exact raw bytes.
    const clerkRequest = {
      headers,
      method: request.method,
      url: request.url,
      originalUrl: request.originalUrl,
      connection: (request as unknown as { connection?: { encrypted?: boolean } }).connection,
      body: raw,
    } as unknown as ExpressRequest;

    try {
      const event = await verifyWebhook(
        clerkRequest,
        this.signingSecret ? { signingSecret: this.signingSecret } : undefined,
      );
      return { type: event.type, data: event.data as unknown as Record<string, unknown> };
    } catch (error) {
      throw new AppError(
        'INVALID_SIGNATURE',
        `Clerk webhook signature verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

/**
 * Test-mode webhook verifier, injected in place of the Clerk verifier by the test
 * harness and the e2e smoke script (neither has a Clerk account). It performs a
 * real HMAC-SHA256 check over the raw body — a wrong or missing signature is
 * rejected — it simply uses a local shared secret instead of Clerk's svix
 * secret. Production never selects this implementation.
 */
export class HmacWebhookVerifier implements WebhookVerifier {
  readonly mode = 'test' as const;

  constructor(private readonly secret: string) {}

  async verify(request: ExpressRequest): Promise<VerifiedWebhookEvent> {
    const raw = rawBodyOf(request);
    const signature = headerValue(request, TEST_WEBHOOK_SIGNATURE_HEADER);
    if (!signature) {
      throw new AppError('INVALID_SIGNATURE', `Missing ${TEST_WEBHOOK_SIGNATURE_HEADER} header`);
    }

    const expected = createHmac('sha256', this.secret).update(raw).digest('hex');
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new AppError('INVALID_SIGNATURE', 'Webhook signature does not match the raw body');
    }

    try {
      const parsed = JSON.parse(raw.toString('utf8')) as { type?: unknown; data?: unknown };
      if (typeof parsed.type !== 'string') throw new Error('missing `type`');
      return { type: parsed.type, data: (parsed.data ?? {}) as Record<string, unknown> };
    } catch (error) {
      throw AppError.validation(
        `Webhook body is not a valid Clerk event: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

/** Signs a payload the way `HmacWebhookVerifier` expects (tests + e2e only). */
export const signTestWebhook = (secret: string, payload: unknown): string =>
  createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

export function createWebhookVerifier(env: {
  AUTH_MODE: 'clerk' | 'demo';
  CLERK_WEBHOOK_SECRET: string;
  demoAuthSecret: string;
}): WebhookVerifier {
  return env.AUTH_MODE === 'demo'
    ? new HmacWebhookVerifier(env.demoAuthSecret)
    : new ClerkWebhookVerifier(env.CLERK_WEBHOOK_SECRET);
}
