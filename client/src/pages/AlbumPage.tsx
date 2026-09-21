import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatLongDuration } from '../lib/format';
import { Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { AddToPlaylistDialog } from '../components/AddToPlaylistDialog';
import { Button } from '../components/ui/button';
import { ErrorNote, SkeletonList } from '../components/ui/feedback';
import { usePlayerStore } from '../stores/playerStore';
import type { AlbumDto, SongDto } from '../types';

export function AlbumPage(): JSX.Element {
  const { albumId = '' } = useParams();
  const [album, setAlbum] = useState<AlbumDto | null>(null);
  const [songs, setSongs] = useState<SongDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const play = usePlayerStore((state) => state.play);
  const enqueue = usePlayerStore((state) => state.enqueue);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .album(albumId)
      .then((response) => {
        if (cancelled) return;
        setAlbum(response.album);
        setSongs(response.songs);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this album');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [albumId]);

  const totalMs = songs.reduce((sum, song) => sum + song.durationMs, 0);

  return (
    <div className="space-y-6">
      {error ? <ErrorNote message={error} /> : null}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        {album ? <Cover src={album.coverUrl} alt={`${album.title} cover`} className="h-40 w-40 sm:h-48 sm:w-48" /> : null}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Album</p>
          <h1 className="text-3xl font-semibold">{album?.title ?? 'Loading…'}</h1>
          <p className="text-sm text-muted-foreground">
            {album?.artist?.name ?? 'Unknown artist'} · {album?.releaseYear ?? ''} · {songs.length} tracks ·{' '}
            {formatLongDuration(totalMs)}
          </p>
          {album?.description ? <p className="max-w-2xl text-sm text-muted-foreground">{album.description}</p> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={() => void play(songs, 0)} disabled={songs.length === 0}>
              Play album
            </Button>
            <Button variant="outline" onClick={() => enqueue(songs)} disabled={songs.length === 0}>
              Add to queue
            </Button>
            <AddToPlaylistDialog songs={songs} />
          </div>
        </div>
      </header>

      {loading ? <SkeletonList rows={6} /> : <TrackList songs={songs} onQueue={(song) => enqueue([song])} />}
    </div>
  );
}
