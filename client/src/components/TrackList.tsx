import { Play, Pause, Plus, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatDuration } from '../lib/format';
import { Cover } from './Cover';
import { Button } from './ui/button';
import { usePlayerStore } from '../stores/playerStore';
import type { SongDto } from '../types';

export interface TrackListProps {
  songs: SongDto[];
  /** Extra actions rendered on the right of each row. */
  renderActions?: (song: SongDto) => React.ReactNode;
  onQueue?: (song: SongDto) => void;
  onRemove?: (song: SongDto) => void;
  emptyMessage?: string;
  /** Enables drag-to-reorder handles and emits the new order. */
  onReorder?: (songIds: string[]) => void;
  reorderable?: boolean;
}

export function TrackList({
  songs,
  renderActions,
  onQueue,
  onRemove,
  emptyMessage = 'No tracks here yet.',
  onReorder,
  reorderable = false,
}: TrackListProps): JSX.Element {
  const currentTrackId = usePlayerStore((state) => state.queue.tracks[state.queue.index]?.id ?? null);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const play = usePlayerStore((state) => state.play);

  if (songs.length === 0) {
    return <p className="px-1 py-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  const move = (from: number, to: number): void => {
    if (!onReorder || to < 0 || to >= songs.length || from === to) return;
    const ids = songs.map((song) => song.id);
    const [moved] = ids.splice(from, 1);
    if (!moved) return;
    ids.splice(to, 0, moved);
    onReorder(ids);
  };

  return (
    <ol className="divide-y divide-border/60">
      {songs.map((song, index) => {
        const isCurrent = song.id === currentTrackId;
        return (
          <li
            key={song.id}
            draggable={reorderable}
            onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={(event) => {
              if (reorderable) event.preventDefault();
            }}
            onDrop={(event) => {
              if (!reorderable) return;
              event.preventDefault();
              const from = Number(event.dataTransfer.getData('text/plain'));
              if (Number.isInteger(from)) move(from, index);
            }}
            className={cn('group flex items-center gap-3 px-1 py-2', isCurrent && 'bg-accent/40')}
          >
            <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
              {isCurrent && isPlaying ? <span aria-label="Now playing">▶</span> : index + 1}
            </span>
            <Cover src={song.coverUrl} alt="" rounded="rounded" className="h-10 w-10 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className={cn('truncate text-sm', isCurrent && 'font-medium text-primary')}>{song.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {song.artist?.name ?? 'Unknown artist'}
                {song.album ? ` · ${song.album.title}` : ''}
              </p>
            </div>
            {reorderable && onReorder ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${song.title} up`}
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${song.title} down`}
                  onClick={() => move(index, index + 1)}
                  disabled={index === songs.length - 1}
                >
                  ↓
                </Button>
              </div>
            ) : null}
            <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{formatDuration(song.durationMs)}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label={isCurrent && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
                onClick={() => void play(songs, index)}
              >
                {isCurrent && isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              {onQueue ? (
                <Button variant="ghost" size="icon" aria-label={`Queue ${song.title}`} onClick={() => onQueue(song)}>
                  <Plus className="h-4 w-4" />
                </Button>
              ) : null}
              {onRemove ? (
                <Button variant="ghost" size="icon" aria-label={`Remove ${song.title}`} onClick={() => onRemove(song)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
              {renderActions?.(song)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
