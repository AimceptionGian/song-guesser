import { useEffect, useRef, useState, useCallback } from 'react';
import VolumeControl, { useStoredVolume } from './VolumeControl';

interface SnippetPlayerProps {
  previewUrl?: string;
  /** How much of the song's start to play, in seconds (e.g. 0.1). */
  durationSec: number;
}

/** "0,1 s" — German decimal comma, as everywhere else in the UI. */
export function formatSnippetSec(sec: number): string {
  return `${String(sec).replace('.', ',')} s`;
}

/**
 * Plays the first `durationSec` of the preview, every time the button is
 * pressed. Each device plays it on its own — there is no shared transport —
 * so every player hears exactly the same snippet, from the very start.
 *
 * A 0.1s snippet is far below what `timeupdate` (≈4 Hz) can resolve, so the
 * cut-off is driven by requestAnimationFrame, measured from the 'playing'
 * event (when audio actually starts), with currentTime as a second check.
 */
export default function SnippetPlayer({ previewUrl, durationSec }: SnippetPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [plays, setPlays] = useState(0);
  const { volume, setVolume, toggleMute } = useStoredVolume();
  // Read by the audio setup below without re-creating the element per change
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    if (!previewUrl) {
      setFailed(true);
      return;
    }
    const audio = new Audio(previewUrl);
    audio.preload = 'auto';
    audio.volume = volumeRef.current;
    audioRef.current = audio;
    const onReady = () => setReady(true);
    const onError = () => setFailed(true);
    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('loadeddata', onReady);
    audio.addEventListener('error', onError);
    audio.load();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audio.pause();
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [previewUrl]);

  // The running playback: where in the snippet it started, and when audio
  // actually began (null until the 'playing' event). Its position is derived
  // from the clock, not from the animation loop — rAF stops in background
  // tabs, the clock doesn't.
  const runRef = useRef<{ offsetMs: number; startedAt: number | null } | null>(null);
  const cutoffRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const positionMs = () => {
    const run = runRef.current;
    if (!run) return 0;
    return run.offsetMs + (run.startedAt === null ? 0 : performance.now() - run.startedAt);
  };

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (cutoffRef.current) clearTimeout(cutoffRef.current);
    cutoffRef.current = null;
    audioRef.current?.pause();
    runRef.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  // Where in the snippet a paused playback stands (seconds); null = not paused
  const [pausedAtSec, setPausedAtSec] = useState<number | null>(null);

  // A new stage (longer snippet) starts fresh
  useEffect(() => {
    stop();
    setPlays(0);
    setProgress(0);
    setPausedAtSec(null);
  }, [durationSec, stop]);

  /** Play from `fromSec` into the snippet until the snippet's end. */
  const start = useCallback((fromSec: number, resume = false) => {
    const audio = audioRef.current;
    if (!audio || playing) return;
    audio.pause();
    audio.currentTime = fromSec;
    setPausedAtSec(null);
    setPlaying(true);
    if (!resume) {
      setProgress(0);
      setPlays((n) => n + 1);
    }

    const limitMs = durationSec * 1000;
    const run = { offsetMs: fromSec * 1000, startedAt: null as number | null };
    runRef.current = run;

    const finish = () => {
      if (runRef.current !== run) return;
      stop();
      setProgress(1);
    };
    const begin = () => {
      if (run.startedAt !== null || runRef.current !== run) return;
      run.startedAt = performance.now();
      // Backstop for the rAF cut-off, which browsers suspend in background tabs
      cutoffRef.current = setTimeout(finish, limitMs - run.offsetMs + 30);
      rafRef.current = requestAnimationFrame(tick);
    };
    const tick = () => {
      if (runRef.current !== run) return;
      const pos = positionMs();
      setProgress(Math.min(1, pos / limitMs));
      if (pos >= limitMs || audio.currentTime >= durationSec) {
        finish();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    audio.addEventListener('playing', begin, { once: true });
    audio.play()
      // Some browsers resolve play() without a separate 'playing' event
      .then(begin)
      .catch(() => {
        audio.removeEventListener('playing', begin);
        if (runRef.current === run) runRef.current = null;
        setPlaying(false);
        setFailed(true);
      });
  }, [durationSec, playing, stop]);

  /** Main button: pause while playing, resume when paused, else play from the start. */
  const toggle = useCallback(() => {
    if (playing) {
      const at = Math.min(durationSec, positionMs() / 1000);
      stop();
      setPausedAtSec(at);
    } else if (pausedAtSec !== null) {
      start(pausedAtSec, true);
    } else {
      start(0);
    }
  }, [playing, pausedAtSec, durationSec, start, stop]);

  const label = formatSnippetSec(durationSec);
  const paused = pausedAtSec !== null;

  return (
    <div className="panel-inset" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '12px 14px' }}>
      <button
        onClick={toggle}
        disabled={!ready || failed}
        aria-label={playing ? 'Anhalten' : paused ? 'Weiter abspielen' : `${label} anhören`}
        style={{
          border: 'none', background: 'none', padding: 0, flexShrink: 0, borderRadius: '50%',
          cursor: ready && !failed ? 'pointer' : 'default',
        }}
      >
        <span
          className={`vinyl${playing ? ' spinning' : ''}`}
          style={{
            width: 58, height: 58, display: 'grid', placeItems: 'center',
            boxShadow: playing ? '0 0 22px rgba(214,245,69,0.5)' : '0 0 12px rgba(0,0,0,0.5)',
            opacity: ready || failed ? 1 : 0.5,
          }}
        >
          <span style={{
            width: 24, height: 24, borderRadius: '50%', zIndex: 1,
            background: playing ? 'var(--lime)' : 'var(--cyan)',
            display: 'grid', placeItems: 'center',
          }}>
            <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: '#0b0a12' }}>
              {playing ? (
                <>
                  <rect x="6" y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </>
              ) : (
                <polygon points="6 3 21 12 6 21 6 3" />
              )}
            </svg>
          </span>
        </span>
      </button>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div className="display" style={{ fontSize: '1rem', color: 'var(--ink)' }}>
            {failed
              ? 'Vorschau lädt nicht'
              : !ready ? 'Lädt …'
              : playing ? 'Läuft …'
              : paused ? `Angehalten bei ${formatSnippetSec(Math.round(pausedAtSec * 10) / 10)}`
              : plays === 0 ? `${label} anhören` : `Nochmal ${label}`}
          </div>
          {paused && (
            <button
              onClick={() => start(0)}
              className="btn-ghost"
              style={{ padding: '3px 9px', fontSize: '0.7rem', marginLeft: 'auto', whiteSpace: 'nowrap' }}
            >
              ↺ von vorn
            </button>
          )}
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'rgba(244,241,255,0.08)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{
            height: '100%', width: `${progress * 100}%`, borderRadius: 3,
            background: 'var(--cyan)', boxShadow: '0 0 10px var(--cyan)',
          }} />
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--dim)', marginTop: 5 }}>
          {plays > 0 ? `${plays}× gehört · beliebig oft wiederholbar` : 'für alle derselbe Ausschnitt · beliebig oft wiederholbar'}
        </div>
      </div>
      <VolumeControl
        volume={volume}
        onChange={setVolume}
        onToggleMute={toggleMute}
        disabled={failed}
        accent="var(--cyan)"
      />
    </div>
  );
}
