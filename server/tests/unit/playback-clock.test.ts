import { describe, expect, it } from 'vitest';
import { clampPosition, projectPosition, shouldSnap, toPlaybackEvent } from '../../src/realtime/playback.js';

const NOW = 1_760_000_000_000;
const anchor = (overrides: Partial<Parameters<typeof projectPosition>[0]> = {}) => ({
  trackId: 'track-1',
  isPlaying: true,
  positionMs: 10_000,
  serverTs: NOW - 2_500,
  updatedBy: 'user-1',
  ...overrides,
});

describe('server-authoritative playback clock', () => {
  it('projects forward while playing', () => {
    expect(projectPosition(anchor(), NOW)).toBe(12_500);
  });

  it('freezes the position while paused', () => {
    expect(projectPosition(anchor({ isPlaying: false }), NOW)).toBe(10_000);
    expect(projectPosition(anchor({ isPlaying: false }), NOW + 60_000)).toBe(10_000);
  });

  it('never projects backwards when the anchor is in the future (clock skew)', () => {
    expect(projectPosition(anchor({ serverTs: NOW + 5_000 }), NOW)).toBe(10_000);
  });

  it('never projects a negative position: the stored base is clamped to zero', () => {
    expect(projectPosition(anchor({ positionMs: -500 }), NOW)).toBe(2_500);
    expect(projectPosition(anchor({ positionMs: -500, isPlaying: false }), NOW)).toBe(0);
  });

  it('emits a state event anchored at `now`', () => {
    const event = toPlaybackEvent(anchor(), NOW);
    expect(event).toEqual({
      trackId: 'track-1',
      isPlaying: true,
      positionMs: 12_500,
      serverTs: NOW,
      updatedBy: 'user-1',
    });
  });
});

describe('drift correction', () => {
  it('leaves clients inside the threshold alone', () => {
    expect(shouldSnap(10_200, 10_000, 750)).toBe(false);
    expect(shouldSnap(9_250, 10_000, 750)).toBe(false);
  });

  it('snaps clients that drifted past the threshold in either direction', () => {
    expect(shouldSnap(10_751, 10_000, 750)).toBe(true);
    expect(shouldSnap(9_249, 10_000, 750)).toBe(true);
    expect(shouldSnap(30_000, 10_000, 750)).toBe(true);
  });

  it('treats exactly-threshold drift as acceptable', () => {
    expect(shouldSnap(10_750, 10_000, 750)).toBe(false);
  });
});

describe('position clamping', () => {
  it('clamps into [0, duration]', () => {
    expect(clampPosition(-10, 22_000)).toBe(0);
    expect(clampPosition(22_500, 22_000)).toBe(22_000);
    expect(clampPosition(1_234.6, 22_000)).toBe(1_235);
    expect(clampPosition(Number.NaN, 22_000)).toBe(0);
  });
});
