import { useRef, useCallback, useState, useMemo, useEffect } from 'react';

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
  coverUrl?: string;
}

const CARD_WIDTH = 84;
const CARD_WIDTH_MIN = 46;
const CARD_GAP = 10;

// Layout cards: one centered row sorted by year, pixel-spaced by card width
// so cards can never overlap (same-year cards simply sit next to each other).
function layoutCards(
  cards: PlacedCardInfo[],
  cardWidth: number,
): (PlacedCardInfo & { offsetPx: number })[] {
  const sorted = [...cards].sort((a, b) => a.year - b.year);
  const n = sorted.length;
  return sorted.map((card, i) => ({
    ...card,
    offsetPx: (i - (n - 1) / 2) * (cardWidth + CARD_GAP),
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

  // Kartenreihe beobachten: auf schmalen Screens schrumpfen die Karten,
  // damit auch 5+ platzierte Karten im Panel bleiben.
  const cardsRowRef = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const el = cardsRowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => setRowWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  const n = placedCards.length;
  const cardWidth = useMemo(() => {
    if (n === 0 || rowWidth === 0) return CARD_WIDTH;
    const fit = Math.floor((rowWidth - (n - 1) * CARD_GAP) / n);
    return Math.max(CARD_WIDTH_MIN, Math.min(CARD_WIDTH, fit));
  }, [n, rowWidth]);
  const laidOutCards = useMemo(
    () => layoutCards(placedCards, cardWidth),
    [placedCards, cardWidth]
  );
  const compact = cardWidth < 64;
  const cardsHeight = 104;

  return (
    <div
      className="timeline-zone panel"
      style={{ padding: '16px 20px 12px' }}
    >
      {/* Kopfzeile: Label + grosses Jahr */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 10 }}
      >
        <span className="mono-label">Timeline · Song platzieren</span>
        <span
          className="display"
          style={{
            fontSize: '1.7rem',
            color: dragging ? 'var(--pink)' : 'var(--lime)',
            transition: 'color 0.15s',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
      </div>

      {/* Platzierte Karten — alle auf gleicher Höhe, gleiche Jahre nebeneinander */}
      <div
        ref={cardsRowRef}
        style={{
          position: 'relative',
          height: cardsHeight,
          marginBottom: 0,
        }}
      >
        {laidOutCards.map((card, i) => {
          return (
            // Wichtig: keine Animations-Klasse auf diesem Wrapper — die
            // popIn-Keyframes würden das inline translateX() überschreiben
            // und alle Karten würden übereinander in der Mitte landen.
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
              {/* Mini-Karte im Cassetten-Look */}
              <div
                className="pop-in"
                style={{
                  width: cardWidth,
                  borderRadius: 10,
                  border: `1px solid ${card.isCorrect ? 'rgba(30,215,96,0.55)' : 'var(--line-strong)'}`,
                  background: 'var(--bg-3)',
                  overflow: 'hidden',
                  boxShadow: '0 6px 16px rgba(0,0,0,0.45)',
                }}
              >
                {card.coverUrl ? (
                  <img
                    src={card.coverUrl}
                    alt=""
                    style={{
                      display: 'block',
                      width: '100%',
                      height: compact ? 36 : 48,
                      objectFit: 'cover',
                      opacity: card.isCorrect ? 1 : 0.9,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      height: compact ? 30 : 36,
                      display: 'grid',
                      placeItems: 'center',
                      background: card.isCorrect
                        ? 'rgba(30,215,96,0.1)'
                        : 'rgba(139,92,246,0.12)',
                    }}
                  >
                    <span style={{ fontSize: compact ? 15 : 18 }}>{card.emoji || '🎵'}</span>
                  </div>
                )}
                <div style={{ padding: '3px 5px', textAlign: 'center' }}>
                  {!compact && (
                    <div style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.6rem',
                      color: 'var(--muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {card.title || ''}
                    </div>
                  )}
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: compact ? '0.64rem' : '0.72rem',
                    color: card.isCorrect ? 'var(--green)' : 'var(--ink)',
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
        className="timeline-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          position: 'relative',
          height: 16,
          borderRadius: 8,
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(244, 241, 255, 0.07)',
          border: '1px solid var(--line-strong)',
          zIndex: 2,
          marginTop: -6,
          touchAction: 'none',
        }}
      >
        {/* Füllung */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${yearToPercent(value)}%`,
            borderRadius: 8,
            background: 'linear-gradient(90deg, var(--violet), var(--pink), var(--lime))',
            pointerEvents: 'none',
          }}
        />

        {/* Dekaden-Ticks im Track */}
        {decadeMarks.map((d) => (
          <div
            key={d}
            style={{
              position: 'absolute',
              top: '20%',
              bottom: '20%',
              left: `${yearToPercent(d)}%`,
              width: 1,
              background: 'rgba(11,10,18,0.5)',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Thumb */}
        <div
          className="timeline-thumb"
          style={{
            position: 'absolute',
            top: '50%',
            left: `${yearToPercent(value)}%`,
            transform: 'translate(-50%, -50%)',
            width: 30,
            height: 30,
            borderRadius: '50%',
            background: 'var(--lime)',
            border: '3px solid #0b0a12',
            boxShadow: dragging
              ? '0 0 0 6px rgba(214,245,69,0.25), 0 0 28px rgba(214,245,69,0.8)'
              : '0 0 0 3px rgba(214,245,69,0.18), 0 0 14px rgba(214,245,69,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'box-shadow 0.15s',
            pointerEvents: 'none',
            zIndex: 3,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#0b0a12' }} />
        </div>

        {/* Live-Position (Zuschauer) */}
        {currentDotYear !== undefined && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: `${yearToPercent(currentDotYear)}%`,
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--pink)',
              border: '2px solid white',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 10px rgba(255,79,163,0.7)',
              pointerEvents: 'none',
              zIndex: 4,
              transition: 'left 0.4s cubic-bezier(.34,1.2,.64,1)',
            }}
          />
        )}
      </div>

      {/* Dekaden-Beschriftung */}
      <div style={{ position: 'relative', height: 26, marginTop: 6 }}>
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
            <div style={{ width: 1, height: 5, background: 'var(--line-strong)' }} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                color: 'var(--dim)',
                marginTop: 2,
              }}
            >
              {`'${String(d).slice(2)}`}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          textAlign: 'center',
          padding: 6,
          color: dragging ? 'var(--lime)' : 'var(--dim)',
          fontSize: '0.72rem',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {dragging ? '● Loslassen zum Platzieren' : 'Regler ziehen oder Timeline antippen'}
      </div>
    </div>
  );
}
