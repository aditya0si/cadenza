import { describe, expect, it } from 'vitest';
import { EventDeduplicator, TokenBucket } from '../../src/realtime/dedupe.js';

describe('EventDeduplicator', () => {
  it('claims an event id exactly once', () => {
    const dedupe = new EventDeduplicator();
    expect(dedupe.claim('room-1', 'evt-a')).toBe(true);
    expect(dedupe.claim('room-1', 'evt-a')).toBe(false);
    expect(dedupe.claim('room-1', 'evt-b')).toBe(true);
    expect(dedupe.size('room-1')).toBe(2);
  });

  it('keeps rooms independent', () => {
    const dedupe = new EventDeduplicator();
    expect(dedupe.claim('room-1', 'evt-a')).toBe(true);
    expect(dedupe.claim('room-2', 'evt-a')).toBe(true);
    expect(dedupe.size('room-2')).toBe(1);
  });

  it('evicts the oldest ids once the per-room cap is reached', () => {
    const dedupe = new EventDeduplicator(3);
    for (const id of ['e1', 'e2', 'e3', 'e4']) expect(dedupe.claim('room-1', id)).toBe(true);
    expect(dedupe.size('room-1')).toBe(3);
    // e1 fell out of the ring buffer, so it can be claimed again.
    expect(dedupe.claim('room-1', 'e1')).toBe(true);
  });

  it('can be cleared per room or entirely', () => {
    const dedupe = new EventDeduplicator();
    dedupe.claim('room-1', 'evt-a');
    dedupe.claim('room-2', 'evt-b');
    dedupe.clear('room-1');
    expect(dedupe.size('room-1')).toBe(0);
    expect(dedupe.size('room-2')).toBe(1);
    dedupe.clear();
    expect(dedupe.size('room-2')).toBe(0);
  });
});

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refuses', () => {
    const bucket = new TokenBucket(3, 1);
    expect(bucket.take('socket-1', 1_000)).toBe(true);
    expect(bucket.take('socket-1', 1_000)).toBe(true);
    expect(bucket.take('socket-1', 1_000)).toBe(true);
    expect(bucket.take('socket-1', 1_000)).toBe(false);
  });

  it('refills over time', () => {
    const bucket = new TokenBucket(2, 1);
    expect(bucket.take('s', 0)).toBe(true);
    expect(bucket.take('s', 0)).toBe(true);
    expect(bucket.take('s', 0)).toBe(false);
    expect(bucket.take('s', 1_000)).toBe(true);
    expect(bucket.take('s', 1_000)).toBe(false);
    expect(bucket.take('s', 2_000)).toBe(true);
  });

  it('tracks keys independently and can be reset', () => {
    const bucket = new TokenBucket(1, 1);
    expect(bucket.take('a', 0)).toBe(true);
    expect(bucket.take('b', 0)).toBe(true);
    expect(bucket.take('a', 0)).toBe(false);
    bucket.reset('a');
    expect(bucket.take('a', 0)).toBe(true);
    bucket.reset();
    expect(bucket.take('b', 0)).toBe(true);
  });
});
