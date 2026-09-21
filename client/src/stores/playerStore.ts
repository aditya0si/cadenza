import { create } from 'zustand';
import { api } from '../lib/api';
import type { SongDto } from '../types';
import {
  advance,
  createQueue,
  currentTrack,
  emptyQueue,
  enqueueTracks,
  jumpTo,
  playNext,
  removeTrack,
  type QueueState,
} from '../player/queue';

export type PlayerMode = 'solo' | 'room';

interface PlayerState {
  queue: QueueState;
  isPlaying: boolean;
  volume: number;
  mode: PlayerMode;
  roomId: string | null;
  /** Signed URL for the current track; refetched whenever the track changes. */
  streamUrl: string | null;
  streamError: string | null;
  play: (tracks: SongDto[], startIndex?: number) => Promise<void>;
  enqueue: (tracks: SongDto[]) => void;
  enqueueNext: (track: SongDto) => void;
  jump: (songId: string) => Promise<void>;
  remove: (songId: string) => void;
  toggle: () => void;
  setPlaying: (isPlaying: boolean) => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  setVolume: (volume: number) => void;
  enterRoomMode: (roomId: string) => void;
  exitRoomMode: () => void;
  clear: () => void;
}

const sourceFor = (mode: PlayerMode): string => (mode === 'room' ? 'room' : 'library');

/**
 * One audio element for the whole app (rendered by <PlayerBar/>); this store is
 * the single source of truth for what it should be doing. In `room` mode the
 * playback *commands* are owned by the server, so the store only reflects state.
 */
export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: emptyQueue,
  isPlaying: false,
  volume: 0.8,
  mode: 'solo',
  roomId: null,
  streamUrl: null,
  streamError: null,

  async play(tracks, startIndex = 0) {
    const queue = createQueue(tracks, startIndex);
    const track = currentTrack(queue);
    set({ queue, isPlaying: track !== null, streamError: null, streamUrl: null });
    if (!track) return;
    try {
      const issued = await api.streamUrl(track.id);
      set({ streamUrl: issued.url });
      await api.recordPlay(track.id, sourceFor(get().mode), get().roomId ?? undefined);
    } catch (error) {
      set({ streamError: error instanceof Error ? error.message : 'Could not load this track', isPlaying: false });
    }
  },

  enqueue(tracks) {
    set({ queue: enqueueTracks(get().queue, tracks) });
  },

  enqueueNext(track) {
    set({ queue: playNext(get().queue, track) });
  },

  async jump(songId) {
    const queue = jumpTo(get().queue, songId);
    const track = currentTrack(queue);
    set({ queue, isPlaying: track !== null, streamUrl: null });
    if (!track) return;
    try {
      const issued = await api.streamUrl(track.id);
      set({ streamUrl: issued.url });
      await api.recordPlay(track.id, sourceFor(get().mode), get().roomId ?? undefined);
    } catch (error) {
      set({ streamError: error instanceof Error ? error.message : 'Could not load this track', isPlaying: false });
    }
  },

  remove(songId) {
    set({ queue: removeTrack(get().queue, songId) });
  },

  toggle() {
    if (get().queue.tracks.length === 0) return;
    set({ isPlaying: !get().isPlaying });
  },

  setPlaying(isPlaying) {
    set({ isPlaying });
  },

  async next() {
    const queue = advance(get().queue, 1);
    const track = currentTrack(queue);
    set({ queue, streamUrl: null });
    if (!track) return;
    try {
      const issued = await api.streamUrl(track.id);
      set({ streamUrl: issued.url, isPlaying: true });
    } catch (error) {
      set({ streamError: error instanceof Error ? error.message : 'Could not load this track', isPlaying: false });
    }
  },

  async previous() {
    const queue = advance(get().queue, -1);
    const track = currentTrack(queue);
    set({ queue, streamUrl: null });
    if (!track) return;
    try {
      const issued = await api.streamUrl(track.id);
      set({ streamUrl: issued.url, isPlaying: true });
    } catch (error) {
      set({ streamError: error instanceof Error ? error.message : 'Could not load this track', isPlaying: false });
    }
  },

  setVolume(volume) {
    set({ volume: Math.max(0, Math.min(1, volume)) });
  },

  enterRoomMode(roomId) {
    set({ mode: 'room', roomId });
  },

  exitRoomMode() {
    set({ mode: 'solo', roomId: null });
  },

  clear() {
    set({ queue: emptyQueue, isPlaying: false, streamUrl: null, streamError: null });
  },
}));

export const selectCurrentTrack = (state: PlayerState): SongDto | null => currentTrack(state.queue);
