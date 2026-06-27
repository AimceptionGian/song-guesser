import { useLocation, useNavigate } from 'react-router-dom';
import type { Player } from '../types';

interface FinalState {
  players: Player[];
  round: number;
  totalRounds: number;
}

export default function FinalScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as FinalState | null;

  if (!state) {
    navigate('/');
    return null;
  }

  const { players } = state;
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];

  const handlePlayAgain = () => {
    navigate('/');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '24px 16px 40px',
        gap: 0,
        justifyContent: 'center',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* Winner announcement */}
      <div className="pop-in" style={{ textAlign: 'center', marginBottom: 'clamp(16px, 4vw, 24px)' }}>
        <div style={{ fontSize: 'clamp(48px, 12vw, 64px)', display: 'block', marginBottom: 8 }}>🏆</div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(2rem, 8vw, 3rem)',
            color: '#ffd60a',
            textShadow: '0 0 40px rgba(255,214,10,0.6)',
          }}
        >
          GEWINNER
        </div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(1.4rem, 6vw, 2rem)',
            color: '#f0eeff',
            marginTop: 8,
          }}
        >
          {winner?.avatar} {winner?.name}
        </div>
        <div
          style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(1.1rem, 4vw, 1.5rem)',
            color: '#a855f7',
            marginTop: 4,
          }}
        >
          {winner?.score} Punkte
        </div>
      </div>

      {/* Ranking */}
      <div style={{ width: '100%', maxWidth: 400 }}>
        {sorted.map((p, i) => {
          const medals = ['🥇', '🥈', '🥉'];
          const isGold = i === 0;
          return (
            <div
              key={p.id}
              className="pop-in"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'clamp(8px, 2.5vw, 12px)',
                padding: 'clamp(10px, 3vw, 16px)',
                borderRadius: 12,
                marginBottom: 8,
                background: isGold
                  ? 'rgba(255,214,10,0.1)'
                  : '#13121f',
                border: isGold
                  ? '1px solid rgba(255,214,10,0.3)'
                  : '1px solid rgba(168,85,247,0.15)',
                animationDelay: `${i * 0.1}s`,
              }}
            >
              <span
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'clamp(1.2rem, 4vw, 1.5rem)',
                  width: 28,
                  textAlign: 'center',
                  flexShrink: 0,
                  color: isGold ? '#ffd60a' : i === 1 ? '#c0c0c0' : '#8b7fb8',
                }}
              >
                {medals[i] || `#${i + 1}`}
              </span>
              <div
                style={{
                  width: 'clamp(28px, 7vw, 36px)',
                  height: 'clamp(28px, 7vw, 36px)',
                  borderRadius: '50%',
                  background: 'rgba(168,85,247,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'clamp(14px, 4vw, 18px)',
                  flexShrink: 0,
                }}
              >
                {p.avatar}
              </div>
              <span style={{ flex: 1, color: '#f0eeff', fontWeight: 600, fontSize: 'clamp(0.85rem, 2.5vw, 1rem)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'clamp(1.1rem, 3.5vw, 1.4rem)',
                  color: '#a855f7',
                  flexShrink: 0,
                }}
              >
                {p.score}
              </span>
            </div>
          );
        })}
      </div>

      {/* Play Again */}
      <button
        onClick={handlePlayAgain}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 28px',
          borderRadius: 12,
          background: 'rgba(168,85,247,0.12)',
          border: '1px solid rgba(168,85,247,0.28)',
          color: '#c4b8ff',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '0.95rem',
          marginTop: 12,
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(168,85,247,0.22)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(168,85,247,0.12)';
        }}
      >
        ↺ Nochmal spielen
      </button>
    </div>
  );
}
