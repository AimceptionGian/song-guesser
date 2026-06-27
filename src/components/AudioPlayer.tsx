import { useRef, useState, useEffect, useCallback } from 'react';

interface AudioPlayerProps {
  previewUrl?: string;
  songTitle?: string;
  artistName?: string;
}

export default function AudioPlayer({ previewUrl, songTitle, artistName }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [hasError, setHasError] = useState(false);

  // Create or reuse audio element
  useEffect(() => {
    if (!previewUrl) {
      setHasError(true);
      return;
    }

    const audio = new Audio(previewUrl);
    audio.preload = 'metadata';
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
  }, [previewUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      setHasError(false);
      audio.play()
        .then(() => setIsPlaying(true))
        .catch(() => setHasError(true));
    }
  }, [isPlaying]);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const displayDuration = duration > 0 ? duration : 30;
  const displayCurrent = currentTime > 0 ? currentTime : 0;

  return (
    <div
      title={songTitle && artistName ? `${artistName} – ${songTitle}` : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(168,85,247,0.06)',
        border: '1px solid rgba(168,85,247,0.15)',
        opacity: previewUrl ? 1 : 0.5,
      }}
    >
      <button
        onClick={togglePlay}
        disabled={!previewUrl || hasError}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: 'none',
          cursor: !previewUrl || hasError ? 'default' : 'pointer',
          background: isPlaying
            ? 'linear-gradient(135deg, #a855f7, #f72585)'
            : 'linear-gradient(135deg, #7c3aed, #a855f7)',
          boxShadow: isPlaying
            ? '0 0 24px rgba(247,37,133,0.5)'
            : '0 0 16px rgba(168,85,247,0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 0.15s, box-shadow 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          if (previewUrl && !hasError) {
            e.currentTarget.style.transform = 'scale(1.08)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
        title={
          hasError
            ? 'Keine Vorschau verfügbar'
            : isPlaying
              ? 'Pause'
              : 'Vorschau abspielen'
        }
      >
        {hasError ? (
          <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'white' }}>
            <path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
          </svg>
        ) : isPlaying ? (
          <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'white' }}>
            <rect x="6" y="4" width="4" height="16" />
            <rect x="14" y="4" width="4" height="16" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, fill: 'white' }}>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        )}
      </button>

      <div
        style={{
          flex: 1,
          height: 5,
          borderRadius: 3,
          background: 'rgba(168,85,247,0.15)',
          overflow: 'hidden',
          cursor: previewUrl ? 'pointer' : 'default',
        }}
        onClick={(e) => {
          if (!audioRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          audioRef.current.currentTime = pct * (audioRef.current.duration || 30);
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${progress}%`,
            background: isPlaying
              ? 'linear-gradient(90deg, #a855f7, #f72585)'
              : 'linear-gradient(90deg, #7c3aed, #a855f7)',
            borderRadius: 3,
            transition: 'width 0.25s linear',
          }}
        />
      </div>

      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.75rem',
          color: '#8b7fb8',
          whiteSpace: 'nowrap',
          minWidth: 60,
          textAlign: 'right',
        }}
      >
        {hasError ? 'Keine Vorschau' : `${formatTime(displayCurrent)} / ${formatTime(displayDuration)}`}
      </span>
    </div>
  );
}