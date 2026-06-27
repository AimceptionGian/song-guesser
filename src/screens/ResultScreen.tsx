import { useLocation, useNavigate } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard';
import type { Song, Player } from '../types';

interface ResultState {
  song: Song;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearDiff: number;
  points: number;
  players: Player[];
  round: number;
  totalRounds: number;
  currentPlayerIndex: number;
  gameCode: string;
}

export default function ResultScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ResultState | null;

  if (!state) {
    navigate('/');
    return null;
  }

  const {
    song,
    guessedArtist,
    guessedTitle,
    guessedYear,
    artistCorrect,
    titleCorrect,
    yearDiff,
    points,
    players,
    round,
    totalRounds,
    currentPlayerIndex,
    gameCode,
  } = state;

  const isLastRound = round >= totalRounds;
  const isLastPlayer = currentPlayerIndex >= players.length - 1;
  const isGameOver = isLastRound && isLastPlayer;

  const handleContinue = () => {
    if (isGameOver) {
      navigate('/final', { state: { players, round, totalRounds, gameCode } });
    } else {
      navigate('/game/' + gameCode, { state: { players, round: isLastPlayer ? round + 1 : round, currentPlayerIndex: isLastPlayer ? 0 : currentPlayerIndex + 1, gameCode } });
    }
  };

  const yearDiffLabel = yearDiff === 0 ? 'Exakt!' : yearDiff <= 3 ? 'Sehr nah!' : yearDiff <= 10 ? 'Nah dran' : 'Daneben';
  const yearDiffClass = yearDiff === 0 ? '#06d6a0' : yearDiff <= 3 ? '#ffd60a' : '#ff4d6d';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '24px 16px 40px',
        gap: 0,
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            maxWidth: 480,
            marginBottom: 16,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              background: 'rgba(168,85,247,0.12)',
              border: '1px solid rgba(168,85,247,0.25)',
              color: '#a855f7',
            }}
          >
            Karte {round} / {totalRounds}
          </span>
          <span
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.78rem',
              background: 'rgba(6,214,160,0.1)',
              border: '1px solid rgba(6,214,160,0.2)',
              color: '#06d6a0',
            }}
          >
            Auswertung
          </span>
        </div>

        {/* Result card */}
        <div
          className="pop-in"
          style={{
            borderRadius: 16,
            padding: 20,
            background: 'linear-gradient(135deg, #1e1c2e 0%, #13121f 100%)',
            border: '1px solid rgba(168,85,247,0.25)',
            boxShadow: '0 0 60px rgba(168,85,247,0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Points */}
          <div style={{ textAlign: 'center', marginBottom: 4 }}>
            <div
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: 'clamp(3rem, 12vw, 4.5rem)',
                lineHeight: 1,
                color: points > 0 ? '#06d6a0' : '#ff4d6d',
                textShadow: points > 0 ? '0 0 40px rgba(6,214,160,0.6)' : '0 0 40px rgba(255,77,109,0.5)',
              }}
            >
              {points > 0 ? `+${points}` : '0'}
            </div>
            <div style={{ color: '#8b7fb8', fontSize: '0.82rem', marginTop: 4 }}>Punkte</div>
          </div>

          {/* Artist */}
          <ResultRow
            label="🎤 Interpret"
            guess={guessedArtist}
            correct={song.artist}
            isCorrect={artistCorrect}
          />

          {/* Title */}
          <ResultRow
            label="🎶 Songtitel"
            guess={guessedTitle}
            correct={song.title}
            isCorrect={titleCorrect}
          />

          {/* Year */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: '#8b7fb8', fontSize: '0.82rem', width: 90 }}>📅 Jahr</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              {guessedYear ? (
                <>
                  <span style={{ color: '#ff4d6d', fontSize: '0.9rem', textDecoration: 'line-through' }}>
                    {guessedYear}
                  </span>
                  <span style={{ color: '#8b7fb8' }}>→</span>
                  <span style={{ color: '#a855f7', fontSize: '0.9rem' }}>{song.year}</span>
                </>
              ) : (
                <span style={{ color: '#ff4d6d', fontSize: '0.9rem' }}>—</span>
              )}
            </div>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '0.78rem',
                color: yearDiffClass,
              }}
            >
              {yearDiff > 0 ? `±${yearDiff} · ${yearDiffLabel}` : yearDiffLabel}
            </span>
          </div>

          {/* Song Reveal */}
          <div
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(168,85,247,0.08)',
              border: '1px solid rgba(168,85,247,0.15)',
              textAlign: 'center',
              marginTop: 4,
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 4 }}>{song.emoji}</div>
            <div
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                fontSize: '1.5rem',
                background: 'linear-gradient(90deg, #a855f7, #f72585)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {song.artist} — {song.title}
            </div>
            <div style={{ color: '#8b7fb8', fontSize: '0.8rem', marginTop: 2 }}>{song.genre} · {song.year}</div>
          </div>
        </div>

        {/* Scoreboard */}
        <div style={{ marginTop: 16 }}>
          <Scoreboard players={players} currentRound={round} totalRounds={totalRounds} />
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="fade-up"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            width: '100%',
            padding: '18px 24px',
            borderRadius: 16,
            border: 'none',
            cursor: 'pointer',
            background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #f72585 100%)',
            color: 'white',
            fontWeight: 700,
            fontSize: '1.05rem',
            letterSpacing: '0.02em',
            boxShadow: '0 0 40px rgba(168,85,247,0.4)',
            marginTop: 16,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.03)';
            e.currentTarget.style.boxShadow = '0 0 55px rgba(168,85,247,0.55)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.boxShadow = '0 0 40px rgba(168,85,247,0.4)';
          }}
        >
          {isGameOver ? '🏆 Zum Finale' : 'Weiter ›'}
        </button>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  guess,
  correct,
  isCorrect,
}: {
  label: string;
  guess: string;
  correct: string;
  isCorrect: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ color: '#8b7fb8', fontSize: '0.82rem', width: 90 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
        {guess ? (
          <>
            <span
              style={{
                color: isCorrect ? '#06d6a0' : '#ff4d6d',
                fontSize: '0.9rem',
                textDecoration: isCorrect ? 'none' : 'line-through',
              }}
            >
              {guess}
            </span>
            {!isCorrect && (
              <>
                <span style={{ color: '#8b7fb8' }}>→</span>
                <span style={{ color: '#a855f7', fontSize: '0.9rem' }}>{correct}</span>
              </>
            )}
          </>
        ) : (
          <span style={{ color: '#ff4d6d', fontSize: '0.9rem' }}>—</span>
        )}
      </div>
      <span style={{ fontSize: '1rem' }}>{isCorrect ? '✅' : '❌'}</span>
    </div>
  );
}
