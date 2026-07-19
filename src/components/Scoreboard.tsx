import { Player } from '../types';

interface ScoreboardProps {
  players: Player[];
  currentRound: number;
  totalRounds: number;
}

/** Rangliste im "Charts"-Look: grosse Platznummern, Leader hervorgehoben. */
export default function Scoreboard({ players, currentRound, totalRounds }: ScoreboardProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="panel" style={{ padding: '16px 16px 10px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 8,
        }}
      >
        <span className="display" style={{ fontSize: '0.95rem', letterSpacing: '0.04em' }}>
          Charts
        </span>
        <span className="mono-label">Runde {currentRound}/{totalRounds}</span>
      </div>
      {sorted.map((p, i) => {
        const leader = i === 0 && p.score > 0;
        return (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '9px 12px',
              borderRadius: 12,
              marginBottom: 6,
              background: leader ? 'rgba(214,245,69,0.07)' : 'transparent',
              border: leader ? '1px solid rgba(214,245,69,0.25)' : '1px solid transparent',
            }}
          >
            <span
              className="display"
              style={{
                width: 30,
                textAlign: 'center',
                fontSize: '1.1rem',
                color: leader ? 'var(--lime)' : 'var(--dim)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: leader ? 'rgba(214,245,69,0.15)' : 'rgba(139,92,246,0.18)',
                border: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              {p.avatar}
            </div>
            <span
              style={{
                flex: 1,
                color: 'var(--ink)',
                fontWeight: 600,
                fontSize: '0.92rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {p.name}
              {leader && <span style={{ marginLeft: 6 }}>👑</span>}
            </span>
            <span
              className="display"
              style={{
                fontSize: '1.25rem',
                color: leader ? 'var(--lime)' : 'var(--ink)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {p.score}
            </span>
          </div>
        );
      })}
    </div>
  );
}
