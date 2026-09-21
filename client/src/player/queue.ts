import type { SongDto } from '../types';

/** Pure playback-queue logic — no React, no store, fully unit-testable. */
export interface QueueState {
  tracks: SongDto[];
  index: number;
}

export const emptyQueue: QueueState = { tracks: [], index: 0 };

export const currentTrack = (state: QueueState): SongDto | null => state.tracks[state.index] ?? null;

export function createQueue(tracks: SongDto[], startIndex = 0): QueueState {
  if (tracks.length === 0) return emptyQueue;
  return { tracks: [...tracks], index: Math.max(0, Math.min(startIndex, tracks.length - 1)) };
}

/** Appends tracks, keeping the current one playing. */
export function enqueueTracks(state: QueueState, tracks: SongDto[]): QueueState {
  const seen = new Set(state.tracks.map((track) => track.id));
  const additions: SongDto[] = [];
  for (const track of tracks) {
    // Dedupe against the existing queue *and* within this batch.
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    additions.push(track);
  }
  if (state.tracks.length === 0) return createQueue(additions, 0);
  return { ...state, tracks: [...state.tracks, ...additions] };
}

export function playNext(state: QueueState, track: SongDto): QueueState {
  if (state.tracks.length === 0) return createQueue([track], 0);
  const tracks = [...state.tracks];
  tracks.splice(state.index + 1, 0, track);
  return { ...state, tracks };
}

/**
 * Moves the cursor. `loop` wraps around at the end of the queue; without it the
 * cursor sticks to the last track (the player then stops).
 */
export function advance(state: QueueState, direction: 1 | -1, loop = true): QueueState {
  if (state.tracks.length === 0) return state;
  const nextIndex = state.index + direction;
  if (nextIndex < 0) return loop ? { ...state, index: state.tracks.length - 1 } : { ...state, index: 0 };
  if (nextIndex >= state.tracks.length) return loop ? { ...state, index: 0 } : state;
  return { ...state, index: nextIndex };
}

export function jumpTo(state: QueueState, songId: string): QueueState {
  const index = state.tracks.findIndex((track) => track.id === songId);
  return index === -1 ? state : { ...state, index };
}

export function removeTrack(state: QueueState, songId: string): QueueState {
  const index = state.tracks.findIndex((track) => track.id === songId);
  if (index === -1) return state;
  const tracks = state.tracks.filter((track) => track.id !== songId);
  if (tracks.length === 0) return emptyQueue;
  // Removing something before the cursor shifts the cursor left by one.
  const nextIndex = index < state.index ? state.index - 1 : Math.min(state.index, tracks.length - 1);
  return { tracks, index: Math.max(0, nextIndex) };
}

export function replaceUpcoming(state: QueueState, tracks: SongDto[]): QueueState {
  const current = currentTrack(state);
  if (!current) return createQueue(tracks, 0);
  return createQueue([current, ...tracks.filter((track) => track.id !== current.id)], 0);
}
