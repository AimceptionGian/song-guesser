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

  // A new stage (longer snippet) starts fresh
  useEffect(() => {
    setPlays(0);
    setProgress(0);
  }, [durationSec]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || playing) return;
    audio.pause();
    audio.currentTime = 0;
    setProgress(0);
    setPlaying(true);
    setPlays((n) => n + 1);

    const limitMs = durationSec * 1000;
    let startedAt: number | null = null;
    const onPlaying = () => { startedAt = performance.now(); };
    audio.addEventListener('playing', onPlaying, { once: true });

    const tick = () => {
      const elapsedMs = startedAt === null ? 0 : performance.now() - startedAt;
      setProgress(Math.min(1, elapsedMs / limitMs));
      if (startedAt !== null && (elapsedMs >= limitMs || audio.currentTime >= durationSec)) {
        stop();
        setProgress(1);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    audio.play()
      .then(() => {
        // Some browsers resolve play() without a separate 'playing' event
        startedAt ??= performance.now();
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        audio.removeEventListener('playing', onPlaying);
        setPlaying(false);
        setFailed(true);
      });
  }, [durationSec, playing, stop]);

  const label = formatSnippetSec(durationSec);

  return (
    <div className="panel-inset" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '12px 14px' }}>
      <button
        onClick={play}
        disabled={!ready || playing || failed}
        aria-label={`${label} anhören`}
        style={{
          border: 'none', background: 'none', padding: 0, flexShrink: 0, borderRadius: '50%',
          cursor: ready && !playing && !failed ? 'pointer' : 'default',
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
              <polygon points="6 3 21 12 6 21 6 3" />
            </svg>
          </span>
        </span>
      </button>
      <div style={{ flex: 1, minWidth: 150 }}>
        <div className="display" style={{ fontSize: '1rem', color: 'var(--ink)' }}>
          {failed ? 'Vorschau lädt nicht' : !ready ? 'Lädt …' : playing ? 'Läuft …' : plays === 0 ? `${label} anhören` : `Nochmal ${label}`}
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
