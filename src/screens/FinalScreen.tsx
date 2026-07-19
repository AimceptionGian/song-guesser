import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { sfx } from '../services/sfx';
import type { Player } from '../types';

interface FinalState {
  players: Player[];
  round: number;
  totalRounds: number;
}

const CONFETTI_COLORS = ['#d6f545', '#ff4fa3', '#45e3ff', '#ffd60a', '#8b5cf6'];

interface RecapHighlight {
  emoji: string;
  title: string;
  playerName: string;
  detail: string;
}

/**
 * Wrapped-Recap: kleine Auszeichnungen aus den platzierten Karten.
 * Rein clientseitig berechnet — braucht keine Backend-Änderung.
 */
function computeHighlights(players: Player[]): RecapHighlight[] {
  const stats = players.map((p) => {
    const cards = (p.placedCards ?? []).filter((pc: any) => pc?.song?.year);
    const hits = cards.filter((pc) => pc.isCorrect).length;
    const diffs = cards.map((pc: any) => Math.abs(pc.placedYear - pc.song.year));
    const avgDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : Infinity;
    let best: { title: string; diff: number } | null = null;
    for (const pc of cards as any[]) {
      const diff = Math.abs(pc.placedYear - pc.song.year);
      if (!best || diff < best.diff) best = { title: pc.song.title, diff };
    }
    return { p, total: cards.length, hits, avgDiff, best };
  }).filter((s) => s.total > 0);

  if (stats.length === 0) return [];
  const highlights: RecapHighlight[] = [];

  const timelineBoss = [...stats].sort((a, b) => b.hits / b.total - a.hits / a.total)[0];
  if (timelineBoss.hits > 0) {
    highlights.push({
      emoji: '🎼',
      title: 'Timeline-Boss',
      playerName: timelineBoss.p.name,
      detail: `${timelineBoss.hits}/${timelineBoss.total} Karten richtig einsortiert`,
    });
  }

  const finestEar = [...stats].sort((a, b) => a.avgDiff - b.avgDiff)[0];
  if (finestEar.avgDiff !== Infinity) {
    highlights.push({
      emoji: '📏',
      title: 'Feinstes Gehör',
      playerName: finestEar.p.name,
      detail: `im Schnitt nur ±${Math.round(finestEar.avgDiff)} Jahre daneben`,
    });
  }

  const sniper = [...stats]
    .filter((s) => s.best)
    .sort((a, b) => a.best!.diff - b.best!.diff)[0];
  if (sniper?.best) {
    highlights.push({
      emoji: '🎯',
      title: sniper.best.diff === 0 ? 'Volltreffer' : 'Bester Schuss',
      playerName: sniper.p.name,
      detail: sniper.best.diff === 0
        ? `„${sniper.best.title}" aufs Jahr genau!`
        : `„${sniper.best.title}" nur ±${sniper.best.diff} Jahre daneben`,
    });
  }

  return highlights;
}

export default function FinalScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as FinalState | null;

  // Deterministisch pro Mount, damit das Konfetti nicht bei jedem Render springt
  const confetti = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: (i * 37 + 13) % 100,
        delay: ((i * 53) % 70) / 10,
        duration: 4.5 + ((i * 29) % 40) / 10,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotate: (i * 47) % 360,
      })),
    []
  );

  const highlights = useMemo(
    () => (state ? computeHighlights(state.players) : []),
    [state]
  );

  // Direkter Aufruf ohne State (z.B. Reload auf /final): zurück zum Start.
  // Navigation gehört in einen Effect, nicht in die Render-Phase.
  useEffect(() => {
    if (!state) navigate('/', { replace: true });
  }, [state, navigate]);

  // Sieger-Fanfare — einmal pro Finale
  const fanfarePlayedRef = useRef(false);
  useEffect(() => {
    if (state && !fanfarePlayedRef.current) {
      fanfarePlayedRef.current = true;
      sfx.fanfare();
    }
  }, [state]);

  if (!state) {
    return null;
  }

  const { players } = state;
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  const handlePlayAgain = () => {
    sfx.click();
    navigate('/');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '24px 16px 44px',
        gap: 0,
        justifyContent: 'center',
        position: 'relative',
        zIndex: 1,
        overflow: 'hidden',
      }}
    >
      {/* Konfetti */}
      {confetti.map((c, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${c.left}%`,
            background: c.color,
            animationDelay: `${c.delay}s`,
            animationDuration: `${c.duration}s`,
            transform: `rotate(${c.rotate}deg)`,
          }}
        />
      ))}

      {/* Sieger-Moment */}
      <div className="slam-in" style={{ textAlign: 'center', marginBottom: 'clamp(20px, 5vw, 32px)', position: 'relative' }}>
        <div style={{ fontSize: 'clamp(50px, 13vw, 72px)', marginBottom: 4 }}>🏆</div>
        <div
          className="heading-xl outline-text"
          style={{ WebkitTextStroke: '2px var(--gold)' }}
        >
          Gewinner
        </div>
        <div
          className="display"
          style={{
            fontSize: 'clamp(1.6rem, 7vw, 2.4rem)',
            color: 'var(--ink)',
            marginTop: 10,
            textShadow: '4px 4px 0 rgba(255,79,163,0.45)',
          }}
        >
          {winner?.avatar} {winner?.name}
        </div>
        <div className="serif-note" style={{ fontSize: 'clamp(1.1rem, 4vw, 1.4rem)', color: 'var(--lime)', marginTop: 6 }}>
          {winner?.score} Punkte — was für ein Ohr!
        </div>
      </div>

      {/* Endstand als Charts */}
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
          <span className="display" style={{ fontSize: '0.85rem', color: 'var(--pink)' }}>
            Endstand
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--line)', alignSelf: 'center' }} />
        </div>
        {sorted.map((p, i) => {
          const isGold = i === 0;
          return (
            <div
              key={p.id}
              className="pop-in"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'clamp(8px, 2.5vw, 12px)',
                padding: 'clamp(11px, 3vw, 16px)',
                borderRadius: 16,
                marginBottom: 8,
                background: isGold
                  ? 'linear-gradient(140deg, rgba(255,214,10,0.12), var(--bg-2) 70%)'
                  : 'var(--bg-2)',
                border: isGold
                  ? '1px solid rgba(255,214,10,0.4)'
                  : '1px solid var(--line)',
                transform: isGold ? 'rotate(-0.6deg)' : 'none',
                animationDelay: `${i * 0.12}s`,
              }}
            >
              <span
                className="display"
                style={{
                  fontSize: 'clamp(1.2rem, 4vw, 1.5rem)',
                  width: 36,
                  textAlign: 'center',
                  flexShrink: 0,
                  color: isGold ? 'var(--gold)' : i === 1 ? 'var(--muted)' : 'var(--dim)',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <div
                style={{
                  width: 'clamp(30px, 7vw, 38px)',
                  height: 'clamp(30px, 7vw, 38px)',
                  borderRadius: '50%',
                  background: isGold ? 'rgba(255,214,10,0.16)' : 'rgba(139,92,246,0.18)',
                  border: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'clamp(14px, 4vw, 18px)',
                  flexShrink: 0,
                }}
              >
                {p.avatar}
              </div>
              <span style={{ flex: 1, color: 'var(--ink)', fontWeight: 600, fontSize: 'clamp(0.88rem, 2.5vw, 1rem)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
                {isGold && <span style={{ marginLeft: 6 }}>👑</span>}
              </span>
              <span
                className="display"
                style={{
                  fontSize: 'clamp(1.15rem, 3.5vw, 1.45rem)',
                  color: isGold ? 'var(--gold)' : 'var(--ink)',
                  flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {p.score}
              </span>
            </div>
          );
        })}
      </div>

      {/* Wrapped-Recap: Auszeichnungen aus dem Spielverlauf */}
      {highlights.length > 0 && (
        <div style={{ width: '100%', maxWidth: 400, marginTop: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <span className="display" style={{ fontSize: '0.85rem', color: 'var(--cyan)' }}>
              Euer Recap
            </span>
            <span style={{ flex: 1, height: 1, background: 'var(--line)', alignSelf: 'center' }} />
          </div>
          {highlights.map((h, i) => (
            <div
              key={h.title}
              className="fade-up panel"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                marginBottom: 8,
                animationDelay: `${0.5 + i * 0.15}s`,
                transform: `rotate(${(i % 2 === 0 ? -1 : 1) * 0.5}deg)`,
              }}
            >
              <span style={{ fontSize: 24, flexShrink: 0 }}>{h.emoji}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span className="display" style={{ fontSize: '0.72rem', color: 'var(--lime)', letterSpacing: '0.05em' }}>
                    {h.title}
                  </span>
                  <span style={{ color: 'var(--ink)', fontWeight: 700, fontSize: '0.88rem' }}>{h.playerName}</span>
                </div>
                <div style={{ color: 'var(--muted)', fontSize: '0.78rem', marginTop: 2 }}>{h.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Nochmal spielen */}
      <button
        onClick={handlePlayAgain}
        className="btn-primary fade-up"
        style={{ width: 'auto', marginTop: 20, animationDelay: '0.4s' }}
      >
        ↺ Nochmal spielen
      </button>
    </div>
  );
}
