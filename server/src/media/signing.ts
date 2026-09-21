import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.js';

/**
 * Short-lived, single-purpose stream tokens.
 *
 * `sig = HMAC_SHA256(MEDIA_SIGNING_SECRET, `${songId}:${exp}`)` — the signature
 * is bound to one song and one expiry, so a token minted for track A cannot be
 * replayed for track B, and a leaked URL dies after `ttl` seconds. Only this
 * signature grants access to the audio bytes; the `media/` directory is never
 * served statically.
 */
export interface StreamToken {
  songId: string;
  exp: number;
  sig: string;
}

const digest = (secret: string, songId: string, exp: number): string =>
  createHmac('sha256', secret).update(`${songId}:${exp}`).digest('hex');

export function signStreamToken(
  secret: string,
  songId: string,
  ttlSeconds: number,
  now = Date.now(),
): StreamToken {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  return { songId, exp, sig: digest(secret, songId, exp) };
}

export function buildStreamPath(token: StreamToken): string {
  const params = new URLSearchParams({ exp: String(token.exp), sig: token.sig });
  return `/api/media/stream/${token.songId}?${params.toString()}`;
}

export function verifyStreamToken(
  secret: string,
  songId: string,
  exp: number,
  sig: string,
  now = Date.now(),
): void {
  if (!Number.isFinite(exp) || exp <= 0) throw new AppError('INVALID_SIGNATURE', 'Stream token expiry is malformed');
  const expected = digest(secret, songId, exp);
  const providedBuffer = Buffer.from(sig);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new AppError('INVALID_SIGNATURE', 'Stream token signature is not valid for this track');
  }
  if (exp * 1000 <= now) throw new AppError('EXPIRED_SIGNATURE', 'Stream token has expired');
}
