import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RoomPage } from './RoomPage';
import { emptyRoomState } from '../room/roomSync';
import { song, songList } from '../test/fixtures';
import type { MessageDto, RoomDto } from '../types';

type StoreState = Record<string, unknown>;

const harness = vi.hoisted(() => ({
  roomState: {} as StoreState,
  playerState: {} as StoreState,
  auth: { id: 'user-1', displayName: 'Host', roles: ['listener'] },
}));

vi.mock('../stores/roomStore', () => ({
  useRoomStore: <T,>(selector?: (state: StoreState) => T): T | StoreState =>
    selector ? selector(harness.roomState) : harness.roomState,
}));

vi.mock('../stores/playerStore', () => ({
  usePlayerStore: <T,>(selector?: (state: StoreState) => T): T | StoreState =>
    selector ? selector(harness.playerState) : harness.playerState,
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      id: harness.auth.id,
      email: `${harness.auth.id}@cadenza.test`,
      displayName: harness.auth.displayName,
      avatarUrl: null,
      roles: harness.auth.roles,
      createdAt: new Date().toISOString(),
    },
    isSignedIn: true,
    isLoaded: true,
    mode: 'demo',
    description: 'demo',
    signInWithDemo: vi.fn(),
    signOut: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({ api: { search: vi.fn() } }));

const { api } = await import('../lib/api');

const room: RoomDto = {
  id: 'room-1',
  name: 'Rooftop Session',
  slug: 'rooftop-session',
  hostId: 'user-1',
  visibility: 'public',
  members: [
    { userId: 'user-1', displayName: 'Host', avatarUrl: null, role: 'host', joinedAt: new Date().toISOString(), connected: true },
    { userId: 'user-2', displayName: 'Guest', avatarUrl: null, role: 'member', joinedAt: new Date().toISOString(), connected: true },
  ],
  queue: songList('a', 'b'),
  playback: { trackId: 'a', isPlaying: true, positionMs: 2_000, serverTs: new Date().toISOString(), updatedBy: 'user-1' },
  lastActivityAt: new Date().toISOString(),
};

const message = (id: string, body: string): MessageDto => ({
  id,
  roomId: 'room-1',
  body,
  createdAt: new Date().toISOString(),
  author: { id: 'user-2', displayName: 'Guest', avatarUrl: null },
});

const setupStore = (overrides: StoreState = {}): void => {
  harness.roomState = {
    ...emptyRoomState,
    roomId: 'room-1',
    room,
    queue: room.queue,
    messages: [message('m1', 'kicking off with Glass Harbor')],
    connectedUserIds: ['user-1', 'user-2'],
    playback: { trackId: 'a', isPlaying: true, positionMs: 2_000, serverTs: Date.now(), updatedBy: 'user-1' },
    status: 'joined',
    error: null,
    driftMs: -120,
    snapCount: 1,
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    loadSnapshot: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => undefined),
    addToQueue: vi.fn(async () => undefined),
    removeFromQueue: vi.fn(async () => undefined),
    control: vi.fn(async () => undefined),
    changeTrack: vi.fn(async () => undefined),
    reportPosition: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
  harness.playerState = { enterRoomMode: vi.fn(), exitRoomMode: vi.fn() };
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.auth = { id: 'user-1', displayName: 'Host', roles: ['listener'] };
  setupStore();
});

const renderPage = (): void => {
  render(
    <MemoryRouter initialEntries={['/rooms/room-1']}>
      <Routes>
        <Route path="/rooms/:roomId" element={<RoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
};

describe('RoomPage', () => {
  it('enters room mode, loads the snapshot and connects the socket on mount', () => {
    renderPage();
    expect(harness.playerState.enterRoomMode).toHaveBeenCalledWith('room-1');
    expect(harness.roomState.loadSnapshot).toHaveBeenCalledWith('room-1');
    expect(harness.roomState.connect).toHaveBeenCalledWith('room-1');
  });

  it('renders the room, its members and the authoritative sync status', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Rooftop Session' })).toBeInTheDocument();
    expect(screen.getByText('you are host')).toBeInTheDocument();
    expect(screen.getByText(/Connected — playback is driven by the server clock/)).toBeInTheDocument();
    expect(screen.getByText(/resynced 1×/)).toBeInTheDocument();
    expect(screen.getByText(/drift -120 ms/)).toBeInTheDocument();
    // Two members, both connected.
    expect(screen.getByTitle('Host (connected)')).toBeInTheDocument();
    expect(screen.getByTitle('Guest (connected)')).toBeInTheDocument();
  });

  it('lists the shared queue and the now-playing track', () => {
    renderPage();
    expect(screen.getByText('Now playing')).toBeInTheDocument();
    expect(screen.getAllByText('Track a').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Track b')).toBeInTheDocument();
  });

  it('sends a chat message and clears the draft', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText('Message');
    await user.type(input, 'sounds great');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(harness.roomState.sendMessage).toHaveBeenCalledWith('sounds great');
    expect(input).toHaveValue('');
  });

  it('refuses to send an empty message', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText('Message'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('routes play/pause and seek through the server-authoritative controls', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pause for everyone' }));
    expect(harness.roomState.control).toHaveBeenCalledWith('pause', expect.any(Number));
  });

  it('lets the host change the track but not a plain member', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter initialEntries={['/rooms/room-1']}>
        <Routes>
          <Route path="/rooms/:roomId" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Play Track b for everyone' }));
    expect(harness.roomState.changeTrack).toHaveBeenCalledWith('b');
    unmount();

    harness.auth = { id: 'user-2', displayName: 'Guest', roles: ['listener'] };
    renderPage();
    expect(screen.getByRole('button', { name: 'Play Track b for everyone' })).toBeDisabled();
  });

  it('searches the catalogue and queues a track into the room', async () => {
    const user = userEvent.setup();
    vi.mocked(api.search).mockResolvedValueOnce({
      query: 'neon',
      artists: [],
      albums: [],
      songs: [song('z', { title: 'Neon Rain' })],
    });
    renderPage();
    await user.type(screen.getByLabelText('Search tracks to queue'), 'neon');
    await waitFor(() => expect(api.search).toHaveBeenCalledWith('neon'));
    await user.click(await screen.findByRole('button', { name: /Queue/ }));
    expect(harness.roomState.addToQueue).toHaveBeenCalledWith('z');
  });

  it('removes a queued track and surfaces room errors', async () => {
    const user = userEvent.setup();
    setupStore({ error: 'Only the room host can change the track' });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('Only the room host can change the track');
    await user.click(screen.getByRole('button', { name: 'Remove Track b from the queue' }));
    expect(harness.roomState.removeFromQueue).toHaveBeenCalledWith('b');
  });

  it('leaves the room and exits room mode when unmounted', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/rooms/room-1']}>
        <Routes>
          <Route path="/rooms/:roomId" element={<RoomPage />} />
        </Routes>
      </MemoryRouter>,
    );
    unmount();
    expect(harness.roomState.disconnect).toHaveBeenCalled();
    expect(harness.playerState.exitRoomMode).toHaveBeenCalled();
  });
});
