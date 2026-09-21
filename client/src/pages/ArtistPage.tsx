import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatCount } from '../lib/format';
import { AlbumCard, Cover } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { ErrorNote, SkeletonCardGrid, SkeletonList } from '../components/ui/feedback';
import { usePlayerStore } from '../stores/playerStore';
import type { AlbumDto, ArtistDto, SongDto } from '../types';

export function ArtistPage(): JSX.Element {
  const { artistId = '' } = useParams();
  const [artist, setArtist] = useState<ArtistDto | null>(null);
  const [albums, setAlbums] = useState<AlbumDto[]>([]);
  const [topSongs, setTopSongs] = useState<SongDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const enqueue = usePlayerStore((state) => state.enqueue);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .artist(artistId)
      .then((response) => {
        if (cancelled) return;
        setArtist(response.artist);
        setAlbums(response.albums);
        setTopSongs(response.topSongs);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load this artist');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artistId]);

  return (
    <div className="space-y-8">
      {error ? <ErrorNote message={error} /> : null}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {artist ? <Cover src={artist.imageUrl} alt={`${artist.name} artwork`} rounded="rounded-full" className="h-32 w-32" /> : null}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Artist</p>
          <h1 className="text-3xl font-semibold">{artist?.name ?? 'Loading…'}</h1>
          <p className="text-sm text-muted-foreground">
            {artist ? `${formatCount(artist.monthlyListeners)} listens · ${artist.genres.join(', ') || 'no genres tagged'}` : ''}
          </p>
          {artist?.bio ? <p className="max-w-2xl text-sm text-muted-foreground">{artist.bio}</p> : null}
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Albums</h2>
        {loading ? (
          <SkeletonCardGrid count={3} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Top tracks</h2>
        {loading ? <SkeletonList rows={5} /> : <TrackList songs={topSongs} onQueue={(song) => enqueue([song])} />}
      </section>
    </div>
  );
}
