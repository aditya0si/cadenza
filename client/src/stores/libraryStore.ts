import { create } from 'zustand';
import { api } from '../lib/api';
import type { PlaylistDto, SongDto } from '../types';

interface LibraryState {
  playlists: PlaylistDto[];
  current: PlaylistDto | null;
  loading: boolean;
  error: string | null;
  loadMine: () => Promise<void>;
  loadPublic: () => Promise<void>;
  loadOne: (id: string) => Promise<void>;
  create: (input: { name: string; description?: string; visibility?: 'private' | 'public' }) => Promise<PlaylistDto>;
  addTrack: (playlistId: string, song: SongDto) => Promise<void>;
  removeTrack: (playlistId: string, songId: string) => Promise<void>;
  /** Drag-to-reorder: sends the full order, exactly as the API expects. */
  reorder: (playlistId: string, songIds: string[]) => Promise<void>;
  deletePlaylist: (playlistId: string) => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  playlists: [],
  current: null,
  loading: false,
  error: null,

  async loadMine() {
    set({ loading: true, error: null });
    try {
      const page = await api.playlists({ scope: 'mine', limit: 50 });
      set({ playlists: page.items, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not load your playlists', loading: false });
    }
  },

  async loadPublic() {
    set({ loading: true, error: null });
    try {
      const page = await api.playlists({ scope: 'public', limit: 50 });
      set({ playlists: page.items, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not load public playlists', loading: false });
    }
  },

  async loadOne(id) {
    set({ loading: true, error: null });
    try {
      const response = await api.playlist(id);
      set({ current: response.playlist, loading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not load this playlist', loading: false, current: null });
    }
  },

  async create(input) {
    const response = await api.createPlaylist(input);
    set({ playlists: [response.playlist, ...get().playlists] });
    return response.playlist;
  },

  async addTrack(playlistId, song) {
    const response = await api.addPlaylistSong(playlistId, song.id);
    set({
      current: get().current?.id === playlistId ? response.playlist : get().current,
      playlists: get().playlists.map((playlist) => (playlist.id === playlistId ? response.playlist : playlist)),
    });
  },

  async removeTrack(playlistId, songId) {
    const response = await api.removePlaylistSong(playlistId, songId);
    set({
      current: get().current?.id === playlistId ? response.playlist : get().current,
      playlists: get().playlists.map((playlist) => (playlist.id === playlistId ? response.playlist : playlist)),
    });
  },

  async reorder(playlistId, songIds) {
    // Optimistic: reorder locally first so the drag feels instant, then confirm
    // against the server response.
    const previous = get().current;
    if (previous && previous.id === playlistId) {
      const byId = new Map(previous.songs.map((song) => [song.id, song]));
      const optimistic = songIds.map((id) => byId.get(id)).filter((song): song is SongDto => song !== undefined);
      set({ current: { ...previous, songs: optimistic } });
    }
    try {
      const response = await api.reorderPlaylist(playlistId, songIds);
      set({
        current: get().current?.id === playlistId ? response.playlist : get().current,
        playlists: get().playlists.map((playlist) => (playlist.id === playlistId ? response.playlist : playlist)),
      });
    } catch (error) {
      set({ current: previous, error: error instanceof Error ? error.message : 'Could not reorder this playlist' });
    }
  },

  async deletePlaylist(playlistId) {
    await api.deletePlaylist(playlistId);
    set({
      playlists: get().playlists.filter((playlist) => playlist.id !== playlistId),
      current: get().current?.id === playlistId ? null : get().current,
    });
  },
}));
