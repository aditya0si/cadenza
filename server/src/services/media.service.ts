import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Env } from '../config/env.js';
import { AppError } from '../errors.js';
import { assertSafeMediaKey } from '../media/range.js';
import { buildStreamPath, signStreamToken } from '../media/signing.js';
import { albumRepository } from '../repositories/album.repository.js';
import { artistRepository } from '../repositories/artist.repository.js';
import { songRepository } from '../repositories/song.repository.js';
import type { MediaFileSlice } from '../media/stream.js';

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

export interface IssuedStreamUrl {
  songId: string;
  /** Relative path — the client prefixes it with VITE_API_URL's origin. */
  url: string;
  expiresAt: string;
  ttlSeconds: number;
  durationMs: number;
}

export class MediaService {
  constructor(private readonly env: Env) {}

  private async resolveKey(key: string): Promise<MediaFileSlice> {
    assertSafeMediaKey(key);
    const absolute = path.join(this.env.mediaDir, key);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) throw new Error('not a file');
      return {
        path: absolute,
        size: info.size,
        contentType: CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream',
      };
    } catch {
      throw AppError.notFound('Media file is missing from the library');
    }
  }

  /** Mints a short-lived, single-purpose URL for one track. */
  async issueStreamUrl(songId: string): Promise<IssuedStreamUrl> {
    const song = await songRepository.findById(songId);
    if (!song) throw AppError.notFound('Song not found');
    // Fail fast (and loudly) if the referenced file is not actually on disk.
    await this.resolveKey(song.audioKey);

    const token = signStreamToken(this.env.MEDIA_SIGNING_SECRET, songId, this.env.MEDIA_URL_TTL_SECONDS);
    return {
      songId,
      url: buildStreamPath(token),
      expiresAt: new Date(token.exp * 1000).toISOString(),
      ttlSeconds: this.env.MEDIA_URL_TTL_SECONDS,
      durationMs: song.durationMs,
    };
  }

  async audioForSong(songId: string): Promise<MediaFileSlice> {
    const song = await songRepository.findById(songId);
    if (!song) throw AppError.notFound('Song not found');
    return this.resolveKey(song.audioKey);
  }

  /** Cover art is public (it is not licensed audio) and served without a signature. */
  async coverFor(kind: 'song' | 'album' | 'artist', id: string): Promise<MediaFileSlice> {
    if (kind === 'song') {
      const song = await songRepository.findById(id);
      if (!song) throw AppError.notFound('Song not found');
      return this.resolveKey(song.coverKey);
    }
    if (kind === 'album') {
      const album = await albumRepository.findById(id);
      if (!album) throw AppError.notFound('Album not found');
      return this.resolveKey(album.coverKey);
    }
    const artist = await artistRepository.findById(id);
    if (!artist) throw AppError.notFound('Artist not found');
    return this.resolveKey(artist.imageKey);
  }
}
