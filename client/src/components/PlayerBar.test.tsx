import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PlayerBar } from './PlayerBar';
import { usePlayerStore } from '../stores/playerStore';
import { useRoomStore } from '../stores/roomStore';
import { emptyRoomState } from '../room/roomSync';
import { songList } from '../test/fixtures';

vi.mock('../lib/api', () => ({
  api: {
    streamUrl: vi.fn(async (songId: string) => ({
      songId,
      url: `/api/media/stream/${songId}?exp=1&sig=abc`,
      expiresAt: new Date().toISOString(),
      ttlSeconds: 300,
      durationMs: 22_000,
    })),
    recordPlay: vi.fn(async () => ({ playCount: 1, totalPlays: 1 })),
  },
}));

const playerInitial = usePlayerStore.getState();
const roomInitial = useRoomStore.getState();

beforeEach(() => {
  usePlayerStore.setState({ ...playerInitial, queue: { tracks: [], index: 0 }, isPlaying: false, mode: 'solo', roomId: null, streamUrl: null }, true);
  useRoomStore.setState({ ...roomInitial, ...emptyRoomState }, true);
});

const renderPlayer = (): void => {
  render(
    <MemoryRouter>
      <PlayerBar />
    </MemoryRouter>,
  );
};

/**
 * jsdom always reports `paused === true` because it does not implement playback,
 * so tests that exercise the transport pin the element's state explicitly.
 */
const setPaused = (audio: HTMLAudioElement, paused: boolean): void => {
  Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
};

describe('PlayerBar', () => {
  it('renders nothing until something is queued', () => {
    renderPlayer();
    expect(screen.queryByTestId('audio-element')).not.toBeInTheDocument();
  });

  it('shows the current track, its artist and a signed stream source', async () => {
    await usePlayerStore.getState().play(songList('a', 'b'), 0);
    renderPlayer();
    expect(await screen.findByText('Track a')).toBeInTheDocument();
    expect(screen.getByText('Kite Ensemble')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('audio-element')).toHaveAttribute('src', expect.stringContaining('/api/media/stream/a'));
    });
  });

  it('plays and pauses the audio element from the transport button', async () => {
    const user = userEvent.setup();
    await usePlayerStore.getState().play(songList('a'), 0);
    renderPlayer();
    const audio = screen.getByTestId('audio-element') as HTMLAudioElement;
    const playSpy = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    const pauseSpy = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);

    setPaused(audio, false);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    setPaused(audio, true);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('toggles playback with the space bar but ignores keystrokes while typing', async () => {
    const user = userEvent.setup();
    await usePlayerStore.getState().play(songList('a'), 0);
    renderPlayer();
    const audio = screen.getByTestId('audio-element') as HTMLAudioElement;
    vi.spyOn(audio, 'pause').mockImplementation(() => undefined);

    setPaused(audio, false);
    await user.keyboard(' ');
    expect(usePlayerStore.getState().isPlaying).toBe(false);

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    await user.keyboard(' ');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    input.remove();
  });

  it('exposes a labelled volume control that clamps at the edges', async () => {
    const user = userEvent.setup();
    await usePlayerStore.getState().play(songList('a'), 0);
    renderPlayer();
    const volume = screen.getByRole('slider', { name: 'Volume' });
    expect(volume).toBeInTheDocument();
    volume.focus();
    for (let step = 0; step < 12; step += 1) await user.keyboard('{ArrowUp}');
    expect(usePlayerStore.getState().volume).toBe(1);
    for (let step = 0; step < 30; step += 1) await user.keyboard('{ArrowDown}');
    expect(usePlayerStore.getState().volume).toBe(0);
  });

  it('drives the server instead of the local element while in a room', async () => {
    const user = userEvent.setup();
    const control = vi.fn(async () => undefined);
    usePlayerStore.setState({
      queue: { tracks: songList('a'), index: 0 },
      mode: 'room',
      roomId: 'room-1',
      isPlaying: true,
    });
    useRoomStore.setState({
      ...emptyRoomState,
      roomId: 'room-1',
      queue: songList('a'),
      playback: {
        trackId: 'a',
        isPlaying: true,
        positionMs: 5_000,
        serverTs: Date.now() - 1_000,
        updatedBy: 'user-2',
      },
      control,
    });

    renderPlayer();
    expect(await screen.findByText(/listening room/)).toBeInTheDocument();
    expect(screen.getByTestId('room-sync-status')).toHaveTextContent('in sync');

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(control).toHaveBeenCalledWith('pause', expect.any(Number)));
  });

  it('reports how many times the server had to resync this client', async () => {
    usePlayerStore.setState({ queue: { tracks: songList('a'), index: 0 }, mode: 'room', roomId: 'room-1' });
    useRoomStore.setState({
      ...emptyRoomState,
      roomId: 'room-1',
      queue: songList('a'),
      playback: { trackId: 'a', isPlaying: false, positionMs: 0, serverTs: Date.now(), updatedBy: null },
      snapCount: 2,
      driftMs: -1_400,
    });
    renderPlayer();
    expect(await screen.findByTestId('room-sync-status')).toHaveTextContent('resynced 2×');
    expect(screen.getByTestId('room-sync-status')).toHaveTextContent('drift -1400 ms');
  });
});
