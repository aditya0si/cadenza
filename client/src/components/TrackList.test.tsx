import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TrackList } from './TrackList';
import { songList } from '../test/fixtures';
import { usePlayerStore } from '../stores/playerStore';

vi.mock('../lib/api', () => ({
  api: {
    streamUrl: vi.fn(async (songId: string) => ({ songId, url: `/stream/${songId}`, expiresAt: '', ttlSeconds: 300, durationMs: 22_000 })),
    recordPlay: vi.fn(async () => ({ playCount: 1, totalPlays: 1 })),
  },
}));

const initialState = usePlayerStore.getState();

const renderList = (props: Partial<React.ComponentProps<typeof TrackList>> = {}): void => {
  render(
    <MemoryRouter>
      <TrackList songs={songList('a', 'b', 'c')} {...props} />
    </MemoryRouter>,
  );
};

beforeEach(() => {
  usePlayerStore.setState({ ...initialState, queue: { tracks: [], index: 0 }, isPlaying: false }, true);
});

describe('TrackList', () => {
  it('renders one row per track with artist, album and duration', () => {
    renderList();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Track a')).toBeInTheDocument();
    expect(screen.getAllByText(/Kite Ensemble/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0:22')).toHaveLength(3);
  });

  it('shows the empty message instead of rows when there is nothing to play', () => {
    render(
      <MemoryRouter>
        <TrackList songs={[]} emptyMessage="This playlist is empty" />
      </MemoryRouter>,
    );
    expect(screen.getByText('This playlist is empty')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('starts playback at the clicked row', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Play Track b' }));
    const state = usePlayerStore.getState();
    expect(state.queue.tracks.map((track) => track.id)).toEqual(['a', 'b', 'c']);
    expect(state.queue.index).toBe(1);
    expect(state.isPlaying).toBe(true);
  });

  it('offers a queue action when a handler is provided', async () => {
    const user = userEvent.setup();
    const onQueue = vi.fn();
    renderList({ onQueue });
    await user.click(screen.getByRole('button', { name: 'Queue Track c' }));
    expect(onQueue).toHaveBeenCalledTimes(1);
    expect(onQueue.mock.calls[0]?.[0].id).toBe('c');
  });

  it('reorders with the accessible arrow buttons and emits the full order', async () => {
    const user = userEvent.setup();
    const onReorder = vi.fn();
    renderList({ reorderable: true, onReorder });
    await user.click(screen.getByRole('button', { name: 'Move Track a down' }));
    expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    onReorder.mockClear();
    await user.click(screen.getByRole('button', { name: 'Move Track c up' }));
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('disables the arrow buttons at the ends of the list', () => {
    renderList({ reorderable: true, onReorder: vi.fn() });
    expect(screen.getByRole('button', { name: 'Move Track a up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Track c down' })).toBeDisabled();
  });

  it('renders a remove action only when a handler is given', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <TrackList songs={songList('a')} onRemove={onRemove} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove Track a' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    unmount();

    render(
      <MemoryRouter>
        <TrackList songs={songList('a')} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Remove Track a' })).not.toBeInTheDocument();
  });
});
