export type Role = 'listener' | 'artist' | 'admin';
import type { Request as ExpressRequest } from 'express';

/** The identity claims an auth provider is trusted to have produced. */
export interface VerifiedIdentity {
  /** Stable provider subject, e.g. a Clerk user id (`user_...`) or `demo:<uuid>`. */
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  /** Roles asserted by the provider itself (Clerk `publicMetadata.roles`). */
  roles: Role[];
}

export interface IdentityVerifier {
  readonly mode: 'clerk' | 'demo';
  /** Throws AppError('UNAUTHENTICATED') when the token is missing/invalid/expired. */
  verify(token: string): Promise<VerifiedIdentity>;
}

/** A user row as the rest of the app sees it (Mongo `_id` already stringified). */
export interface AuthenticatedUser {
  id: string;
  clerkId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  roles: Role[];
  createdAt: string;
}

export interface VerifiedWebhookEvent {
  type: string;
  data: Record<string, unknown>;
}

export interface WebhookVerifier {
  readonly mode: 'clerk' | 'test';
  /**
   * Verifies the signature over the raw request body and returns the decoded
   * event. Must throw AppError('INVALID_SIGNATURE') on any mismatch.
   *
   * The Express request is passed through so the production implementation can
   * hand it straight to Clerk's own `verifyWebhook`; the raw bytes are read from
   * `req.rawBody` (captured by the JSON body parser).
   */
  verify(request: ExpressRequest): Promise<VerifiedWebhookEvent>;
}
