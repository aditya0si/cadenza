import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { Input, Label } from '../components/ui/input';
import { Cover } from '../components/Cover';
import type { RoomSummaryDto } from '../types';

export function RoomsPage(): JSX.Element {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await api.rooms({ activeOnly: true, limit: 50 });
      setRooms(page.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load rooms');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim().length < 2) return;
    setBusy(true);
    try {
      const response = await api.createRoom({ name: name.trim(), visibility });
      navigate(`/rooms/${response.room.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create that room');
    } finally {
      setBusy(false);
    }
  };

  const join = async (roomId: string): Promise<void> => {
    try {
      await api.joinRoom(roomId);
      navigate(`/rooms/${roomId}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Could not join that room');
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Listening rooms</h1>
        <p className="text-sm text-muted-foreground">
          One shared queue, one server-authoritative clock, live chat and presence. The host picks the track; everyone
          can queue and control playback.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Open a room</CardTitle>
          <CardDescription>You become the host and can change the track for everyone.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[3fr,auto,auto] sm:items-end" onSubmit={create}>
            <div className="space-y-1.5">
              <Label htmlFor="room-name">Room name</Label>
              <Input
                id="room-name"
                value={name}
                required
                minLength={2}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-visibility">Visibility</Label>
              <select
                id="room-visibility"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value === 'private' ? 'private' : 'public')}
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
            <Button type="submit" disabled={busy}>
              Create room
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? <ErrorNote message={error} /> : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active now</h2>
          <Button variant="ghost" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        {loading ? (
          <SkeletonList rows={3} />
        ) : rooms.length === 0 ? (
          <EmptyState title="No active rooms" description="Open one above — it stays listed while there is activity." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {rooms.map((room) => (
              <li key={room.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start gap-3">
                  {room.nowPlaying ? (
                    <Cover src={room.nowPlaying.coverUrl} alt="" rounded="rounded" className="h-14 w-14 shrink-0" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium">{room.name}</p>
                      <Badge>{room.isPlaying ? 'playing' : 'paused'}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {room.nowPlaying ? `“${room.nowPlaying.title}”` : 'Nothing queued yet'} · {room.memberCount}{' '}
                      listener{room.memberCount === 1 ? '' : 's'} · {room.queueLength} queued
                    </p>
                    <p className="text-xs text-muted-foreground">active {formatRelativeTime(room.lastActivityAt)}</p>
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void join(room.id)}>
                        Join
                      </Button>
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/rooms/${room.id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
