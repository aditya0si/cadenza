import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { AppError } from '../errors.js';
import { contentRangeHeader, parseRangeHeader } from './range.js';

export interface MediaFileSlice {
  path: string;
  size: number;
  contentType: string;
}

/**
 * Streams a media file, honouring a single HTTP `Range` window so the player can
 * seek without downloading the whole track:
 *   - no Range      → 200 + full body
 *   - valid Range   → 206 + Content-Range + exactly the requested bytes
 *   - bogus Range   → 416 + `Content-Range: bytes * /<size>`
 */
export function sendMediaFile(req: Request, res: Response, file: MediaFileSlice): void {
  const range = parseRangeHeader(req.headers.range, file.size);
  if (range === 'unsatisfiable') {
    // Reject before any media headers are set so the error handler can still
    // answer with a JSON envelope.
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Range', `bytes */${file.size}`);
    throw new AppError('INVALID_RANGE', `Requested range cannot be satisfied for a ${file.size} byte file`);
  }

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', file.contentType);
  // Signed URLs are short-lived and per-user: never let a shared cache keep them.
  res.setHeader('Cache-Control', 'private, no-store');

  if (range === null) {
    res.setHeader('Content-Length', file.size);
    createReadStream(file.path).pipe(res);
    return;
  }

  res.status(206);
  res.setHeader('Content-Range', contentRangeHeader(range, file.size));
  res.setHeader('Content-Length', range.length);
  createReadStream(file.path, { start: range.start, end: range.end }).pipe(res);
}
