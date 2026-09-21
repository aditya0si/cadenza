import type { AuthenticatedUser } from '../auth/types.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id echoed in the `x-request-id` response header. */
      id: string;
      /** Present only after `requireAuth` succeeded. */
      auth?: { user: AuthenticatedUser };
      /** Raw body, kept for webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}

export {};
