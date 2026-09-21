import type { Request, Response } from 'express';
import { AppError } from '../../errors.js';
import type { AppContext } from '../../context.js';
import { sendMediaFile } from '../../media/stream.js';
import { verifyStreamToken } from '../../media/signing.js';
import { query } from '../middleware/validate.js';
import type { CoverParams, StreamQuery } from '../schemas.js';

export const createMediaController = (ctx: AppContext) => ({
  /**
   * Mints a signed, short-lived URL for one track. Requires a session: anonymous
   * callers never receive a stream token, so the library is not a public dump.
   */
  async issueStreamUrl(req: Request, res: Response): Promise<void> {
    const user = req.auth?.user;
    if (!user) throw AppError.unauthenticated();
    const songId = req.params.id ?? '';
    const issued = await ctx.services.media.issueStreamUrl(songId);
    ctx.logger.info({ requestId: req.id, userId: user.id, songId }, 'stream url issued');
    res.json(issued);
  },

  /**
   * Streams the audio bytes. The URL is the credential here (HMAC over
   * `songId:exp`), which is what makes seeking via Range requests possible from
   * an `<audio>` element without an Authorization header.
   */
  async stream(req: Request, res: Response): Promise<void> {
    const songId = req.params.id ?? '';
    const { exp, sig } = query<StreamQuery>(req);
    verifyStreamToken(ctx.env.MEDIA_SIGNING_SECRET, songId, exp, sig);
    const file = await ctx.services.media.audioForSong(songId);
    sendMediaFile(req, res, file);
  },

  async cover(req: Request, res: Response): Promise<void> {
    const { kind, id } = req.params as unknown as CoverParams;
    const file = await ctx.services.media.coverFor(kind, id);
    sendMediaFile(req, res, file);
  },
});
