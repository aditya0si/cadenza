import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AlbumCard, ArtistCard } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { EmptyState, ErrorNote, SkeletonCardGrid, SkeletonList } from '../components/ui/feedback';
import { Button } from '../components/ui/button';
import { usePlayerStore } from '../stores/playerStore';
import type { AlbumDto, ArtistDto, SongDto } from '../types';

export function DiscoverPage(): JSX.Element {
  const [albums, setAlbums] = useState<AlbumDto[]>([]);
  const [artists, setArtists] = useState<ArtistDto[]>([]);
  const [songs, setSongs] = useState<SongDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const play = usePlayerStore((state) => state.play);
  const enqueue = usePlayerStore((state) => state.enqueue);

  useEffect(() => {
    let cancelled = false;
    void api
      .discover()
      .then((response) => {
        if (cancelled) return;
        setAlbums(response.featuredAlbums);
        setArtists(response.artists);
        setSongs(response.topSongs);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load Discover');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-border bg-gradient-to-br from-primary/20 via-card to-card p-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Now streaming</p>
        <h1 className="mt-2 text-3xl font-semibold">Your library, in sync with everyone else</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Browse the sample catalogue, build playlists, and open a listening room to share one queue and one clock with
          other listeners. Every track here was synthesised by <code>tools/generate-media.mjs</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void play(songs, 0)} disabled={songs.length === 0}>
            Play top tracks
          </Button>
          <Button variant="outline" onClick={() => enqueue(songs)} disabled={songs.length === 0}>
            Add top tracks to queue
          </Button>
        </div>
      </section>

      {error ? <ErrorNote message={error} /> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Featured albums</h2>
        {loading ? (
          <SkeletonCardGrid />
        ) : albums.length === 0 ? (
          <EmptyState title="No albums yet" description="Run the seed script against a database with the generated media library." />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Most played</h2>
        {loading ? <SkeletonList rows={5} /> : <TrackList songs={songs} onQueue={(song) => enqueue([song])} />}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Artists</h2>
        {loading ? (
          <SkeletonList rows={4} />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
