import { Player } from '../types';

interface ScoreboardProps {
  players: Player[];
  currentRound: number;
  totalRounds: number;
}

export default function Scoreboard({ players, currentRound, totalRounds }: ScoreboardProps) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div
      style={{
        borderRadius: 16,
        padding: 16,
        background: '#13121f',
        border: '1px solid rgba(168,85,247,0.2)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f0eeff', fontWeight: 600, fontSize: '0.9rem' }}>
          🏆 Rangliste
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#8b7fb8', fontSize: '0.78rem' }}>
          Runde {currentRound}/{totalRounds}
        </span>
      </div>
      {sorted.map((p, i) => (
        <div
          key={p.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 10,
            marginBottom: 6,
            background: i === 0 ? 'rgba(255,214,10,0.08)' : 'rgba(168,85,247,0.05)',
            border: i === 0 ? '1px solid rgba(255,214,10,0.2)' : '1px solid transparent',
          }}
        >
          <span
            style={{
              width: 20,
              textAlign: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              color: i === 0 ? '#ffd60a' : '#8b7fb8',
              fontWeight: 600,
            }}
          >
            {i + 1}
          </span>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(168,85,247,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
            }}
          >
            {p.avatar}
          </div>
          <span style={{ flex: 1, color: '#f0eeff', fontWeight: 500, fontSize: '0.9rem' }}>
            {p.name}
          </span>
          <span
            style={{
              fontFamily: "'Bebas Neue', sans-serif",
              fontSize: '1.25rem',
              color: '#a855f7',
            }}
          >
            {p.score}
          </span>
        </div>
      ))}
    </div>
  );
}