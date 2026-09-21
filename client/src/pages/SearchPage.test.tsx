import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SearchPage } from './SearchPage';
import { song } from '../test/fixtures';
import type { SearchResults } from '../types';

vi.mock('../lib/api', () => ({ api: { search: vi.fn() } }));

const { api } = await import('../lib/api');

const results = (query: string): SearchResults => ({
  query,
  artists: [
    {
      id: 'artist-1',
      name: 'Harbour Static',
      slug: 'harbour-static',
      bio: 'Port-city duo.',
      imageUrl: '/api/media/cover/artist/artist-1',
      genres: ['lo-fi'],
      monthlyListeners: 12,
      origin: null,
    },
  ],
  albums: [
    {
      id: 'album-1',
      title: 'Low Tide Signals',
      slug: 'low-tide-signals',
      releaseYear: 2026,
      coverUrl: '/api/media/cover/album/album-1',
      songCount: 2,
      description: null,
      artist: { id: 'artist-1', name: 'Harbour Static' },
    },
  ],
  songs: [song('a', { title: 'Neon Rain' })],
});

beforeEach(() => {
  vi.clearAllMocks();
});

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <SearchPage />
    </MemoryRouter>,
  );
};

describe('SearchPage', () => {
  it('asks for at least two characters before searching', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByText('Start typing')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Search the catalogue'), 'n');
    expect(api.search).not.toHaveBeenCalled();
    expect(screen.getByText('Start typing')).toBeInTheDocument();
  });

  it('debounces the query and renders grouped results', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockResolvedValueOnce(results('neon'));
    renderPage();
    await user.type(screen.getByLabelText('Search the catalogue'), 'neon');

    await waitFor(() => expect(api.search).toHaveBeenCalledWith('neon'));
    expect(await screen.findByText('Neon Rain')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Songs' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Albums' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Artists' })).toBeInTheDocument();
    // Appears on the album card and the artist card (the fixture song belongs to another artist).
    expect(screen.getAllByText('Harbour Static')).toHaveLength(2);
  });

  it('coalesces fast typing into a single request', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockResolvedValue(results('orbit'));
    renderPage();
    await user.type(screen.getByLabelText('Search the catalogue'), 'orbit', { delay: 10 });
    await waitFor(() => expect(api.search).toHaveBeenCalled());
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(api.search).toHaveBeenCalledWith('orbit');
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockResolvedValueOnce({ query: 'zzz', artists: [], albums: [], songs: [] });
    renderPage();
    await user.type(screen.getByLabelText('Search the catalogue'), 'zzz');
    expect(await screen.findByText('No matches')).toBeInTheDocument();
    expect(screen.getByText(/Nothing in the catalogue matches/)).toBeInTheDocument();
  });

  it('surfaces a search failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockRejectedValueOnce(new Error('Search is temporarily unavailable'));
    renderPage();
    await user.type(screen.getByLabelText('Search the catalogue'), 'neon');
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is temporarily unavailable');
  });

  it('runs a suggestion when one of the chips is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockResolvedValue(results('ambient'));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'ambient' }));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('ambient'));
    expect(screen.getByLabelText('Search the catalogue')).toHaveValue('ambient');
  });
});
