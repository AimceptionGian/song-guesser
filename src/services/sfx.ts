/**
 * Sound-Design: alle Effekte werden zur Laufzeit mit Web Audio synthetisiert —
 * keine Assets, kein Netzwerk, ~2 KB Code. Jeder Aufruf ist fire-and-forget
 * und schluckt Fehler (z.B. AudioContext vor der ersten User-Geste).
 *
 * Mute-Zustand liegt in localStorage und gilt geräteweit.
 */

const MUTE_KEY = 'songguesser-sfx-muted';

let ctx: AudioContext | null = null;
let mutedCache: boolean | null = null;

function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // Nach Browser-Autoplay-Block: bei der nächsten Geste fortsetzen
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function isSfxMuted(): boolean {
  if (mutedCache === null) {
    try {
      mutedCache = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      mutedCache = false;
    }
  }
  return mutedCache;
}

export function setSfxMuted(muted: boolean): void {
  mutedCache = muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // localStorage nicht verfügbar — Zustand gilt nur für diese Session
  }
}

interface ToneOpts {
  freq: number;
  /** Zielfrequenz für Gleiten (Pitch-Sweep). */
  glideTo?: number;
  /** Startzeit relativ zu jetzt in Sekunden. */
  at?: number;
  dur?: number;
  type?: OscillatorType;
  gain?: number;
}

/** Ein einzelner Ton mit Attack/Release-Hüllkurve. */
function tone({ freq, glideTo, at = 0, dur = 0.15, type = 'sine', gain = 0.2 }: ToneOpts): void {
  const ac = audioCtx();
  if (!ac || isSfxMuted()) return;
  try {
    const t0 = ac.currentTime + at;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch {
    // egal — Sound ist nice-to-have
  }
}

/** Kurzer gefilterter Rausch-Burst (Snare/Applaus-Charakter). */
function noiseBurst({ at = 0, dur = 0.25, gain = 0.12, filterFreq = 2400 }: {
  at?: number; dur?: number; gain?: number; filterFreq?: number;
} = {}): void {
  const ac = audioCtx();
  if (!ac || isSfxMuted()) return;
  try {
    const t0 = ac.currentTime + at;
    const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = ac.createBufferSource();
    src.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(t0);
  } catch {
    // egal
  }
}

export const sfx = {
  /** Leiser UI-Klick für Primäraktionen. */
  click(): void {
    tone({ freq: 640, dur: 0.05, type: 'triangle', gain: 0.1 });
  },

  /** Karte ziehen: Vinyl läuft an — Sweep nach oben + Nadel-Noise. */
  draw(): void {
    tone({ freq: 140, glideTo: 520, dur: 0.4, type: 'sawtooth', gain: 0.08 });
    noiseBurst({ dur: 0.32, gain: 0.05, filterFreq: 3800 });
    tone({ freq: 880, at: 0.34, dur: 0.1, type: 'triangle', gain: 0.1 });
  },

  /** Auflösung: je mehr Punkte, desto grösser das Arpeggio. */
  reveal(points: number): void {
    if (points <= 0) {
      // "Womp": kleine Sekunde abwärts
      tone({ freq: 220, glideTo: 174, dur: 0.32, type: 'sawtooth', gain: 0.1 });
      tone({ freq: 110, glideTo: 87, dur: 0.32, type: 'square', gain: 0.05 });
      return;
    }
    const base = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const notes = base.slice(0, Math.min(points, 4));
    notes.forEach((f, i) => tone({ freq: f, at: i * 0.09, dur: 0.16, type: 'triangle', gain: 0.16 }));
    if (points >= 4) {
      // Perfekte Runde: Oktave obendrauf + Glitzer
      tone({ freq: 1568, at: 0.38, dur: 0.3, type: 'sine', gain: 0.12 });
      noiseBurst({ at: 0.34, dur: 0.35, gain: 0.05, filterFreq: 6800 });
    }
  },

  /** Buzzer-Fenster geht auf: zweitöniger Alarm. */
  buzzerOpen(): void {
    [0, 0.16, 0.32].forEach((at, i) =>
      tone({ freq: i % 2 === 0 ? 660 : 880, at, dur: 0.14, type: 'square', gain: 0.09 }));
  },

  /** Jemand hat gebuzzert. */
  buzz(): void {
    tone({ freq: 196, dur: 0.22, type: 'square', gain: 0.14 });
    tone({ freq: 98, dur: 0.22, type: 'sawtooth', gain: 0.08 });
  },

  /** Countdown-Tick der letzten Sekunden. */
  tick(secondsLeft: number): void {
    tone({ freq: secondsLeft <= 2 ? 1320 : 990, dur: 0.045, type: 'sine', gain: 0.12 });
  },

  /** Neuer Spieler in der Lobby. */
  join(): void {
    tone({ freq: 440, glideTo: 660, dur: 0.14, type: 'triangle', gain: 0.12 });
  },

  /** Sieger-Fanfare fürs Finale. */
  fanfare(): void {
    const melody: Array<[number, number, number]> = [
      // [Frequenz, Start, Dauer]
      [523.25, 0, 0.14], [659.25, 0.13, 0.14], [783.99, 0.26, 0.14],
      [1046.5, 0.4, 0.34], [783.99, 0.62, 0.12], [1046.5, 0.74, 0.5],
    ];
    for (const [freq, at, dur] of melody) {
      tone({ freq, at, dur, type: 'triangle', gain: 0.16 });
      tone({ freq: freq / 2, at, dur, type: 'sine', gain: 0.08 });
    }
    // "Applaus": zwei weiche Rausch-Wellen
    noiseBurst({ at: 0.4, dur: 0.7, gain: 0.045, filterFreq: 3200 });
    noiseBurst({ at: 0.9, dur: 0.9, gain: 0.035, filterFreq: 2600 });
  },
};
