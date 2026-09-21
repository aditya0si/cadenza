import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatLongDuration } from '../lib/format';
import { Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { usePlayerStore } from '../stores/playerStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useAuth } from '../auth/AuthProvider';
import type { PlaylistDto, SongDto } from '../types';

export function PlaylistPage(): JSX.Element {
  const { playlistId = '' } = useParams();
  const { user } = useAuth();
  const [playlist, setPlaylist] = useState<PlaylistDto | null>(null);
  const [songs, setSongs] = useState<SongDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const play = usePlayerStore((state) => state.play);
  const enqueue = usePlayerStore((state) => state.enqueue);
  const reorder = useLibraryStore((state) => state.reorder);

  const isOwner = playlist !== null && user !== null && playlist.ownerId === user.id;
  const isAdmin = user?.roles.includes('admin') ?? false;
  const canEdit = isOwner || isAdmin;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .playlist(playlistId)
      .then((response) => {
        if (cancelled) return;
        setPlaylist(response.playlist);
        setSongs(response.playlist.songs);
        setName(response.playlist.name);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this playlist');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId]);

  const totalMs = useMemo(() => songs.reduce((sum, song) => sum + song.durationMs, 0), [songs]);

  const handleReorder = async (songIds: string[]): Promise<void> => {
    setSongs((current) => {
      const byId = new Map(current.map((song) => [song.id, song]));
      return songIds.map((id) => byId.get(id)).filter((song): song is SongDto => song !== undefined);
    });
    try {
      await reorder(playlistId, songIds);
      const refreshed = await api.playlist(playlistId);
      setSongs(refreshed.playlist.songs);
      setPlaylist(refreshed.playlist);
      setStatus('Order saved');
    } catch (reorderError) {
      setStatus(reorderError instanceof Error ? reorderError.message : 'Could not save the new order');
    }
  };

  const handleRemove = async (song: SongDto): Promise<void> => {
    try {
      const response = await api.removePlaylistSong(playlistId, song.id);
      setPlaylist(response.playlist);
      setSongs(response.playlist.songs);
    } catch (removeError) {
      setStatus(removeError instanceof Error ? removeError.message : 'Could not remove that track');
    }
  };

  const saveName = async (): Promise<void> => {
    try {
      const response = await api.updatePlaylist(playlistId, { name });
      setPlaylist(response.playlist);
      setEditing(false);
      setStatus('Saved');
    } catch (saveError) {
      setStatus(saveError instanceof Error ? saveError.message : 'Could not rename this playlist');
    }
  };

  const toggleVisibility = async (): Promise<void> => {
    if (!playlist) return;
    try {
      const response = await api.updatePlaylist(playlistId, {
        visibility: playlist.visibility === 'public' ? 'private' : 'public',
      });
      setPlaylist(response.playlist);
      setStatus(`Playlist is now ${response.playlist.visibility}`);
    } catch (visibilityError) {
      setStatus(visibilityError instanceof Error ? visibilityError.message : 'Could not change visibility');
    }
  };

  return (
    <div className="space-y-6">
      {error ? <ErrorNote message={error} /> : null}
      {status ? (
        <p role="status" className="rounded-md border border-border bg-card px-3 py-2 text-sm">
          {status}
        </p>
      ) : null}

      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <Cover
          src={playlist?.songs[0]?.coverUrl ?? '/api/media/cover/song/000000000000000000000000'}
          alt=""
          className="h-40 w-40 sm:h-48 sm:w-48"
        />
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            {playlist?.visibility === 'public' ? 'Public playlist' : 'Private playlist'}
          </p>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                aria-label="Playlist name"
                className="h-10 rounded-md border border-input bg-background px-3 text-lg"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Button size="sm" onClick={() => void saveName()}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <h1 className="text-3xl font-semibold">{playlist?.name ?? 'Loading…'}</h1>
          )}
          <p className="text-sm text-muted-foreground">
            {songs.length} tracks · {formatLongDuration(totalMs)}
            {isOwner ? ' · you own this playlist' : ''}
          </p>
          {playlist?.description ? <p className="max-w-2xl text-sm text-muted-foreground">{playlist.description}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => void play(songs, 0)} disabled={songs.length === 0}>
              Play
            </Button>
            <Button variant="outline" onClick={() => enqueue(songs)} disabled={songs.length === 0}>
              Add to queue
            </Button>
            {canEdit ? (
              <>
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Rename
                </Button>
                <Button variant="outline" onClick={() => void toggleVisibility()}>
                  Make {playlist?.visibility === 'public' ? 'private' : 'public'}
                </Button>
              </>
            ) : null}
            {isOwner ? (
              <Button
                variant="destructive"
                onClick={() => {
                  void api.deletePlaylist(playlistId).then(() => window.location.assign('/library'));
                }}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {loading ? (
        <SkeletonList rows={5} />
      ) : songs.length === 0 ? (
        <EmptyState
          title="This playlist is empty"
          description="Add tracks from Discover, an album, or the search results."
          action={
            <Button asChild variant="outline">
              <Link to="/">Browse Discover</Link>
            </Button>
          }
        />
      ) : (
        <>
          {canEdit ? (
            <p className="text-xs text-muted-foreground">
              Drag a row (or use the arrow buttons) to reorder — the new order is saved to the API immediately.
            </p>
          ) : null}
          <TrackList
            songs={songs}
            reorderable={canEdit}
            onReorder={(songIds) => void handleReorder(songIds)}
            onQueue={(song) => enqueue([song])}
            onRemove={canEdit ? (song) => void handleRemove(song) : undefined}
          />
        </>
      )}
    </div>
  );
}
