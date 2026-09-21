import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatLongDuration, formatRelativeTime } from '../lib/format';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge, EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { Input, Label } from '../components/ui/input';
import { useLibraryStore } from '../stores/libraryStore';

export function LibraryPage(): JSX.Element {
  const playlists = useLibraryStore((state) => state.playlists);
  const loading = useLibraryStore((state) => state.loading);
  const error = useLibraryStore((state) => state.error);
  const loadMine = useLibraryStore((state) => state.loadMine);
  const create = useLibraryStore((state) => state.create);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (name.trim().length === 0) return;
    try {
      const playlist = await create({ name: name.trim(), description: description.trim(), visibility });
      setName('');
      setDescription('');
      setStatus(`Created “${playlist.name}”`);
    } catch (createError) {
      setStatus(createError instanceof Error ? createError.message : 'Could not create that playlist');
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Your library</h1>
        <p className="text-sm text-muted-foreground">Playlists you own, newest first. Private by default.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>New playlist</CardTitle>
          <CardDescription>Playlists are capped at 200 tracks by the API.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-[2fr,3fr,auto,auto] sm:items-end" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="playlist-name">Name</Label>
              <Input
                id="playlist-name"
                value={name}
                required
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="playlist-description">Description</Label>
              <Input
                id="playlist-description"
                value={description}
                maxLength={600}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="playlist-visibility">Visibility</Label>
              <select
                id="playlist-visibility"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={visibility}
                onChange={(event) => setVisibility(event.target.value === 'public' ? 'public' : 'private')}
              >
                <option value="private">Private</option>
                <option value="public">Public</option>
              </select>
            </div>
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>

      {error ? <ErrorNote message={error} /> : null}
      {status ? (
        <p role="status" className="text-sm text-muted-foreground">
          {status}
        </p>
      ) : null}

      {loading ? (
        <SkeletonList rows={4} />
      ) : playlists.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          description="Create one above, then add tracks from Discover, an album, or search."
          action={
            <Button asChild variant="outline">
              <Link to="/">Browse Discover</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {playlists.map((playlist) => (
            <li key={playlist.id}>
              <Link
                to={`/playlists/${playlist.id}`}
                className="block rounded-lg border border-border p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate font-medium">{playlist.name}</p>
                  <Badge>{playlist.visibility}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {playlist.trackCount} tracks · {formatLongDuration(playlist.durationMs)} · updated{' '}
                  {formatRelativeTime(playlist.updatedAt)}
                </p>
                {playlist.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{playlist.description}</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
