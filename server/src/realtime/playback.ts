/**
 * Server-authoritative playback clock.
 *
 * The room document stores an anchor: `positionMs` measured at `serverTs`.
 * Clients receive the anchor and derive the live position locally
 * (`positionMs + (Date.now() - serverTs)` while playing) instead of trusting a
 * peer's clock. These functions are pure so both the socket layer and the unit
 * tests use exactly the same arithmetic.
 */
export interface PlaybackAnchor {
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  serverTs: Date | number;
  updatedBy: string | null;
}

export interface PlaybackStateEvent {
  trackId: string | null;
  isPlaying: boolean;
  positionMs: number;
  serverTs: number;
  updatedBy: string | null;
}

const toMillis = (value: Date | number): number => (value instanceof Date ? value.getTime() : value);

/** Where the track should be right now according to the server's anchor. */
export function projectPosition(anchor: PlaybackAnchor, now: number = Date.now()): number {
  const base = Math.max(0, anchor.positionMs);
  if (!anchor.isPlaying) return base;
  const elapsed = Math.max(0, now - toMillis(anchor.serverTs));
  return base + elapsed;
}

export function toPlaybackEvent(anchor: PlaybackAnchor, now: number = Date.now()): PlaybackStateEvent {
  return {
    trackId: anchor.trackId,
    isPlaying: anchor.isPlaying,
    positionMs: projectPosition(anchor, now),
    serverTs: now,
    updatedBy: anchor.updatedBy,
  };
}

/**
 * Drift correction: a client whose own clock says it is more than
 * `thresholdMs` away from the authoritative position gets snapped back.
 */
export function shouldSnap(clientPositionMs: number, authoritativePositionMs: number, thresholdMs: number): boolean {
  return Math.abs(clientPositionMs - authoritativePositionMs) > thresholdMs;
}

export function clampPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs)) return 0;
  return Math.max(0, Math.min(Math.round(positionMs), Math.max(0, durationMs)));
}
