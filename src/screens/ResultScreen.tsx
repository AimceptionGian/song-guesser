import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Scoreboard from '../components/Scoreboard';
import { api, getLobbySession } from '../services/api-client';
import type { Song, Player } from '../types';

interface ResultState {
  song: Song;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearExact: boolean;
  timelineCorrect: boolean;
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

  const [resolving, setResolving] = useState(false);

  // Direkter Aufruf ohne State (z.B. Reload auf /result): zurück zum Start.
  // Navigation gehört in einen Effect, nicht in die Render-Phase.
  useEffect(() => {
    if (!state) navigate('/', { replace: true });
  }, [state, navigate]);

  if (!state) {
    return null;
  }

  const {
    song,
    guessedArtist,
    guessedTitle,
    guessedYear,
    artistCorrect,
    titleCorrect,
    yearExact,
    timelineCorrect,
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

  const handleContinue = async () => {
    if (resolving) return;
    setResolving(true);
    // Tell the server the reveal is done — only now does the turn advance
    // for everyone (spectators stay on the reveal until this).
    try {
      const session = getLobbySession();
      await api.resolveTurn(gameCode, session?.code === gameCode ? session.playerId : undefined);
    } catch {
      // e.g. already resolved — navigation below still applies
    }
    if (isGameOver) {
      navigate('/final', { state: { players, round, totalRounds, gameCode } });
    } else {
      navigate('/game/' + gameCode, { state: { players, round: isLastPlayer ? round + 1 : round, currentPlayerIndex: isLastPlayer ? 0 : currentPlayerIndex + 1, gameCode } });
    }
  };

  const yearDiffLabel = yearDiff === 0 ? 'Exakt!' : yearDiff <= 3 ? 'Sehr nah!' : yearDiff <= 10 ? 'Nah dran' : 'Daneben';
  const yearDiffColor = yearDiff === 0 ? 'var(--green)' : yearDiff <= 3 ? 'var(--gold)' : 'var(--red)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '24px 16px 44px',
        gap: 0,
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        {/* Kopfzeile */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            marginBottom: 18,
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span className="display" style={{ fontSize: '0.9rem' }}>
            Track <span style={{ color: 'var(--lime)' }}>{String(round).padStart(2, '0')}</span>
            <span style={{ color: 'var(--dim)' }}>/{String(totalRounds).padStart(2, '0')}</span>
          </span>
          <span className="sticker cyan tilt-r">Auswertung</span>
        </div>

        {/* Der grosse Wrapped-Moment: die Punktzahl */}
        <div className="slam-in" style={{ textAlign: 'center', margin: '10px 0 22px' }}>
          <div
            className="display"
            style={{
              fontSize: 'clamp(4.5rem, 24vw, 8rem)',
              lineHeight: 0.9,
              color: points > 0 ? 'var(--lime)' : 'var(--red)',
              textShadow: points > 0
                ? '6px 6px 0 rgba(255,79,163,0.5)'
                : '6px 6px 0 rgba(139,92,246,0.4)',
            }}
          >
            {points > 0 ? `+${points}` : '0'}
          </div>
          <div className="serif-note" style={{ color: 'var(--muted)', fontSize: '1.15rem', marginTop: 6 }}>
            {points >= 4 ? 'Perfekte Runde — alles richtig!' : points > 0 ? 'Punkte für dich' : 'diesmal leider nichts …'}
          </div>
        </div>

        {/* Ergebnis-Panel */}
        <div
          className="pop-in panel"
          style={{
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* Punkte-Breakdown: 4×1 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
            }}
          >
            <BreakdownItem label="🎤 Interpret" ok={artistCorrect} />
            <BreakdownItem label="🎶 Songtitel" ok={titleCorrect} />
            <BreakdownItem label="📅 Exaktes Jahr" ok={yearExact} />
            <BreakdownItem label="📊 Timeline" ok={timelineCorrect} />
          </div>

          {/* Jahres-Detail */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono-label" style={{ width: 90 }}>📅 Jahr</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
              {guessedYear ? (
                yearExact ? (
                  <span style={{ color: 'var(--green)', fontSize: '0.95rem', fontWeight: 700 }}>
                    {guessedYear} ✓
                  </span>
                ) : (
                  <>
                    <span style={{ color: 'var(--red)', fontSize: '0.95rem', textDecoration: 'line-through' }}>
                      {guessedYear}
                    </span>
                    <span style={{ color: 'var(--dim)' }}>→</span>
                    <span style={{ color: 'var(--lime)', fontSize: '0.95rem', fontWeight: 700 }}>{song.year}</span>
                  </>
                )
              ) : (
                <span style={{ color: 'var(--red)', fontSize: '0.9rem' }}>—</span>
              )}
            </div>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: yearDiffColor,
              }}
            >
              {yearDiff > 0 ? `±${yearDiff} · ${yearDiffLabel}` : yearDiffLabel}
            </span>
          </div>

          {/* Song-Auflösung */}
          <div
            className="panel-inset"
            style={{
              padding: 16,
              textAlign: 'center',
              display: 'grid',
              gap: 6,
              justifyItems: 'center',
            }}
          >
            {song.coverUrl ? (
              <img
                src={song.coverUrl}
                alt=""
                style={{
                  width: 92, height: 92, borderRadius: 14, objectFit: 'cover',
                  border: '1px solid var(--line-strong)',
                  boxShadow: '0 12px 30px rgba(0,0,0,0.55)',
                  transform: 'rotate(-2deg)',
                }}
              />
            ) : (
              <div style={{ fontSize: 38 }}>{song.emoji}</div>
            )}
            <div className="display" style={{ fontSize: 'clamp(1.1rem, 4.5vw, 1.4rem)', lineHeight: 1.15, marginTop: 4 }}>
              <span style={{ color: 'var(--lime)' }}>{song.artist}</span>
              <span className="serif-note" style={{ color: 'var(--dim)', textTransform: 'none', margin: '0 6px' }}>—</span>
              <span style={{ color: 'var(--pink)' }}>{song.title}</span>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: '0.78rem' }}>
              {song.genre} · {song.year}
            </div>
          </div>
        </div>

        {/* Scoreboard */}
        <div style={{ marginTop: 16 }}>
          <Scoreboard players={players} currentRound={round} totalRounds={totalRounds} />
        </div>

        {/* Weiter */}
        <button
          onClick={handleContinue}
          disabled={resolving}
          className="fade-up btn-primary"
          style={{ marginTop: 18 }}
        >
          {isGameOver ? '🏆 Zum Finale' : 'Weiter →'}
        </button>
      </div>
    </div>
  );
}

function BreakdownItem({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        padding: '8px 12px',
        borderRadius: 10,
        background: ok ? 'rgba(30,215,96,0.08)' : 'rgba(255,84,112,0.06)',
        border: ok ? '1px solid rgba(30,215,96,0.25)' : '1px solid rgba(255,84,112,0.18)',
      }}
    >
      <span style={{ color: 'var(--muted)', fontSize: '0.78rem', fontWeight: 500 }}>{label}</span>
      <span
        className="display"
        style={{
          fontSize: '0.85rem',
          color: ok ? 'var(--green)' : 'var(--red)',
        }}
      >
        +{ok ? '1' : '0'}
      </span>
    </div>
  );
}
