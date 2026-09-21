import type { SongDto } from '../types';

export const song = (id: string, overrides: Partial<SongDto> = {}): SongDto => ({
  id,
  title: `Track ${id}`,
  slug: `track-${id}`,
  durationMs: 22_000,
  waveformPeaks: [0.2, 0.4, 0.9, 0.5, 0.3],
  coverUrl: `/api/media/cover/song/${id}`,
  bpm: 104,
  musicalKey: 'A minor',
  genres: ['synthwave'],
  playCount: 0,
  trackNumber: 1,
  artist: { id: 'artist-1', name: 'Kite Ensemble' },
  album: { id: 'album-1', title: 'Night Voltage' },
  ...overrides,
});

export const songList = (...ids: string[]): SongDto[] => ids.map((id) => song(id));
