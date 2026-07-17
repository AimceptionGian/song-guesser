import { useRef, useCallback, useState, useMemo } from 'react';

export interface TimelineHandle {
  year: number;
  setYear: (y: number) => void;
}

interface TimelineProps {
  minYear: number;
  maxYear: number;
  value: number;
  onChange: (year: number) => void;
  placedCards?: PlacedCardInfo[];
  currentDotYear?: number;
}

export interface PlacedCardInfo {
  year: number;
  isCorrect: boolean;
  emoji?: string;
  title?: string;
}

const CARD_WIDTH = 84;
const CARD_GAP = 10;

// Layout cards: one centered row sorted by year, pixel-spaced by card width
// so cards can never overlap (same-year cards simply sit next to each other).
function layoutCards(cards: PlacedCardInfo[]): (PlacedCardInfo & { offsetPx: number })[] {
  const sorted = [...cards].sort((a, b) => a.year - b.year);
  const n = sorted.length;
  return sorted.map((card, i) => ({
    ...card,
    offsetPx: (i - (n - 1) / 2) * (CARD_WIDTH + CARD_GAP),
  }));
}

export default function Timeline({
  minYear,
  maxYear,
  value,
  onChange,
  placedCards = [],
  currentDotYear,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const decadeMarks = [];
  for (let d = Math.ceil(minYear / 10) * 10; d <= maxYear; d += 10) {
    decadeMarks.push(d);
  }

  const yearToPercent = useCallback(
    (year: number) => ((year - minYear) / (maxYear - minYear)) * 100,
    [minYear, maxYear]
  );

  const percentToYear = useCallback(
    (pct: number) => Math.round(minYear + (pct / 100) * (maxYear - minYear)),
    [minYear, maxYear]
  );

  const handlePointer = useCallback(
    (clientX: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      onChange(percentToYear(pct));
    },
    [onChange, percentToYear]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      handlePointer(e.clientX);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [handlePointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragging) handlePointer(e.clientX);
    },
    [dragging, handlePointer]
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Layout cards: evenly spaced, centered on timeline
  const laidOutCards = useMemo(() => layoutCards(placedCards), [placedCards]);
  const cardsHeight = 100;

  return (
    <div
      className="timeline-zone"
      style={{
        background: 'rgba(18,17,31,0.6)',
        border: '1px solid rgba(168,85,247,0.2)',
        borderRadius: 16,
        padding: '16px 20px 12px',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: '0.72rem',
            color: '#8b7fb8',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          📅 Song auf der Timeline platzieren
        </span>
        <span
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: '1.3rem',
            color: '#a855f7',
          }}
        >
          {value}
        </span>
      </div>

      {/* Placed cards — all at same Y, same-year cards side by side */}
      <div
        style={{
          position: 'relative',
          height: cardsHeight,
          marginBottom: 0,
        }}
      >
        {laidOutCards.map((card, i) => {
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                transform: `translateX(calc(-50% + ${card.offsetPx}px))`,
                top: 8,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 2,
              }}
            >
              {/* Mini card with year */}
              <div
                style={{
                  width: CARD_WIDTH,
                  borderRadius: 8,
                  border: `1px solid ${card.isCorrect ? 'rgba(6,214,160,0.5)' : 'rgba(168,85,247,0.35)'}`,
                  background: '#13121f',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: 36,
                    display: 'grid',
                    placeItems: 'center',
                    background: card.isCorrect
                      ? 'rgba(6,214,160,0.08)'
                      : 'rgba(168,85,247,0.08)',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{card.emoji || '🎵'}</span>
                </div>
                <div style={{ padding: '3px 5px', textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.62rem',
                    color: '#8b7fb8',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {card.title || ''}
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.72rem',
                    color: card.isCorrect ? '#06d6a0' : '#a855f7',
                    fontWeight: 600,
                  }}>
                    {card.year}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          position: 'relative',
          height: 14,
          borderRadius: 7,
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(168,85,247,0.15)',
          border: '1px solid rgba(168,85,247,0.3)',
          zIndex: 2,
          marginTop: -6,
          touchAction: 'none',
        }}
      >
        {/* Fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${yearToPercent(value)}%`,
            borderRadius: 7,
            background: 'linear-gradient(90deg, #7c3aed, #a855f7)',
            pointerEvents: 'none',
          }}
        />

        {/* Thumb */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${yearToPercent(value)}%`,
            transform: 'translate(-50%, -50%)',
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: '#a855f7',
            boxShadow: dragging
              ? '0 0 28px rgba(168,85,247,1)'
              : '0 0 16px rgba(168,85,247,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'box-shadow 0.15s',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'white' }} />
        </div>

        {/* Current dot */}
        {currentDotYear !== undefined && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${yearToPercent(currentDotYear)}%`,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: '#f72585',
              border: '2px solid white',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 10px rgba(247,37,133,0.6)',
              pointerEvents: 'none',
              zIndex: 4,
              transition: 'left 0.4s cubic-bezier(.34,1.2,.64,1)',
            }}
          />
        )}
      </div>

      {/* Decade marks */}
      <div style={{ position: 'relative', height: 26, marginTop: 4 }}>
        {decadeMarks.map((d) => (
          <div
            key={d}
            style={{
              position: 'absolute',
              left: `${yearToPercent(d)}%`,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div style={{ width: 1, height: 5, background: 'rgba(168,85,247,0.35)' }} />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.6rem',
                color: '#6a5f8a',
                marginTop: 2,
              }}
            >
              {d}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          textAlign: 'center',
          padding: 6,
          color: dragging ? '#a855f7' : '#6a5f8a',
          fontSize: '0.75rem',
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {dragging ? '🎯 Loslassen zum Platzieren' : '↕ Ziehe den Regler oder klicke auf die Timeline'}
      </div>
    </div>
  );
}