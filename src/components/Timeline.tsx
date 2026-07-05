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

// Collision resolution: assign each card to a row so cards don't overlap
function assignRows(cards: PlacedCardInfo[]): PlacedCardInfo[] {
  const sorted = [...cards].sort((a, b) => a.year - b.year);
  const rows: number[] = []; // midpoints of each occupied row (in year-space)
  const assigned = sorted.map((card) => {
    // Find first row that doesn't overlap (±6 years from any card in that row)
    let rowIdx = 0;
    for (; rowIdx < rows.length; rowIdx++) {
      if (Math.abs(card.year - rows[rowIdx]) > 7) break;
    }
    if (rowIdx >= rows.length) rows.push(card.year);
    else rows[rowIdx] = card.year;
    return { ...card, _row: rowIdx };
  });
  return assigned as any;
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

  // Assign cards to rows to prevent visual overlap
  const rowCards = useMemo(() => assignRows(placedCards), [placedCards]);
  const rowCount = rowCards.length > 0 ? Math.max(...rowCards.map((c: any) => c._row)) + 1 : 0;
  const cardsHeight = rowCount * 72 + 16;

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

      {/* Placed cards — grid layout with stem lines to exact year */}
      <div
        style={{
          position: 'relative',
          height: cardsHeight,
          marginBottom: 0,
        }}
      >
        {(rowCards as any[]).map((card: any, i: number) => {
          const left = yearToPercent(card.year);
          // Each row is ~66px tall, cards sit at their row
          const cardTop = rowCount > 1 ? (card._row / (rowCount - 1)) * 50 : 0;
          const stemHeight = Math.max(8, 56 - cardTop);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${left}%`,
                transform: 'translateX(-50%)',
                top: cardTop,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                zIndex: 2,
              }}
            >
              {/* Mini card with year */}
              <div
                style={{
                  width: 62,
                  borderRadius: 8,
                  border: `1px solid ${card.isCorrect ? 'rgba(6,214,160,0.5)' : 'rgba(168,85,247,0.35)'}`,
                  background: '#13121f',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: 26,
                    display: 'grid',
                    placeItems: 'center',
                    background: card.isCorrect
                      ? 'rgba(6,214,160,0.08)'
                      : 'rgba(168,85,247,0.08)',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{card.emoji || '🎵'}</span>
                </div>
                <div style={{ padding: '2px 4px', textAlign: 'center' }}>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.5rem',
                    color: '#8b7fb8',
                  }}>
                    {card.title ? card.title.substring(0, 10) : ''}
                  </div>
                  <div style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: '0.55rem',
                    color: card.isCorrect ? '#06d6a0' : '#a855f7',
                    fontWeight: 600,
                  }}>
                    {card.year}
                  </div>
                </div>
              </div>
              {/* Stem line + dot */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    width: 1,
                    height: stemHeight,
                    background: card.isCorrect
                      ? 'rgba(6,214,160,0.35)'
                      : 'rgba(168,85,247,0.3)',
                  }}
                />
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: card.isCorrect ? '#06d6a0' : '#a855f7',
                    boxShadow: card.isCorrect
                      ? '0 0 6px rgba(6,214,160,0.5)'
                      : '0 0 6px rgba(168,85,247,0.5)',
                  }}
                />
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