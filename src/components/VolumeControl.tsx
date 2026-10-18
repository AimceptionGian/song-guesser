import { useCallback, useEffect, useRef, useState } from 'react';

// One volume for every player component, remembered per browser
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

/**
 * Volume state that persists across reloads and is shared by AudioPlayer
 * and SnippetPlayer. `toggleMute` restores the last audible volume.
 */
export function useStoredVolume() {
  const [volume, setVolume] = useState(loadStoredVolume);
  const lastVolumeRef = useRef(volume > 0 ? volume : 0.8);

  useEffect(() => {
    if (volume > 0) lastVolumeRef.current = volume;
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // localStorage unavailable (e.g. private mode) — volume just won't persist
    }
  }, [volume]);

  const toggleMute = useCallback(() => {
    setVolume((v) => (v > 0 ? 0 : lastVolumeRef.current));
  }, []);

  return { volume, setVolume, toggleMute };
}

interface VolumeControlProps {
  volume: number;
  onChange: (volume: number) => void;
  onToggleMute: () => void;
  disabled?: boolean;
  /** Fill colour of the slider track. */
  accent?: string;
}

/** Mute button + slider, as used in the players' transport rows. */
export default function VolumeControl({
  volume, onChange, onToggleMute, disabled = false, accent = 'var(--lime)',
}: VolumeControlProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <button
        onClick={onToggleMute}
        disabled={disabled}
        title={volume > 0 ? 'Stummschalten' : 'Ton an'}
        style={{
          border: 'none',
          background: 'none',
          padding: 0,
          cursor: disabled ? 'default' : 'pointer',
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        title={`Lautstärke: ${Math.round(volume * 100)}%`}
        aria-label="Lautstärke"
        style={{
          width: 74,
          background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${volume * 100}%, color-mix(in srgb, ${accent} 15%, transparent) ${volume * 100}%)`,
          cursor: disabled ? 'default' : 'pointer',
        }}
      />
    </div>
  );
}
