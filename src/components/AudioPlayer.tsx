import { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  previewUrl?: string;
  songTitle?: string;
  artistName?: string;
  /** False for spectators: transport is remote-controlled, volume stays local. */
  isController?: boolean;
  /** Remote playback state to follow (spectators only). */
  remotePlayback?: { playing: boolean; positionSec: number; updatedAt: number } | null;
  /** Called when the controlling player plays/pauses/seeks. */
  onTransport?: (playing: boolean, positionSec: number) => void;
}

/**
 * Generate a short audio tone blob as fallback when preview URL fails.
 * Creates a simple melody snippet.
 */
function generateFallbackAudio(): string {
  try {
    const sampleRate = 8000;
    const duration = 4;
    const numSamples = sampleRate * duration;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    // Simple recognizable melody: C-E-G-C notes
    const notes = [262, 330, 392, 523]; // C4 E4 G4 C5
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const noteIdx = Math.min(Math.floor(t / (duration / notes.length)), notes.length - 1);
      const freq = notes[noteIdx];
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.25;
      const envelope = Math.max(0, 1 - t / duration);
      view.setInt16(44 + i * 2, Math.round(sample * envelope * 32767), true);
    }

    const blob = new Blob([buffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

// Pre-generate fallback tone once
let cachedFallbackUrl: string | null = null;
function getFallbackUrl(): string {
  if (!cachedFallbackUrl) {
    cachedFallbackUrl = generateFallbackAudio();
  }
  return cachedFallbackUrl;
}

const VOLUME_STORAGE_KEY = 'songguesser-volume';

function loadStoredVolume(): number {
  try {
    const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
    const v = stored === null ? NaN : Number(stored);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8;
  } catch {
    return 0.8;
  }
}

// Deterministische Pseudo-Waveform (gleiche Optik für alle Spieler)
const WAVE_BARS = Array.from({ length: 30 }, (_, i) => {
  const h = 0.3 + 0.7 * Math.abs(Math.sin(i * 2.3) * Math.cos(i * 0.7));
  return Math.round(h * 100) / 100;
});

export default function AudioPlayer({
  previewUrl,
  songTitle,
  artistName,
  isController = true,
  remotePlayback = null,
  onTransport,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasError, setHasError] = useState(false);
  const [volume, setVolume] = useState(loadStoredVolume);
  const lastVolumeRef = useRef(volume > 0 ? volume : 0.8);
  // Spectator: browser blocked autoplay — needs one tap to unlock audio
  const [needsGesture, setNeedsGesture] = useState(false);

  // Use previewUrl if available, otherwise use generated fallback tone
  const effectiveUrl = previewUrl || getFallbackUrl();
  const noAudio = !effectiveUrl;

  // Create or reuse audio element
  useEffect(() => {
    if (!effectiveUrl) {
      setHasError(true);
      return;
    }

    const audio = new Audio(effectiveUrl);
    audio.preload = 'auto';
    audioRef.current = audio;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      setProgress(audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0);
    };

    const onLoadedMetadata = () => {
      setDuration(audio.duration);
      setHasError(false);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };

    const onError = () => {
      setHasError(true);
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audioRef.current = null;
    };
  }, [effectiveUrl]);

  // Apply volume to the (possibly recreated) audio element and persist it
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (volume > 0) lastVolumeRef.current = volume;
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // localStorage unavailable (e.g. private mode) — volume just won't persist
    }
  }, [volume, effectiveUrl]);

  const toggleMute = useCallback(() => {
    setVolume((v) => (v > 0 ? 0 : lastVolumeRef.current));
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Spectators can't control the transport — a tap only unlocks audio
    // when the browser blocked autoplay.
    if (!isController) {
      if (needsGesture && remotePlayback?.playing) {
        audio.play()
          .then(() => { setIsPlaying(true); setNeedsGesture(false); })
          .catch(() => {});
      }
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      onTransport?.(false, audio.currentTime);
    } else {
      setHasError(false);
      audio.play()
        .then(() => {
          setIsPlaying(true);
          onTransport?.(true, audio.currentTime);
        })
        .catch(() => setHasError(true));
    }
  }, [isPlaying, isController, needsGesture, remotePlayback, onTransport]);

  // ─── Spectator: follow the remote playback state ───
  useEffect(() => {
    if (isController || !remotePlayback) return;
    const audio = audioRef.current;
    if (!audio) return;

    if (remotePlayback.playing) {
      // Where the active player's playhead should be right now
      const target = remotePlayback.positionSec + (Date.now() - remotePlayback.updatedAt) / 1000;
      if (isFinite(target) && Math.abs(audio.currentTime - target) > 2.5) {
        audio.currentTime = Math.max(0, target);
      }
      audio.play()
        .then(() => { setIsPlaying(true); setNeedsGesture(false); })
        .catch(() => setNeedsGesture(true));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isController, remotePlayback?.playing, remotePlayback?.positionSec, remotePlayback?.updatedAt, effectiveUrl]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const displayDuration = duration > 0 ? duration : 30;
  const displayCurrent = currentTime > 0 ? currentTime : 0;
  const canInteract = !noAudio && (isController || needsGesture);

  return (
    <div
      className="panel-inset"
      title={songTitle && artistName ? `${artistName} – ${songTitle}` : undefined}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '10px 14px',
        opacity: noAudio ? 0.5 : 1,
      }}
    >
      {/* Vinyl = Play/Pause */}
      <button
        onClick={togglePlay}
        disabled={noAudio || (!isController && !needsGesture)}
        aria-label={isPlaying ? 'Pause' : 'Abspielen'}
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: canInteract ? 'pointer' : 'default',
          flexShrink: 0,
          borderRadius: '50%',
          outlineOffset: 3,
        }}
        title={
          noAudio
            ? 'Keine Vorschau verfügbar'
            : !isController
              ? needsGesture
                ? 'Tippen zum Mithören'
                : 'Der Spieler am Zug steuert die Wiedergabe'
              : isPlaying
                ? 'Pause'
                : 'Vorschau abspielen'
        }
      >
        <span
          className={`vinyl${isPlaying ? ' spinning' : ''}`}
          style={{
            width: 52,
            height: 52,
            display: 'grid',
            placeItems: 'center',
            boxShadow: needsGesture
              ? '0 0 22px rgba(255, 214, 10, 0.7)'
              : isPlaying
                ? '0 0 22px rgba(214, 245, 69, 0.45)'
                : '0 0 12px rgba(0, 0, 0, 0.5)',
            transition: 'box-shadow 0.2s',
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: isPlaying ? 'var(--lime)' : 'var(--pink)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 1,
              transition: 'background 0.2s',
            }}
          >
            {noAudio ? (
              <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, fill: '#0b0a12' }}>
                <path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
              </svg>
            ) : isPlaying ? (
              <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: '#0b0a12' }}>
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, fill: '#0b0a12' }}>
                <polygon points="6 3 21 12 6 21 6 3" />
              </svg>
            )}
          </span>
        </span>
      </button>

      {/* Waveform-Fortschritt (klicken = spulen) */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          flex: 1,
          minWidth: 90,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          cursor: noAudio || !isController ? 'default' : 'pointer',
        }}
        onClick={(e) => {
          if (!audioRef.current || !isController) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          const newPos = pct * (audioRef.current.duration || 30);
          audioRef.current.currentTime = newPos;
          onTransport?.(isPlaying, newPos);
        }}
      >
        {WAVE_BARS.map((h, i) => {
          const filled = (i / WAVE_BARS.length) * 100 < progress;
          return (
            <span
              key={i}
              style={{
                flex: 1,
                height: `${h * 100}%`,
                minWidth: 1,
                borderRadius: 2,
                background: filled
                  ? (isPlaying ? 'var(--lime)' : 'var(--pink)')
                  : 'rgba(244, 241, 255, 0.14)',
                transition: 'background 0.2s',
              }}
            />
          );
        })}
      </div>

      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          color: 'var(--muted)',
          whiteSpace: 'nowrap',
          minWidth: 62,
          textAlign: 'right',
        }}
      >
        {noAudio ? 'Keine Vorschau' : `${formatTime(displayCurrent)} / ${formatTime(displayDuration)}`}
      </span>

      {/* Volume */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <button
          onClick={toggleMute}
          disabled={noAudio}
          title={volume > 0 ? 'Stummschalten' : 'Ton an'}
          style={{
            border: 'none',
            background: 'none',
            padding: 0,
            cursor: noAudio ? 'default' : 'pointer',
            fontSize: 15,
            lineHeight: 1,
          }}
        >
          {volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
        </button>
        <input
          type="range"
          className="volume-slider"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          disabled={noAudio}
          onChange={(e) => setVolume(Number(e.target.value))}
          title={`Lautstärke: ${Math.round(volume * 100)}%`}
          style={{
            width: 74,
            background: `linear-gradient(90deg, var(--lime) 0%, var(--lime) ${volume * 100}%, rgba(214,245,69,0.15) ${volume * 100}%)`,
            cursor: noAudio ? 'default' : 'pointer',
          }}
        />
      </div>
    </div>
  );
}
