import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from './playerStore';
import { songList } from '../test/fixtures';

vi.mock('../lib/api', () => ({
  api: {
    streamUrl: vi.fn(async (songId: string) => ({
      songId,
      url: `/api/media/stream/${songId}?exp=1&sig=deadbeef`,
      expiresAt: new Date().toISOString(),
      ttlSeconds: 300,
      durationMs: 22_000,
    })),
    recordPlay: vi.fn(async () => ({ playCount: 1, totalPlays: 1 })),
  },
}));

const { api } = await import('../lib/api');

const initialState = usePlayerStore.getState();

beforeEach(() => {
  usePlayerStore.setState({ ...initialState, queue: { tracks: [], index: 0 }, mode: 'solo', roomId: null }, true);
  vi.clearAllMocks();
});

describe('player store', () => {
  it('starts playing a list and fetches a signed stream URL', async () => {
    const tracks = songList('a', 'b', 'c');
    await usePlayerStore.getState().play(tracks, 1);
    const state = usePlayerStore.getState();
    expect(state.queue.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
    expect(state.queue.index).toBe(1);
    expect(state.isPlaying).toBe(true);
    expect(state.streamUrl).toContain('/api/media/stream/b');
    expect(api.recordPlay).toHaveBeenCalledWith('b', 'library', undefined);
  });

  it('reports the room as the play source when in room mode', async () => {
    usePlayerStore.getState().enterRoomMode('room-1');
    await usePlayerStore.getState().play(songList('a'), 0);
    expect(api.recordPlay).toHaveBeenCalledWith('a', 'room', 'room-1');
  });

  it('surfaces a stream failure and stops playback', async () => {
    vi.mocked(api.streamUrl).mockRejectedValueOnce(new Error('Stream token has expired'));
    await usePlayerStore.getState().play(songList('a'), 0);
    const state = usePlayerStore.getState();
    expect(state.isPlaying).toBe(false);
    expect(state.streamError).toBe('Stream token has expired');
  });

  it('appends to the queue and ignores duplicates', () => {
    usePlayerStore.getState().enqueue(songList('a', 'b'));
    usePlayerStore.getState().enqueue(songList('b', 'c'));
    expect(usePlayerStore.getState().queue.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
  });

  it('inserts next-up tracks directly after the current one', () => {
    usePlayerStore.getState().enqueue(songList('a', 'b'));
    usePlayerStore.getState().enqueueNext(songList('x')[0]!);
    expect(usePlayerStore.getState().queue.tracks.map((track) => track.id)).toEqual(['a', 'x', 'b']);
  });

  it('advances and wraps around the queue, fetching the new stream URL', async () => {
    await usePlayerStore.getState().play(songList('a', 'b'), 1);
    await usePlayerStore.getState().next();
    const state = usePlayerStore.getState();
    expect(state.queue.index).toBe(0);
    expect(state.streamUrl).toContain('/api/media/stream/a');
    expect(state.isPlaying).toBe(true);
  });

  it('steps backwards', async () => {
    await usePlayerStore.getState().play(songList('a', 'b'), 0);
    await usePlayerStore.getState().previous();
    expect(usePlayerStore.getState().queue.index).toBe(1);
  });

  it('toggles playback only when something is queued', () => {
    usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    usePlayerStore.getState().enqueue(songList('a'));
    usePlayerStore.getState().toggle();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('clamps the volume into [0, 1]', () => {
    usePlayerStore.getState().setVolume(1.7);
    expect(usePlayerStore.getState().volume).toBe(1);
    usePlayerStore.getState().setVolume(-0.4);
    expect(usePlayerStore.getState().volume).toBe(0);
    usePlayerStore.getState().setVolume(0.35);
    expect(usePlayerStore.getState().volume).toBeCloseTo(0.35);
  });

  it('removes a queued track and clears everything on request', () => {
    usePlayerStore.getState().enqueue(songList('a', 'b', 'c'));
    usePlayerStore.getState().remove('b');
    expect(usePlayerStore.getState().queue.tracks.map((track) => track.id)).toEqual(['a', 'c']);
    usePlayerStore.getState().clear();
    expect(usePlayerStore.getState().queue.tracks).toHaveLength(0);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().streamUrl).toBeNull();
  });

  it('leaves room mode when asked', () => {
    usePlayerStore.getState().enterRoomMode('room-9');
    expect(usePlayerStore.getState().mode).toBe('room');
    usePlayerStore.getState().exitRoomMode();
    expect(usePlayerStore.getState()).toMatchObject({ mode: 'solo', roomId: null });
  });
});
