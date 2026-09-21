import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../components/ui/overlays';
import { ErrorNote } from '../components/ui/feedback';
import { useLibraryStore } from '../stores/libraryStore';
import type { PlaylistDto, SongDto } from '../types';

/** Adds one track (or a whole album) to one of the listener's playlists. */
export function AddToPlaylistDialog({ songs }: { songs: SongDto[] }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<PlaylistDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createPlaylist = useLibraryStore((state) => state.create);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void api
      .playlists({ scope: 'mine', limit: 50 })
      .then((page) => {
        if (!cancelled) setPlaylists(page.items);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load your playlists');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const addTo = async (playlistId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    let added = 0;
    let skipped = 0;
    for (const song of songs) {
      try {
        await api.addPlaylistSong(playlistId, song.id);
        added += 1;
      } catch {
        skipped += 1;
      }
    }
    setBusy(false);
    setStatus(`Added ${added} track${added === 1 ? '' : 's'}${skipped > 0 ? `, ${skipped} already there` : ''}`);
  };

  const createAndAdd = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const playlist = await createPlaylist({ name: `New playlist ${new Date().toLocaleDateString()}` });
      setPlaylists((current) => [playlist, ...current]);
      await addTo(playlist.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create a playlist');
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Add to playlist</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Add to playlist</DialogTitle>
        <DialogDescription>
          {songs.length} track{songs.length === 1 ? '' : 's'} selected.
        </DialogDescription>
        <div className="mt-4 space-y-3">
          {error ? <ErrorNote message={error} /> : null}
          {status ? (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          ) : null}
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={busy}
                  onClick={() => void addTo(playlist.id)}
                >
                  {playlist.name}
                  <span className="ml-auto text-xs text-muted-foreground">{playlist.trackCount} tracks</span>
                </Button>
              </li>
            ))}
            {playlists.length === 0 ? <li className="text-sm text-muted-foreground">No playlists yet.</li> : null}
          </ul>
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void createAndAdd()}>
            Create a new playlist and add these
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
