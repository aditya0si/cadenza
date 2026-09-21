import { Link } from 'react-router-dom';
import { cn, assetUrl } from '../lib/utils';
import type { AlbumDto, ArtistDto, SongDto } from '../types';

export function Cover({
  src,
  alt,
  className,
  rounded = 'rounded-lg',
}: {
  src: string;
  alt: string;
  className?: string;
  rounded?: string;
}): JSX.Element {
  return (
    <img
      src={assetUrl(src)}
      alt={alt}
      loading="lazy"
      className={cn('aspect-square w-full bg-muted object-cover', rounded, className)}
    />
  );
}

export function AlbumCard({ album }: { album: AlbumDto }): JSX.Element {
  return (
    <Link
      to={`/albums/${album.id}`}
      className="group space-y-2 rounded-lg p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Cover src={album.coverUrl} alt={`${album.title} cover`} />
      <div className="space-y-0.5">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">{album.artist?.name ?? 'Unknown artist'}</p>
      </div>
    </Link>
  );
}

export function ArtistCard({ artist }: { artist: ArtistDto }): JSX.Element {
  return (
    <Link
      to={`/artists/${artist.id}`}
      className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Cover src={artist.imageUrl} alt={`${artist.name} artwork`} rounded="rounded-full" className="h-14 w-14" />
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium">{artist.name}</p>
        <p className="truncate text-xs text-muted-foreground">{artist.genres.join(' · ') || 'Artist'}</p>
      </div>
    </Link>
  );
}

export function SongMeta({ song }: { song: SongDto }): JSX.Element {
  return (
    <span className="text-xs text-muted-foreground">
      {song.artist?.name ?? 'Unknown artist'}
      {song.album ? ` · ${song.album.title}` : ''}
      {song.bpm ? ` · ${song.bpm} BPM` : ''}
      {song.musicalKey ? ` · ${song.musicalKey}` : ''}
    </span>
  );
}
