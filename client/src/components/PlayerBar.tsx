import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import { usePlayerStore, selectCurrentTrack } from '../stores/playerStore';
import { useRoomStore } from '../stores/roomStore';
import { projectRoomPosition } from '../room/roomSync';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { Cover } from './Cover';
import { Waveform, useNowPlayingTitle } from './Waveform';

const DRIFT_REPORT_INTERVAL_MS = 5_000;

/**
 * The persistent player. It renders the single <audio> element for the app, so
 * playback survives navigation. In `room` mode the transport is driven by the
 * server-authoritative clock instead of local controls.
 */
export function PlayerBar(): JSX.Element | null {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queue = usePlayerStore((state) => state.queue);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const volume = usePlayerStore((state) => state.volume);
  const mode = usePlayerStore((state) => state.mode);
  const streamUrl = usePlayerStore((state) => state.streamUrl);
  const streamError = usePlayerStore((state) => state.streamError);
  const soloTrack = usePlayerStore(selectCurrentTrack);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const setPlaying = usePlayerStore((state) => state.setPlaying);

  const roomPlayback = useRoomStore((state) => state.playback);
  const roomQueue = useRoomStore((state) => state.queue);
  const control = useRoomStore((state) => state.control);
  const reportPosition = useRoomStore((state) => state.reportPosition);
  const snapCount = useRoomStore((state) => state.snapCount);
  const driftMs = useRoomStore((state) => state.driftMs);
  const roomId = useRoomStore((state) => state.roomId);

  const [positionMs, setPositionMs] = useState(0);
  const [roomStreamUrl, setRoomStreamUrl] = useState<string | null>(null);

  const roomTrack = useMemo(
    () => roomQueue.find((song) => song.id === roomPlayback.trackId) ?? null,
    [roomQueue, roomPlayback.trackId],
  );
  const track = mode === 'room' ? roomTrack : soloTrack;
  const durationMs = track?.durationMs ?? 0;
  const activeUrl = mode === 'room' ? roomStreamUrl : streamUrl;
  useNowPlayingTitle(track);

  // In room mode the audio source is a signed URL for the server's current track.
  useEffect(() => {
    if (mode !== 'room' || !roomTrack) {
      setRoomStreamUrl(null);
      return;
    }
    let cancelled = false;
    void api
      .streamUrl(roomTrack.id)
      .then((issued) => {
        if (!cancelled) setRoomStreamUrl(issued.url);
      })
      .catch(() => {
        if (!cancelled) setRoomStreamUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, roomTrack]);

  // Room mode: the server clock decides where playback is.
  useEffect(() => {
    if (mode !== 'room') return;
    const audio = audioRef.current;
    if (!audio) return;
    const target = projectRoomPosition(roomPlayback) / 1000;
    if (Number.isFinite(target) && Math.abs(audio.currentTime - target) > 0.4) {
      audio.currentTime = target;
    }
    if (roomPlayback.isPlaying && audio.paused) void audio.play().catch(() => undefined);
    if (!roomPlayback.isPlaying && !audio.paused) audio.pause();
  }, [mode, roomPlayback]);

  // Local position ticker (solo mode reads the element, room mode projects the anchor).
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (mode === 'room') {
        setPositionMs(projectRoomPosition(roomPlayback));
        return;
      }
      setPositionMs(Math.round((audioRef.current?.currentTime ?? 0) * 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [mode, roomPlayback]);

  // Periodically tell the server where this client is; it snaps us if we drifted.
  useEffect(() => {
    if (mode !== 'room' || !roomId) return;
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (audio && !audio.paused) reportPosition(Math.round(audio.currentTime * 1000));
    }, DRIFT_REPORT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [mode, roomId, reportPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume;
  }, [volume]);

  const seek = useCallback(
    (targetMs: number) => {
      const clamped = Math.max(0, Math.min(durationMs, Math.round(targetMs)));
      if (mode === 'room') {
        void control('seek', clamped);
        return;
      }
      const audio = audioRef.current;
      if (audio) audio.currentTime = clamped / 1000;
      setPositionMs(clamped);
    },
    [control, durationMs, mode],
  );

  const togglePlay = useCallback(() => {
    if (mode === 'room') {
      void control(roomPlayback.isPlaying ? 'pause' : 'play', Math.round(projectRoomPosition(roomPlayback)));
      return;
    }
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      void audio.play().catch(() => undefined);
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [control, mode, roomPlayback, setPlaying, track]);

  // Keyboard shortcuts (ignored while typing).
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          event.preventDefault();
          seek(positionMs + 5_000);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          seek(positionMs - 5_000);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setVolume(volume + 0.05);
          break;
        case 'ArrowDown':
          event.preventDefault();
          setVolume(volume - 0.05);
          break;
        case 'n':
          if (mode === 'solo') void next();
          break;
        case 'p':
          if (mode === 'solo') void previous();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, next, positionMs, previous, seek, setVolume, togglePlay, volume]);

  if (!track && queue.tracks.length === 0 && mode === 'solo') return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {track ? <Cover src={track.coverUrl} alt="" rounded="rounded" className="h-12 w-12 shrink-0" /> : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{track?.title ?? 'Nothing playing'}</p>
            <p className="truncate text-xs text-muted-foreground">
              {track?.artist?.name ?? 'Pick a track from Discover'}
              {mode === 'room' ? ' · listening room' : ''}
            </p>
            {streamError ? (
              <p role="alert" className="truncate text-xs text-destructive-foreground">
                {streamError}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-[2] items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous track"
            onClick={() => (mode === 'room' ? seek(0) : void previous())}
          >
            <SkipBack className="h-4 w-4" />
          </Button>
          <Button
            variant="default"
            size="icon"
            aria-label={isPlaying || roomPlayback.isPlaying ? 'Pause' : 'Play'}
            onClick={togglePlay}
            disabled={!track}
          >
            {isPlaying || (mode === 'room' && roomPlayback.isPlaying) ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next track"
            onClick={() => (mode === 'room' ? seek(durationMs) : void next())}
            disabled={mode === 'solo' && queue.tracks.length < 2}
          >
            <SkipForward className="h-4 w-4" />
          </Button>
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{formatDuration(positionMs)}</span>
          <Waveform
            peaks={track?.waveformPeaks ?? []}
            progressMs={positionMs}
            durationMs={durationMs}
            onSeek={seek}
            className="flex-1"
          />
          <span className="w-10 text-xs tabular-nums text-muted-foreground">{formatDuration(durationMs)}</span>
        </div>

        <div className="flex flex-1 items-center justify-end gap-3">
          {mode === 'room' ? (
            <span className="hidden text-xs text-muted-foreground sm:inline" data-testid="room-sync-status">
              {snapCount > 0 ? `resynced ${snapCount}×` : 'in sync'}
              {driftMs !== null ? ` · drift ${driftMs > 0 ? '+' : ''}${driftMs} ms` : ''}
            </span>
          ) : null}
          <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Slider
            aria-label="Volume"
            className="w-24"
            min={0}
            max={1}
            step={0.01}
            value={[volume]}
            onValueChange={(value) => setVolume(value[0] ?? 0)}
          />
        </div>
      </div>

      <audio
        ref={audioRef}
        src={activeUrl ?? undefined}
        preload="metadata"
        data-testid="audio-element"
        onEnded={() => {
          if (mode === 'room') return;
          void next();
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
