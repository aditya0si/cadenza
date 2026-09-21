import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDayLabel, formatRelativeTime } from '../lib/format';
import { Badge, EmptyState, ErrorNote, SkeletonList } from '../components/ui/feedback';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Cover } from '../components/Cover';
import type { ActiveRoomRow, PlaysBucket, StatsOverview, TopTrackRow } from '../types';

/** Plays-over-time chart drawn as inline SVG — no chart dependency needed. */
export function PlaysChart({ buckets }: { buckets: PlaysBucket[] }): JSX.Element {
  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">No plays recorded in this window.</p>;
  }
  const width = 720;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const max = Math.max(...buckets.map((bucket) => bucket.plays), 1);
  const stepX = (width - padding.left - padding.right) / Math.max(1, buckets.length - 1);
  const points = buckets.map((bucket, index) => {
    const x = padding.left + index * stepX;
    const y = height - padding.bottom - (bucket.plays / max) * (height - padding.top - padding.bottom);
    return { x, y, bucket };
  });
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${padding.left},${height - padding.bottom} ${line} ${(padding.left + (buckets.length - 1) * stepX).toFixed(1)},${height - padding.bottom}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Plays per day over ${buckets.length} days, peak ${max}`}
      className="h-56 w-full"
    >
      <defs>
        <linearGradient id="plays" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(158 72% 52%)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="hsl(158 72% 52%)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((fraction) => {
        const y = height - padding.bottom - fraction * (height - padding.top - padding.bottom);
        return (
          <g key={fraction}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="hsl(222 16% 20%)" strokeWidth="1" />
            <text x={4} y={y + 4} fill="hsl(215 14% 66%)" fontSize="10">
              {Math.round(max * fraction)}
            </text>
          </g>
        );
      })}
      <polygon points={area} fill="url(#plays)" />
      <polyline points={line} fill="none" stroke="hsl(158 72% 52%)" strokeWidth="2" />
      {points.map((point) => (
        <g key={point.bucket.date}>
          <circle cx={point.x} cy={point.y} r="3" fill="hsl(158 72% 52%)">
            <title>{`${point.bucket.date}: ${point.bucket.plays} plays, ${point.bucket.uniqueListeners} listeners`}</title>
          </circle>
          {points.length <= 16 || point === points[0] || point === points[points.length - 1] ? (
            <text x={point.x} y={height - 8} textAnchor="middle" fill="hsl(215 14% 66%)" fontSize="9">
              {formatDayLabel(point.bucket.date)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

export function AdminPage(): JSX.Element {
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [buckets, setBuckets] = useState<PlaysBucket[]>([]);
  const [tracks, setTracks] = useState<TopTrackRow[]>([]);
  const [rooms, setRooms] = useState<ActiveRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.statsOverview(), api.statsPlays(14), api.statsTopTracks(8), api.statsActiveRooms(8)])
      .then(([overviewResponse, playsResponse, tracksResponse, roomsResponse]) => {
        if (cancelled) return;
        setOverview(overviewResponse);
        setBuckets(playsResponse.buckets);
        setTracks(tracksResponse.tracks);
        setRooms(roomsResponse.rooms);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load statistics');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = overview
    ? [
        { label: 'Songs', value: overview.songs },
        { label: 'Artists', value: overview.artists },
        { label: 'Albums', value: overview.albums },
        { label: 'Listeners', value: overview.users },
        { label: 'Playlists', value: overview.playlists },
        { label: 'Rooms (active)', value: `${overview.rooms} (${overview.activeRooms})` },
        { label: 'Messages', value: overview.messages },
        { label: 'Play events', value: overview.playEvents },
      ]
    : [];

  const peak = Math.max(...tracks.map((track) => track.plays), 1);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Admin dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Every number here is an aggregation over the live MongoDB collections behind <code>/api/stats/*</code>.
        </p>
      </header>

      {error ? <ErrorNote message={error} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plays over time</CardTitle>
          <CardDescription>Daily play events for the last 14 days (UTC).</CardDescription>
        </CardHeader>
        <CardContent>{loading ? <SkeletonList rows={3} /> : <PlaysChart buckets={buckets} />}</CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top tracks</CardTitle>
            <CardDescription>By recorded play events, all time.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <SkeletonList rows={4} />
            ) : tracks.length === 0 ? (
              <EmptyState title="No plays yet" description="Play something from Discover to populate this chart." />
            ) : (
              tracks.map((track) => (
                <div key={track.songId} className="flex items-center gap-3">
                  <Cover src={track.coverUrl} alt="" rounded="rounded" className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{track.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{track.artistName}</p>
                  </div>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${(track.plays / peak) * 100}%` }} />
                  </div>
                  <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{track.plays}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Active rooms</CardTitle>
            <CardDescription>Rooms with activity in the last hour.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <SkeletonList rows={3} />
            ) : rooms.length === 0 ? (
              <EmptyState title="No active rooms" description="Open a listening room to see it here." />
            ) : (
              <ul className="space-y-3">
                {rooms.map((room) => (
                  <li key={room.id} className="flex items-center gap-3">
                    {room.nowPlaying ? <Cover src={room.nowPlaying.coverUrl} alt="" rounded="rounded" className="h-9 w-9" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{room.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {room.nowPlaying?.title ?? 'nothing queued'} · {room.memberCount} listeners · {room.queueLength} queued
                      </p>
                    </div>
                    <Badge>{room.isPlaying ? 'playing' : 'paused'}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(room.lastActivityAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
