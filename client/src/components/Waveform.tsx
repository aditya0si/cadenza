import { useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import type { SongDto } from '../types';

/**
 * Waveform scrubber built from the server-provided peaks. It is a real control:
 * clicking seeks, and it doubles as the progress indicator.
 */
export function Waveform({
  peaks,
  progressMs,
  durationMs,
  onSeek,
  className,
  interactive = true,
}: {
  peaks: number[];
  progressMs: number;
  durationMs: number;
  onSeek?: (positionMs: number) => void;
  className?: string;
  interactive?: boolean;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const ratio = durationMs > 0 ? Math.min(1, Math.max(0, progressMs / durationMs)) : 0;
  const bars = peaks.length > 0 ? peaks : Array.from({ length: 40 }, () => 0.4);

  const seekFromEvent = (clientX: number): void => {
    const element = containerRef.current;
    if (!element || !onSeek || durationMs <= 0) return;
    const rect = element.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(Math.round(fraction * durationMs));
  };

  return (
    <div
      ref={containerRef}
      role={interactive ? 'slider' : undefined}
      aria-label={interactive ? 'Seek within track' : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? Math.round(durationMs / 1000) : undefined}
      aria-valuenow={interactive ? Math.round(progressMs / 1000) : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-testid="waveform"
      className={cn(
        'flex h-10 items-center gap-[2px]',
        interactive && 'cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      onClick={interactive ? (event) => seekFromEvent(event.clientX) : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'ArrowRight') onSeek?.(Math.min(durationMs, progressMs + 5_000));
              if (event.key === 'ArrowLeft') onSeek?.(Math.max(0, progressMs - 5_000));
            }
          : undefined
      }
    >
      {bars.map((peak, index) => {
        const played = index / bars.length <= ratio;
        return (
          <span
            key={index}
            className={cn('w-full rounded-full transition-colors', played ? 'bg-primary' : 'bg-muted-foreground/30')}
            style={{ height: `${Math.max(8, Math.min(100, peak * 100))}%` }}
          />
        );
      })}
    </div>
  );
}

/** Keeps the document title in sync with the current track. */
export function useNowPlayingTitle(track: SongDto | null): void {
  useEffect(() => {
    document.title = track ? `${track.title} — ${track.artist?.name ?? 'CADENZA'}` : 'CADENZA — collaborative music streaming';
  }, [track]);
}
