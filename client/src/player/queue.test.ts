import { describe, expect, it } from 'vitest';
import {
  advance,
  createQueue,
  currentTrack,
  emptyQueue,
  enqueueTracks,
  jumpTo,
  playNext,
  removeTrack,
  replaceUpcoming,
} from './queue';
import { songList } from '../test/fixtures';

describe('queue construction', () => {
  it('starts empty and stays empty for an empty track list', () => {
    expect(currentTrack(emptyQueue)).toBeNull();
    expect(createQueue([])).toEqual(emptyQueue);
  });

  it('clamps the start index into range', () => {
    expect(createQueue(songList('a', 'b'), 5).index).toBe(1);
    expect(createQueue(songList('a', 'b'), -3).index).toBe(0);
  });
});

describe('enqueueing', () => {
  it('appends without disturbing the current track', () => {
    const queue = createQueue(songList('a', 'b'), 1);
    const next = enqueueTracks(queue, songList('c'));
    expect(next.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
    expect(currentTrack(next)?.id).toBe('b');
  });

  it('ignores tracks that are already queued', () => {
    const queue = createQueue(songList('a', 'b'), 0);
    const next = enqueueTracks(queue, songList('b', 'c', 'c'));
    expect(next.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
  });

  it('seeds the queue when it was empty', () => {
    const next = enqueueTracks(emptyQueue, songList('a', 'b'));
    expect(currentTrack(next)?.id).toBe('a');
  });

  it('inserts a track right after the current one', () => {
    const queue = createQueue(songList('a', 'b', 'c'), 0);
    const next = playNext(queue, songList('x')[0]!);
    expect(next.tracks.map((track) => track.id)).toEqual(['a', 'x', 'b', 'c']);
    expect(currentTrack(next)?.id).toBe('a');
  });
});

describe('moving through the queue', () => {
  it('advances and wraps around by default', () => {
    const queue = createQueue(songList('a', 'b', 'c'), 2);
    expect(currentTrack(advance(queue, 1))?.id).toBe('a');
    expect(currentTrack(advance(queue, -1))?.id).toBe('b');
  });

  it('stops at the end when looping is off', () => {
    const queue = createQueue(songList('a', 'b'), 1);
    expect(advance(queue, 1, false).index).toBe(1);
    expect(advance(queue, -1, false).index).toBe(0);
  });

  it('is a no-op for an empty queue', () => {
    expect(advance(emptyQueue, 1)).toEqual(emptyQueue);
  });

  it('jumps to a track by id, or leaves the queue alone when it is absent', () => {
    const queue = createQueue(songList('a', 'b', 'c'), 0);
    expect(currentTrack(jumpTo(queue, 'c'))?.id).toBe('c');
    expect(jumpTo(queue, 'missing')).toEqual(queue);
  });
});

describe('removing tracks', () => {
  it('keeps the cursor on the same track when an earlier one is removed', () => {
    const queue = createQueue(songList('a', 'b', 'c'), 2);
    const next = removeTrack(queue, 'a');
    expect(next.tracks.map((track) => track.id)).toEqual(['b', 'c']);
    expect(currentTrack(next)?.id).toBe('c');
  });

  it('clamps the cursor when the last track is removed', () => {
    const queue = createQueue(songList('a', 'b'), 1);
    const next = removeTrack(queue, 'b');
    expect(currentTrack(next)?.id).toBe('a');
  });

  it('empties the queue when the final track goes', () => {
    const queue = createQueue(songList('a'), 0);
    expect(removeTrack(queue, 'a')).toEqual(emptyQueue);
  });

  it('ignores unknown ids', () => {
    const queue = createQueue(songList('a'), 0);
    expect(removeTrack(queue, 'zzz')).toEqual(queue);
  });
});

describe('replacing the upcoming tracks', () => {
  it('keeps the current track at the head', () => {
    const queue = createQueue(songList('a', 'b', 'c'), 1);
    const next = replaceUpcoming(queue, songList('b', 'd'));
    expect(next.tracks.map((track) => track.id)).toEqual(['b', 'd']);
    expect(currentTrack(next)?.id).toBe('b');
  });
});
