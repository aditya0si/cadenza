import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pause, Play, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatClockTime, formatDuration } from '../lib/format';
import { projectRoomPosition } from '../room/roomSync';
import { useRoomStore } from '../stores/roomStore';
import { usePlayerStore } from '../stores/playerStore';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/button';
import { Badge, EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { Input } from '../components/ui/input';
import { PresenceAvatar } from '../components/ui/avatar';
import { Cover } from '../components/Cover';
import { Waveform } from '../components/Waveform';
import type { SongDto } from '../types';

export function RoomPage(): JSX.Element {
  const { roomId = '' } = useParams();
  const { user } = useAuth();
  const connect = useRoomStore((state) => state.connect);
  const disconnect = useRoomStore((state) => state.disconnect);
  const loadSnapshot = useRoomStore((state) => state.loadSnapshot);
  const room = useRoomStore((state) => state.room);
  const queue = useRoomStore((state) => state.queue);
  const messages = useRoomStore((state) => state.messages);
  const playback = useRoomStore((state) => state.playback);
  const connectedUserIds = useRoomStore((state) => state.connectedUserIds);
  const status = useRoomStore((state) => state.status);
  const error = useRoomStore((state) => state.error);
  const driftMs = useRoomStore((state) => state.driftMs);
  const snapCount = useRoomStore((state) => state.snapCount);
  const sendMessage = useRoomStore((state) => state.sendMessage);
  const addToQueue = useRoomStore((state) => state.addToQueue);
  const removeFromQueue = useRoomStore((state) => state.removeFromQueue);
  const control = useRoomStore((state) => state.control);
  const changeTrack = useRoomStore((state) => state.changeTrack);
  const enterRoomMode = usePlayerStore((state) => state.enterRoomMode);
  const exitRoomMode = usePlayerStore((state) => state.exitRoomMode);

  const [draft, setDraft] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [candidates, setCandidates] = useState<SongDto[]>([]);
  const [localPosition, setLocalPosition] = useState(0);
  const chatRef = useRef<HTMLDivElement | null>(null);

  // Enter room mode (server-driven playback) and join over the socket.
  useEffect(() => {
    enterRoomMode(roomId);
    void loadSnapshot(roomId).catch(() => undefined);
    void connect(roomId);
    return () => {
      disconnect();
      exitRoomMode();
    };
  }, [connect, disconnect, enterRoomMode, exitRoomMode, loadSnapshot, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setLocalPosition(projectRoomPosition(playback)), 500);
    return () => window.clearInterval(timer);
  }, [playback]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .search(term)
        .then((response) => {
          if (!cancelled) setCandidates(response.songs.slice(0, 8));
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchTerm]);

  const nowPlaying = useMemo(() => queue.find((song) => song.id === playback.trackId) ?? null, [queue, playback.trackId]);
  const isHost = room !== null && user !== null && room.hostId === user.id;
  const members = room?.members ?? [];

  const submitMessage = (event: React.FormEvent): void => {
    event.preventDefault();
    const body = draft.trim();
    if (body.length === 0) return;
    setDraft('');
    void sendMessage(body);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{room?.name ?? 'Loading room…'}</h1>
            <Badge>{room?.visibility ?? 'public'}</Badge>
            {isHost ? <Badge>you are host</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            {status === 'joined' ? 'Connected — playback is driven by the server clock.' : `Status: ${status}`}
            {snapCount > 0 ? ` · resynced ${snapCount}×` : ''}
            {driftMs !== null ? ` · drift ${driftMs > 0 ? '+' : ''}${driftMs} ms` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            {members.map((member) => (
              <PresenceAvatar
                key={member.userId}
                displayName={member.displayName}
                avatarUrl={member.avatarUrl}
                connected={connectedUserIds.includes(member.userId)}
              />
            ))}
          </div>
          <Button variant="outline" asChild>
            <Link to="/rooms">Leave room</Link>
          </Button>
        </div>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <div className="space-y-6">
          <section className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-4">
              {nowPlaying ? <Cover src={nowPlaying.coverUrl} alt="" className="h-20 w-20 shrink-0" /> : null}
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Now playing</p>
                <p className="truncate text-lg font-medium">{nowPlaying?.title ?? 'Nothing queued'}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {nowPlaying?.artist?.name ?? 'Queue a track to start the session'}
                  {playback.updatedBy && user && playback.updatedBy === user.id ? ' · last changed by you' : ''}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                size="icon"
                aria-label={playback.isPlaying ? 'Pause for everyone' : 'Play for everyone'}
                disabled={!nowPlaying}
                onClick={() => void control(playback.isPlaying ? 'pause' : 'play', localPosition)}
              >
                {playback.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Waveform
                peaks={nowPlaying?.waveformPeaks ?? []}
                progressMs={localPosition}
                durationMs={nowPlaying?.durationMs ?? 0}
                onSeek={(position) => void control('seek', position)}
                className="flex-1"
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDuration(localPosition)} / {formatDuration(nowPlaying?.durationMs ?? 0)}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Seek and play/pause are sent to the server, which broadcasts the new authoritative position to every
              listener. {isHost ? 'As host you can also change the track.' : 'Only the host can change the track.'}
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Shared queue</h2>
            {queue.length === 0 ? (
              <EmptyState
                title="The queue is empty"
                description="Search below and add a track — everyone in the room sees it instantly."
              />
            ) : (
              <ol className="divide-y divide-border/60 rounded-lg border border-border">
                {queue.map((song, index) => (
                  <li key={`${song.id}-${index}`} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-5 text-right text-xs text-muted-foreground">{index + 1}</span>
                    <Cover src={song.coverUrl} alt="" rounded="rounded" className="h-10 w-10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{song.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{song.artist?.name ?? 'Unknown artist'}</p>
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(song.durationMs)}</span>
                    <Button
                      size="sm"
                      variant={isHost ? 'default' : 'ghost'}
                      disabled={!isHost}
                      aria-label={`Play ${song.title} for everyone`}
                      onClick={() => void changeTrack(song.id)}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${song.title} from the queue`}
                      onClick={() => void removeFromQueue(song.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Add to the queue</h2>
            <Input
              type="search"
              aria-label="Search tracks to queue"
              placeholder="Search the catalogue…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {candidates.length > 0 ? (
              <ul className="divide-y divide-border/60 rounded-lg border border-border">
                {candidates.map((song) => (
                  <li key={song.id} className="flex items-center gap-3 px-3 py-2">
                    <Cover src={song.coverUrl} alt="" rounded="rounded" className="h-9 w-9" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{song.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{song.artist?.name ?? ''}</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void addToQueue(song.id)}>
                      <Plus className="h-4 w-4" />
                      Queue
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Type at least two characters to search.</p>
            )}
          </section>
        </div>

        <aside className="flex h-[32rem] flex-col rounded-lg border border-border">
          <header className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Room chat</h2>
            <p className="text-xs text-muted-foreground">{messages.length} messages in this session</p>
          </header>
          <div ref={chatRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {status === 'joining' ? (
              <SkeletonList rows={3} />
            ) : messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">No messages yet — say hello.</p>
            ) : (
              messages.map((message) => (
                <div key={message.id} className="flex gap-2">
                  <PresenceAvatar displayName={message.author.displayName} avatarUrl={message.author.avatarUrl} />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      {message.author.displayName} · {formatClockTime(message.createdAt)}
                      {message.author.id === user?.id ? ' (you)' : ''}
                    </p>
                    <p className="break-words text-sm">{message.body}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <form className="flex gap-2 border-t border-border p-3" onSubmit={submitMessage}>
            <Input
              aria-label="Message"
              placeholder="Message the room…"
              value={draft}
              maxLength={1000}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" disabled={draft.trim().length === 0}>
              Send
            </Button>
          </form>
        </aside>
      </div>
    </div>
  );
}
