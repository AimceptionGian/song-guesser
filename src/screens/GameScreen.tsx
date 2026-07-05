import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Timeline from '../components/Timeline';
import type { PlacedCardInfo } from '../components/Timeline';
import AudioPlayer from '../components/AudioPlayer';
import Scoreboard from '../components/Scoreboard';
import { MIN_YEAR, MAX_YEAR } from '../constants';
import { api } from '../services/api-client';
import type { Song, Player } from '../types';

export default function GameScreen() {
  const { gameCode } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [currentCard, setCurrentCard] = useState<Song | null>(null);
  const [placedYears, setPlacedYears] = useState<PlacedCardInfo[]>([]);
  const [timelineYear, setTimelineYear] = useState(1992);
  const [artistInput, setArtistInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [round, setRound] = useState(1);
  const [selectedCard, setSelectedCard] = useState<Song | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [totalRounds, setTotalRounds] = useState(5);
  const [error, setError] = useState<string | null>(null);

  const currentPlayer = players[currentPlayerIndex] || players[0];

  // ─── Restore or initialise match state ───
  useEffect(() => {
    if (!gameCode) { navigate('/', { replace: true }); return; }

    const incoming = location.state as Record<string, unknown> | null;

    // If we're coming back from ResultScreen, restore the state
    if (incoming?.players) {
      const restoredPlayers = incoming.players as Player[];
      setPlayers(restoredPlayers);
      if (typeof incoming.currentPlayerIndex === 'number') setCurrentPlayerIndex(incoming.currentPlayerIndex);
      if (typeof incoming.round === 'number') setRound(incoming.round as number);
      setGameStarted(true);
      // Restore placed cards from current player's state (handle both frontend {song} and backend {card} format)
      const p = restoredPlayers[incoming.currentPlayerIndex as number] || restoredPlayers[0];
      if (p?.placedCards?.length) {
        setPlacedYears(p.placedCards.map((pc) => ({
          year: pc.placedYear,
          isCorrect: pc.isCorrect,
          emoji: (pc as any).song?.emoji ?? (pc as any).card?.emoji ?? '🎵',
          title: (pc as any).song?.title ?? (pc as any).card?.title ?? '',
        })));
      }
      return;
    }

    // First load — fetch lobby info
    let cancelled = false;

    async function loadLobby() {
      if (!gameCode) return;
      try {
        const lobby = await api.getLobby(gameCode);
        if (cancelled) return;
        if (lobby.players?.length) {
          setPlayers(lobby.players.map((p) => ({
            id: p.id, name: p.name, score: 0, avatar: p.avatar,
            hand: [], placedCards: [],
          })));
        }
        if (lobby.settings?.totalRounds) setTotalRounds(lobby.settings.totalRounds);
      } catch {
        if (!cancelled) setError('Backend nicht erreichbar. Starte das Backend mit `npx wrangler dev` im workers/ Ordner.');
      }
    }
    loadLobby();
    return () => { cancelled = true; };
  }, [gameCode, navigate, location.state]);

  // ─── Sync state from backend after each command ───
  const syncState = useCallback((state: any | null | undefined) => {
    if (!state) return;
    if (state.players) {
      // Convert backend format (placedCards has {card}) to frontend format (placedCards has {song})
      const converted = (state.players as any[]).map((p: any) => ({
        ...p,
        placedCards: (p.placedCards || []).map((pc: any) => ({
          placedYear: pc.placedYear,
          isCorrect: pc.isCorrect,
          song: pc.song || pc.card || null,
        })),
      }));
      setPlayers(converted as Player[]);
    }
    if (typeof state.currentPlayerIndex === 'number') setCurrentPlayerIndex(state.currentPlayerIndex);
    if (typeof state.currentRound === 'number') setRound(state.currentRound);
    if (typeof state.totalRounds === 'number') setTotalRounds(state.totalRounds);
    if (state.phase === 'guessing' && state.currentCard) {
      setCurrentCard(state.currentCard as Song);
      setSelectedCard(state.currentCard as Song);
    }
    if (state.phase === 'drawing') {
      setCurrentCard(null);
      setSelectedCard(null);
    }
    if (state.phase === 'finished') {
      setCurrentCard(null);
      setSelectedCard(null);
    }
  }, []);

  // ─── Draw card ───
  const handleDrawCard = useCallback(async () => {
    if (round > totalRounds || isLoading || !gameCode) return;
    setIsLoading(true);
    setError(null);

    try {
      if (!gameStarted) {
        // Game was started via lobby — DO is already initialized with deck
        // Just start the match via startMatch API, then draw
        const startRes = await api.startMatch(gameCode);
        if (startRes.state) syncState(startRes.state);
        setGameStarted(true);

        // Now draw the first card
        const drawRes = await api.drawCard(gameCode);
        if (drawRes.state) syncState(drawRes.state);
        setIsLoading(false);
      } else {
        // Match is running — just draw
        const drawRes = await api.drawCard(gameCode);
        if (drawRes.state) syncState(drawRes.state);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Draw failed:', err);
      setIsLoading(false);
      setError('Karte ziehen fehlgeschlagen. Versuche es erneut.');
    }
  }, [round, totalRounds, isLoading, gameCode, gameStarted, syncState]);

  // ─── Submit guess ───
  const handleSubmit = useCallback(async () => {
    if (!currentCard || !gameCode) return;
    setIsLoading(true);
    setError(null);

    // New 4×1 scoring
    const artistCorrect = artistInput.trim().toLowerCase() === currentCard.artist.toLowerCase();
    const titleCorrect = titleInput.trim().toLowerCase() === currentCard.title.toLowerCase();
    const yearExact = timelineYear === currentCard.year;
    const yearDiff = Math.abs(timelineYear - currentCard.year);

    // Timeline bucket check: where does this fit relative to already placed correct cards?
    const myPlayer = players[currentPlayerIndex];
    const existingCorrectYears = myPlayer
      ? myPlayer.placedCards.filter((pc) => pc.isCorrect).map((pc) => pc.song.year)
      : [];

    let timelineCorrect = false;
    if (existingCorrectYears.length > 0) {
      const sortedExisting = [...existingCorrectYears].sort((a, b) => a - b);
      const correctBucket = getBucket(currentCard.year, sortedExisting);
      const guessedBucket = getBucket(timelineYear, sortedExisting);
      timelineCorrect = correctBucket === guessedBucket;
    } else {
      // First card: timeline point always earned if years match
      timelineCorrect = timelineYear === currentCard.year;
    }

    const points = (artistCorrect ? 1 : 0) + (titleCorrect ? 1 : 0) + (yearExact ? 1 : 0) + (timelineCorrect ? 1 : 0);

    // Optimistic local update
    const updatedPlayers = [...players];
    updatedPlayers[currentPlayerIndex] = {
      ...updatedPlayers[currentPlayerIndex],
      score: updatedPlayers[currentPlayerIndex].score + points,
      placedCards: [
        ...updatedPlayers[currentPlayerIndex].placedCards,
        { song: currentCard, placedYear: timelineYear, isCorrect: timelineCorrect },
      ],
    };
    setPlacedYears((prev) => [...prev, {
      year: timelineYear,
      isCorrect: timelineCorrect,
      emoji: currentCard.emoji,
      title: currentCard.title,
    }]);
    try {
      await api.submitGuess(gameCode, {
        playerId: currentPlayer?.id || 'local-player',
        cardId: currentCard.id,
        guessedArtist: artistInput,
        guessedTitle: titleInput,
        guessedYear: timelineYear,
      });
    } catch {
      // Optimistic update already applied
    }

    navigate('/result', {
      state: {
        song: currentCard,
        guessedArtist: artistInput,
        guessedTitle: titleInput,
        guessedYear: timelineYear,
        artistCorrect,
        titleCorrect,
        yearExact,
        timelineCorrect,
        yearDiff,
        points,
        players: updatedPlayers,
        round,
        totalRounds,
        currentPlayerIndex,
        gameCode,
      },
    });
  }, [currentCard, artistInput, titleInput, timelineYear, players, currentPlayerIndex, round, totalRounds, gameCode, currentPlayer, navigate]);

  const isLastPlayer = currentPlayerIndex === players.length - 1;

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
      {/* Top Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          maxWidth: 720,
          marginBottom: 16,
          gap: 8,
        }}
      >
        <Pill color="purple">Karte {round} / {totalRounds}</Pill>
        <Pill color="gold">
          {currentPlayer?.avatar} {currentPlayer?.name} ist am Zug
        </Pill>
      </div>

      <div style={{ width: '100%', maxWidth: 720, display: 'grid', gap: 14 }}>
        {/* Current Song Card */}
        {currentCard && (
          <div
            className="pop-in"
            style={{
              borderRadius: 20,
              border: '1px solid rgba(168,85,247,0.3)',
              background: 'linear-gradient(135deg, #1e1c2e 0%, #13121f 100%)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: 'clamp(120px, 25vw, 160px)',
                background: currentCard.gradient,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(44px, 10vw, 60px)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: 'rgba(247,37,133,0.7)',
                  backdropFilter: 'blur(4px)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.7rem',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                🎵 Aktuelle Karte
              </div>
              {currentCard.emoji}
            </div>
            <div style={{ padding: 'clamp(10px, 2.5vw, 16px)', display: 'grid', gap: 4 }}>
              <div style={{ fontSize: 22 }}>{currentCard.emoji}</div>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'clamp(1.2rem, 4vw, 1.5rem)',
                  letterSpacing: '0.02em',
                  color: '#f0eeff',
                }}
              >
                ??? — ???
              </div>
              <div style={{ color: '#8b7fb8', fontSize: 'clamp(0.72rem, 2vw, 0.8rem)' }}>
                <span style={{ color: '#c4b8ff' }}>{currentCard.genre}</span> · Erscheinungsjahr raten
              </div>
            </div>
          </div>
        )}

        {/* Timeline */}
        <Timeline
          minYear={MIN_YEAR}
          maxYear={MAX_YEAR}
          value={timelineYear}
          onChange={setTimelineYear}
          placedCards={placedYears}
          currentDotYear={selectedCard ? timelineYear : undefined}
        />

        {/* Inputs + Audio */}
        <div className="fade-up" style={{ animationDelay: '0.14s', display: 'grid', gap: 10 }}>
          {currentCard && (
          <div className="fade-up" style={{ animationDelay: '0.14s', display: 'grid', gap: 10 }}>
            <div
              className="grid-2"
            >
              <InputGroup label="🎤 Interpret / Band">
                <input
                  className="text-input"
                  type="text"
                  placeholder="z.B. Queen, Beyoncé…"
                  value={artistInput}
                  onChange={(e) => setArtistInput(e.target.value)}
                />
              </InputGroup>
              <InputGroup label="🎶 Songtitel">
                <input
                  className="text-input"
                  type="text"
                  placeholder="z.B. Bohemian Rhapsody…"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                />
              </InputGroup>
            </div>

            <AudioPlayer
              previewUrl={currentCard.previewUrl}
              songTitle={undefined}
              artistName={undefined}
            />

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                width: '100%',
                padding: '18px 24px',
                borderRadius: 16,
                border: 'none',
                cursor: isLoading ? 'default' : 'pointer',
                background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #f72585 100%)',
                color: 'white',
                fontWeight: 700,
                fontSize: '1.05rem',
                letterSpacing: '0.02em',
                boxShadow: isLoading ? 'none' : '0 0 40px rgba(168,85,247,0.4)',
                opacity: isLoading ? 0.6 : 1,
                transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.2s',
              }}
              onMouseEnter={(e) => {
                if (isLoading) return;
                e.currentTarget.style.transform = 'scale(1.03)';
                e.currentTarget.style.boxShadow = '0 0 55px rgba(168,85,247,0.55)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = '0 0 40px rgba(168,85,247,0.4)';
              }}
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  Wird geladen…
                </>
              ) : (
                'Antwort bestätigen ✓'
              )}
            </button>
          </div>
        )}

        {/* Draw card button (only when no card is active) */}
        {!currentCard && (
          <button
            onClick={handleDrawCard}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '18px 24px',
              borderRadius: 16,
              border: 'none',
              cursor: isLoading ? 'default' : 'pointer',
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              color: 'white',
              fontWeight: 700,
              fontSize: '1.05rem',
              letterSpacing: '0.02em',
              boxShadow: isLoading ? 'none' : '0 0 30px rgba(168,85,247,0.3)',
              opacity: isLoading ? 0.6 : 1,
              transition: 'transform 0.15s, box-shadow 0.15s, opacity 0.2s',
            }}
            onMouseEnter={(e) => {
              if (isLoading) return;
              e.currentTarget.style.transform = 'scale(1.03)';
              e.currentTarget.style.boxShadow = '0 0 55px rgba(168,85,247,0.55)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 0 30px rgba(168,85,247,0.3)';
            }}
          >
            {isLoading ? (
              <>
                <span className="spinner" />
                Wird geladen…
              </>
            ) : (
              'Karte ziehen 🃏'
            )}
          </button>
        )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="error-banner">
            ⚠️ {error}
          </div>
        )}

        {/* Scoreboard */}
        <Scoreboard players={players} currentRound={round} totalRounds={totalRounds} />
      </div>
    </div>
  );
}

function Pill({ color, children }: { color: 'purple' | 'green' | 'gold'; children: React.ReactNode }) {
  const colors = {
    purple: { bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.25)', text: '#a855f7' },
    green: { bg: 'rgba(6,214,160,0.1)', border: 'rgba(6,214,160,0.2)', text: '#06d6a0' },
    gold: { bg: 'rgba(255,214,10,0.1)', border: 'rgba(255,214,10,0.25)', text: '#ffd60a' },
  };
  const c = colors[color];
  return (
    <span
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '0.78rem',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
      }}
    >
      {children}
    </span>
  );
}

function InputGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ color: '#c4b8ff', fontSize: 'clamp(0.72rem, 2vw, 0.82rem)', fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

/**
 * Determine which "bucket" a year falls into relative to sorted existing years.
 * Returns the insertion index: 0 if before first, 1 between first and second, etc.
 */
function getBucket(year: number, sortedYears: number[]): number {
  for (let i = 0; i < sortedYears.length; i++) {
    if (year < sortedYears[i]) return i;
  }
  return sortedYears.length;
}
