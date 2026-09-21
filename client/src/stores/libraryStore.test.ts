import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from './libraryStore';
import { song } from '../test/fixtures';
import type { PlaylistDto } from '../types';

vi.mock('../lib/api', () => ({
  api: {
    playlists: vi.fn(),
    playlist: vi.fn(),
    createPlaylist: vi.fn(),
    addPlaylistSong: vi.fn(),
    removePlaylistSong: vi.fn(),
    reorderPlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
  },
}));

const { api } = await import('../lib/api');

const playlist = (overrides: Partial<PlaylistDto> = {}): PlaylistDto => ({
  id: 'p1',
  name: 'Late Shift Focus',
  description: '',
  visibility: 'private',
  ownerId: 'u1',
  trackCount: 2,
  durationMs: 44_000,
  songs: [song('a'), song('b')],
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const initialState = useLibraryStore.getState();

beforeEach(() => {
  useLibraryStore.setState({ ...initialState, playlists: [], current: null }, true);
  vi.clearAllMocks();
});

describe('library store', () => {
  it('loads the listener playlists', async () => {
    vi.mocked(api.playlists).mockResolvedValueOnce({ items: [playlist()], page: 1, limit: 50, total: 1, totalPages: 1, hasMore: false });
    await useLibraryStore.getState().loadMine();
    expect(api.playlists).toHaveBeenCalledWith({ scope: 'mine', limit: 50 });
    expect(useLibraryStore.getState().playlists).toHaveLength(1);
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('records an error when loading fails', async () => {
    vi.mocked(api.playlists).mockRejectedValueOnce(new Error('Sign in to continue'));
    await useLibraryStore.getState().loadMine();
    expect(useLibraryStore.getState().error).toBe('Sign in to continue');
    expect(useLibraryStore.getState().loading).toBe(false);
  });

  it('prepends a newly created playlist', async () => {
    vi.mocked(api.createPlaylist).mockResolvedValueOnce({ playlist: playlist({ id: 'new', name: 'Fresh' }) });
    const created = await useLibraryStore.getState().create({ name: 'Fresh' });
    expect(created.id).toBe('new');
    expect(useLibraryStore.getState().playlists[0]?.name).toBe('Fresh');
  });

  it('adds and removes tracks against the server response', async () => {
    useLibraryStore.setState({ current: playlist() });
    vi.mocked(api.addPlaylistSong).mockResolvedValueOnce({ playlist: playlist({ trackCount: 3 }) });
    await useLibraryStore.getState().addTrack('p1', song('c'));
    expect(useLibraryStore.getState().current?.trackCount).toBe(3);

    vi.mocked(api.removePlaylistSong).mockResolvedValueOnce({ playlist: playlist({ trackCount: 1 }) });
    await useLibraryStore.getState().removeTrack('p1', 'a');
    expect(useLibraryStore.getState().current?.trackCount).toBe(1);
  });

  it('applies the new order optimistically and confirms it', async () => {
    useLibraryStore.setState({ current: playlist() });
    vi.mocked(api.reorderPlaylist).mockResolvedValueOnce({ playlist: playlist({ songs: [song('b'), song('a')] }) });
    await useLibraryStore.getState().reorder('p1', ['b', 'a']);
    expect(api.reorderPlaylist).toHaveBeenCalledWith('p1', ['b', 'a']);
    expect(useLibraryStore.getState().current?.songs.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('rolls the order back when the server rejects it', async () => {
    useLibraryStore.setState({ current: playlist() });
    vi.mocked(api.reorderPlaylist).mockRejectedValueOnce(new Error('Reorder payload must contain every track exactly once'));
    await useLibraryStore.getState().reorder('p1', ['a']);
    expect(useLibraryStore.getState().current?.songs.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(useLibraryStore.getState().error).toMatch(/every track/);
  });

  it('drops a deleted playlist from state', async () => {
    useLibraryStore.setState({ playlists: [playlist()], current: playlist() });
    vi.mocked(api.deletePlaylist).mockResolvedValueOnce(undefined);
    await useLibraryStore.getState().deletePlaylist('p1');
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
    expect(useLibraryStore.getState().current).toBeNull();
  });
});
