import { z } from 'zod';
import type { Request, Response } from 'express';
import { AppError } from '../../errors.js';
import type { AppContext } from '../../context.js';
import { issueDemoToken } from '../../auth/demoToken.js';
import type { AuthenticatedUser, Role } from '../../auth/types.js';
import type { UserDto } from '../serializers.js';
import { body } from '../middleware/validate.js';
import type { DemoSessionBody } from '../schemas.js';

export const toUserDto = (user: AuthenticatedUser): UserDto => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  roles: user.roles,
  createdAt: user.createdAt,
});

/** Clerk's `user.*` payloads, validated rather than trusted. */
const clerkUserPayload = z.object({
  id: z.string().min(1),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
  image_url: z.string().nullish(),
  primary_email_address_id: z.string().nullish(),
  email_addresses: z.array(z.object({ id: z.string(), email_address: z.string().email() })).default([]),
  public_metadata: z.record(z.unknown()).optional(),
});

export const createAuthController = (ctx: AppContext) => {
  const controller = {
    /**
     * Issues a locally signed demo session. Hard-gated on AUTH_MODE=demo: with
     * real Clerk configured this route 404s, so it can never become a bypass.
     */
    async demoSession(req: Request, res: Response): Promise<void> {
      if (ctx.env.AUTH_MODE !== 'demo') {
        throw AppError.notFound('Demo sessions are disabled because AUTH_MODE=clerk');
      }
      const input = body<DemoSessionBody>(req);
      const email = input.email.toLowerCase();
      const displayName = input.displayName ?? email.split('@')[0] ?? 'Listener';
      const roles = ctx.services.users.mergeRoles({
        subject: `demo:${email}`,
        email,
        displayName,
        avatarUrl: null,
        roles: [],
      });
      const { token, payload } = issueDemoToken(ctx.env.demoAuthSecret, {
        subject: `demo:${email}`,
        email,
        displayName,
        roles,
        ttlSeconds: ctx.env.DEMO_SESSION_TTL_SECONDS,
      });
      const user = await ctx.services.users.ensureUser({
        subject: payload.sub,
        email,
        displayName,
        avatarUrl: null,
        roles,
      });

      res.status(201).json({
        mode: 'demo',
        warning:
          'DEMO AUTH MODE — this session was signed locally, not by Clerk. Set AUTH_MODE=clerk and VITE_AUTH_MODE=clerk with real Clerk keys for production auth.',
        token,
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        user: toUserDto(user),
      });
    },

    async me(req: Request, res: Response): Promise<void> {
      const user = req.auth?.user;
      if (!user) throw AppError.unauthenticated();
      res.json({ user: toUserDto(user), authMode: ctx.identity.mode, roles: user.roles as Role[] });
    },

    /** Clerk user sync. The signature is verified before anything is touched. */
    async clerkWebhook(req: Request, res: Response): Promise<void> {
      const event = await ctx.webhook.verify(req);
      let handled = false;

      if (event.type === 'user.created' || event.type === 'user.updated') {
        const parsed = clerkUserPayload.safeParse(event.data);
        if (!parsed.success) {
          throw AppError.validation('Clerk user payload is missing required fields', parsed.error.issues);
        }
        const payload = parsed.data;
        const primary =
          payload.email_addresses.find((address) => address.id === payload.primary_email_address_id) ??
          payload.email_addresses[0];
        if (!primary) throw AppError.validation('Clerk user payload has no email address');
        const displayName =
          [payload.first_name, payload.last_name].filter(Boolean).join(' ').trim() ||
          payload.username ||
          primary.email_address.split('@')[0] ||
          'Listener';
        const providerRoles = Array.isArray(payload.public_metadata?.['roles'])
          ? (payload.public_metadata['roles'] as unknown[]).filter(
              (role): role is Role => role === 'listener' || role === 'artist' || role === 'admin',
            )
          : [];

        await ctx.services.users.ensureUser({
          subject: payload.id,
          email: primary.email_address.toLowerCase(),
          displayName,
          avatarUrl: payload.image_url ?? null,
          roles: providerRoles,
        });
        handled = true;
      } else if (event.type === 'user.deleted') {
        const parsed = z.object({ id: z.string().min(1) }).safeParse(event.data);
        if (!parsed.success) throw AppError.validation('Clerk user.deleted payload has no id');
        handled = await ctx.services.users.deleteByClerkId(parsed.data.id);
      }

      res.json({ received: true, type: event.type, handled, verifier: ctx.webhook.mode });
    },
  };

  return controller;
};
