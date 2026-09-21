import { describe, expect, it } from 'vitest';
import { assertSafeMediaKey, contentRangeHeader, parseRangeHeader } from '../../src/media/range.js';
import { AppError } from '../../src/errors.js';

const SIZE = 1_000;

describe('HTTP Range parsing', () => {
  it('returns null when no range was requested', () => {
    expect(parseRangeHeader(undefined, SIZE)).toBeNull();
    expect(parseRangeHeader('', SIZE)).toBeNull();
  });

  it('parses a closed range', () => {
    expect(parseRangeHeader('bytes=0-99', SIZE)).toEqual({ start: 0, end: 99, length: 100 });
    expect(parseRangeHeader('bytes=100-199', SIZE)).toEqual({ start: 100, end: 199, length: 100 });
  });

  it('parses an open-ended range through to the last byte', () => {
    expect(parseRangeHeader('bytes=900-', SIZE)).toEqual({ start: 900, end: 999, length: 100 });
  });

  it('parses a suffix range (the last N bytes)', () => {
    expect(parseRangeHeader('bytes=-200', SIZE)).toEqual({ start: 800, end: 999, length: 200 });
    expect(parseRangeHeader('bytes=-5000', SIZE)).toEqual({ start: 0, end: 999, length: 1000 });
  });

  it('clamps an end past the file size', () => {
    expect(parseRangeHeader('bytes=990-100000', SIZE)).toEqual({ start: 990, end: 999, length: 10 });
  });

  it('marks unsatisfiable ranges instead of silently returning the whole file', () => {
    expect(parseRangeHeader('bytes=1000-', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=200-100', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=abc-def', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=-0', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('items=0-10', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=0-10,20-30', SIZE)).toBe('unsatisfiable');
    expect(parseRangeHeader('bytes=0-10', 0)).toBe('unsatisfiable');
  });

  it('renders a Content-Range header for a slice', () => {
    const range = parseRangeHeader('bytes=0-99', SIZE);
    if (range === null || range === 'unsatisfiable') throw new Error('expected a resolved range');
    expect(contentRangeHeader(range, SIZE)).toBe('bytes 0-99/1000');
  });
});

describe('media key traversal guard', () => {
  it('accepts keys inside the media directory', () => {
    expect(() => assertSafeMediaKey('tracks/neon-rain.mp3')).not.toThrow();
    expect(() => assertSafeMediaKey('covers/slow-orbit.svg')).not.toThrow();
  });

  it('rejects keys that escape it', () => {
    for (const key of ['../.env', 'tracks/../../secret.mp3', '/etc/passwd', 'C:/windows/system32/config/sam', '..\\..\\secret']) {
      expect(() => assertSafeMediaKey(key), `expected ${key} to be rejected`).toThrowError(AppError);
    }
  });
});
