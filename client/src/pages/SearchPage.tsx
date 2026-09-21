import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AlbumCard, ArtistCard } from '../components/Cover';
import { TrackList } from '../components/TrackList';
import { Button } from '../components/ui/button';
import { EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { Input } from '../components/ui/input';
import { usePlayerStore } from '../stores/playerStore';
import type { SearchResults } from '../types';

const SUGGESTIONS = ['neon', 'ambient', 'harbor', 'orbit', 'static'];

export function SearchPage(): JSX.Element {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enqueue = usePlayerStore((state) => state.enqueue);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void api
        .search(query)
        .then((response) => {
          setResults(response);
          setError(null);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted) return;
          setError(searchError instanceof Error ? searchError.message : 'Search failed');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
      setLoading(false);
    };
  }, [term]);

  const total = results ? results.songs.length + results.albums.length + results.artists.length : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Ranked full-text search over song titles, genres, album titles and artist names.
        </p>
        <Input
          type="search"
          aria-label="Search the catalogue"
          placeholder="Try “neon”, “ambient”, “harbor”…"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button key={suggestion} size="sm" variant="secondary" onClick={() => setTerm(suggestion)}>
              {suggestion}
            </Button>
          ))}
        </div>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {term.trim().length < 2 ? (
        <EmptyState title="Start typing" description="Search needs at least two characters." />
      ) : loading ? (
        <SkeletonList rows={5} />
      ) : total === 0 ? (
        <EmptyState title="No matches" description={`Nothing in the catalogue matches “${term.trim()}”.`} />
      ) : (
        <div className="space-y-8">
          {results && results.songs.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Songs</h2>
              <TrackList songs={results.songs} onQueue={(song) => enqueue([song])} />
            </section>
          ) : null}
          {results && results.albums.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Albums</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                {results.albums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </section>
          ) : null}
          {results && results.artists.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Artists</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {results.artists.map((artist) => (
                  <ArtistCard key={artist.id} artist={artist} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
