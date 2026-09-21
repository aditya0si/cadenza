/**
 * Bounded, insertion-ordered dedupe set per room.
 *
 * Used for the playback events that are not persisted with an idempotency key:
 * a client that retries `playback:seek` after a flaky reconnect must not move
 * everyone twice. Queue and chat mutations are deduped in Mongo instead (see
 * `roomRepository.claimEvent` and the unique index on messages), which survives
 * a process restart; this set is the cheap in-memory tier.
 */
export class EventDeduplicator {
  private readonly seen = new Map<string, Set<string>>();

  constructor(private readonly maxPerRoom = 200) {}

  /** Returns true the first time an event id is seen for a room. */
  claim(roomId: string, eventId: string): boolean {
    let bucket = this.seen.get(roomId);
    if (!bucket) {
      bucket = new Set<string>();
      this.seen.set(roomId, bucket);
    }
    if (bucket.has(eventId)) return false;
    bucket.add(eventId);
    while (bucket.size > this.maxPerRoom) {
      const oldest = bucket.values().next();
      if (oldest.done === true) break;
      bucket.delete(oldest.value);
    }
    return true;
  }

  size(roomId: string): number {
    return this.seen.get(roomId)?.size ?? 0;
  }

  clear(roomId?: string): void {
    if (roomId === undefined) this.seen.clear();
    else this.seen.delete(roomId);
  }
}

/**
 * Per-key token bucket, used to keep one noisy socket from flooding a room.
 */
export class TokenBucket {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  /** Consumes one token; false means the caller is over its budget. */
  take(key: string, now = Date.now()): boolean {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    const tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }
}
