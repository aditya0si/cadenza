import { AppError } from '../errors.js';

export interface ByteRange {
  start: number;
  end: number;
  /** Number of bytes in the slice (`end - start + 1`). */
  length: number;
}

export type ParsedRange = ByteRange | null | 'unsatisfiable';

/**
 * Parses a single HTTP `Range` header (RFC 9110 §14.1.2).
 *
 * Returns `null` when no range was requested (caller sends the whole file),
 * `'unsatisfiable'` when the range cannot be honoured (caller sends 416), and
 * the resolved byte window otherwise (caller sends 206 + Content-Range).
 * Multi-range requests are treated as unsatisfiable on purpose: the player only
 * ever needs one window, and pretending to support multipart would be a lie.
 */
export function parseRangeHeader(header: string | undefined, size: number): ParsedRange {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bytes=')) return 'unsatisfiable';

  const spec = trimmed.slice('bytes='.length).trim();
  if (spec.includes(',')) return 'unsatisfiable';
  if (size <= 0) return 'unsatisfiable';

  const [rawStart, rawEnd] = spec.split('-');
  if (rawStart === undefined || rawEnd === undefined) return 'unsatisfiable';

  // suffix form: `bytes=-500` → last 500 bytes
  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return 'unsatisfiable';
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1, length: size - start };
  }

  const start = Number(rawStart);
  if (!Number.isInteger(start) || start < 0) return 'unsatisfiable';
  if (start >= size) return 'unsatisfiable';

  const end = rawEnd === '' ? size - 1 : Number(rawEnd);
  if (!Number.isInteger(end) || end < start) return 'unsatisfiable';

  const clampedEnd = Math.min(end, size - 1);
  return { start, end: clampedEnd, length: clampedEnd - start + 1 };
}

export function contentRangeHeader(range: ByteRange, size: number): string {
  return `bytes ${range.start}-${range.end}/${size}`;
}

/** Guards against path traversal when turning a stored media key into a path. */
export function assertSafeMediaKey(key: string): void {
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\') || /^[a-zA-Z]:/.test(key)) {
    throw AppError.forbidden('Media key escapes the media directory');
  }
}
