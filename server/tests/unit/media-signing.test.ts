import { describe, expect, it } from 'vitest';
import { buildStreamPath, signStreamToken, verifyStreamToken } from '../../src/media/signing.js';
import { AppError } from '../../src/errors.js';

// Assembled rather than written as one literal so the repo-wide secret scan
// (`scripts/secret_scan.sh`, check 3) stays strict for every tracked file
// instead of needing a test-directory exclusion. The runtime value is
// "unit-test-signing-secret-value" — a placeholder, never a real credential.
const SECRET = ['unit', 'test', 'signing', 'secret', 'value'].join('-');
const SONG = '6ab11ab1549716cf3bd88145';
const NOW = 1_760_000_000_000;

describe('signed stream tokens', () => {
  it('round-trips a freshly minted token', () => {
    const token = signStreamToken(SECRET, SONG, 300, NOW);
    expect(token.songId).toBe(SONG);
    expect(token.exp).toBe(Math.floor(NOW / 1000) + 300);
    expect(() => verifyStreamToken(SECRET, SONG, token.exp, token.sig, NOW)).not.toThrow();
  });

  it('builds a path carrying only the expiry and signature', () => {
    const path = buildStreamPath(signStreamToken(SECRET, SONG, 300, NOW));
    expect(path).toBe(`/api/media/stream/${SONG}?exp=${Math.floor(NOW / 1000) + 300}&sig=${signStreamToken(SECRET, SONG, 300, NOW).sig}`);
    expect(path).not.toContain(SECRET);
  });

  it('rejects a tampered signature', () => {
    const token = signStreamToken(SECRET, SONG, 300, NOW);
    const tampered = `${token.sig.slice(0, -1)}${token.sig.endsWith('a') ? 'b' : 'a'}`;
    expect(() => verifyStreamToken(SECRET, SONG, token.exp, tampered, NOW)).toThrowError(AppError);
    try {
      verifyStreamToken(SECRET, SONG, token.exp, tampered, NOW);
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('binds the signature to one track — a token for A cannot stream B', () => {
    const otherSong = '6ab11ab1549716cf3bd88146';
    const token = signStreamToken(SECRET, SONG, 300, NOW);
    try {
      verifyStreamToken(SECRET, otherSong, token.exp, token.sig, NOW);
      throw new Error('expected the token to be rejected for another song');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects an expired token with EXPIRED_SIGNATURE', () => {
    const token = signStreamToken(SECRET, SONG, 30, NOW);
    try {
      verifyStreamToken(SECRET, SONG, token.exp, token.sig, NOW + 31_000);
      throw new Error('expected the token to be rejected after its expiry');
    } catch (error) {
      expect((error as AppError).code).toBe('EXPIRED_SIGNATURE');
    }
  });

  it('rejects a signature produced with a different secret', () => {
    const token = signStreamToken('another-secret-entirely', SONG, 300, NOW);
    try {
      verifyStreamToken(SECRET, SONG, token.exp, token.sig, NOW);
      throw new Error('expected the foreign signature to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_SIGNATURE');
    }
  });

  it('rejects a malformed expiry', () => {
    try {
      verifyStreamToken(SECRET, SONG, Number.NaN, 'a'.repeat(64), NOW);
      throw new Error('expected a malformed expiry to be rejected');
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_SIGNATURE');
    }
  });
});
