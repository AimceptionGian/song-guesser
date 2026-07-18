import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Timeline from '../components/Timeline';
import type { PlacedCardInfo } from '../components/Timeline';
import AudioPlayer from '../components/AudioPlayer';
import Scoreboard from '../components/Scoreboard';
import { MIN_YEAR, MAX_YEAR } from '../constants';
import { api, getLobbySession, clearLobbySession } from '../services/api-client';
import type { Song, Player, LiveInput, PlaybackState, RoundReveal } from '../types';

/** Backend players carry {card}; the frontend expects {song}. */
function convertPlayers(state: any): Player[] {
  return ((state?.players ?? []) as any[]).map((p: any) => ({
    ...p,
    placedCards: (p.placedCards || []).map((pc: any) => ({
      placedYear: pc.placedYear,
      isCorrect: pc.isCorrect,
      song: pc.song || pc.card || null,
    })),
  })) as Player[];
}

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
  const [liveInput, setLiveInput] = useState<LiveInput | null>(null);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [phase, setPhase] = useState<string>('drawing');
  const [roundResult, setRoundResult] = useState<RoundReveal | null>(null);

  const currentPlayer = players[currentPlayerIndex] || players[0];

  // Own identity from the lobby session; only valid for this game's code.
  // Without a session (direct URL / solo flow) everything stays enabled.
  const session = useMemo(() => getLobbySession(), []);
  const selfId = session && session.code === gameCode ? session.playerId : null;
  const isMyTurn = !selfId || players.length === 0 || players[currentPlayerIndex]?.id === selfId;
  const activePlayerName = players[currentPlayerIndex]?.name ?? '…';

  // ─── Sync placedYears from current player's placedCards ───
  useEffect(() => {
    const p = players[currentPlayerIndex];
    if (p?.placedCards?.length) {
      setPlacedYears(p.placedCards.map((pc) => ({
        year: (pc as any).song?.year ?? (pc as any).card?.year ?? pc.placedYear,
        isCorrect: pc.isCorrect,
        emoji: (pc as any).song?.emoji ?? (pc as any).card?.emoji ?? '🎵',
        title: (pc as any).song?.title ?? (pc as any).card?.title ?? '',
      })));
    } else {
      setPlacedYears([]);
    }
  }, [players, currentPlayerIndex]);

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
  const syncedVersionRef = useRef(0);
  const syncState = useCallback((state: any | null | undefined) => {
    if (!state) return;
    // A poll response can arrive after a newer command response — never
    // let an older state overwrite a newer one (e.g. clear a drawn card).
    if (typeof state.version === 'number') {
      if (state.version < syncedVersionRef.current) return;
      syncedVersionRef.current = state.version;
    }
    if (state.players) {
      setPlayers(convertPlayers(state));
    }
    if (typeof state.currentPlayerIndex === 'number') setCurrentPlayerIndex(state.currentPlayerIndex);
    if (typeof state.currentRound === 'number') setRound(state.currentRound);
    if (typeof state.totalRounds === 'number') setTotalRounds(state.totalRounds);
    if (typeof state.phase === 'string') setPhase(state.phase);
    setRoundResult((state.lastResult as RoundReveal | undefined) ?? null);
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

  // ─── Poll game state so spectators follow the active player live ───
  const finishedNavRef = useRef(false);
  useEffect(() => {
    if (!gameCode) return;
    const id = setInterval(async () => {
      try {
        const state = await api.getGameState(gameCode);
        const stateAny = state as any;
        if (stateAny.players) {
          syncState(state);
          setGameStarted(true);
          setLiveInput(stateAny.liveInput ?? null);
          setPlayback(stateAny.playback ?? null);
          // Spectators: follow everyone to the final screen when it's over
          if (stateAny.phase === 'finished' && !finishedNavRef.current) {
            finishedNavRef.current = true;
            navigate('/final', {
              state: {
                players: convertPlayers(stateAny),
                round: stateAny.currentRound,
                totalRounds: stateAny.totalRounds,
                gameCode,
              },
            });
          }
        }
      } catch {
        // Match not started yet — keep waiting
      }
    }, 1500);
    return () => clearInterval(id);
  }, [gameCode, syncState, navigate]);

  // ─── Broadcast own inputs while it's our turn (debounced) ───
  useEffect(() => {
    if (!selfId || !isMyTurn || !currentCard || !gameCode) return;
    const t = setTimeout(() => {
      api.sendLiveInput(gameCode, {
        playerId: selfId,
        artist: artistInput,
        title: titleInput,
        year: timelineYear,
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [artistInput, titleInput, timelineYear, selfId, isMyTurn, currentCard, gameCode]);

  // ─── Leave game ───
  const handleLeaveGame = useCallback(() => {
    const ok = window.confirm(
      'Spiel wirklich verlassen? Du kannst diesem Spiel danach nicht wieder beitreten.'
    );
    if (!ok) return;
    clearLobbySession();
    navigate('/');
  }, [navigate]);

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
        const drawRes = await api.drawCard(gameCode, selfId ?? undefined);
        if (drawRes.state) syncState(drawRes.state);
        setIsLoading(false);
      } else {
        // Match is running — just draw
        const drawRes = await api.drawCard(gameCode, selfId ?? undefined);
        if (drawRes.state) syncState(drawRes.state);
        setIsLoading(false);
      }
    } catch (err) {
      console.error('Draw failed:', err);
      setIsLoading(false);
      setError('Karte ziehen fehlgeschlagen. Versuche es erneut.');
    }
  }, [round, totalRounds, isLoading, gameCode, gameStarted, syncState, selfId]);

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

    // Timeline bucket check relative to ALL already placed cards (they all stay
    // visible on the timeline). An empty timeline is always correct.
    const myPlayer = players[currentPlayerIndex];
    const existingYears = myPlayer
      ? myPlayer.placedCards
          .map((pc) => (pc as any).song?.year ?? (pc as any).card?.year)
          .filter((y): y is number => typeof y === 'number')
      : [];

    let timelineCorrect = true;
    if (existingYears.length > 0) {
      const sortedExisting = [...existingYears].sort((a, b) => a - b);
      const correctBucket = getBucket(currentCard.year, sortedExisting);
      const guessedBucket = getBucket(timelineYear, sortedExisting);
      timelineCorrect = correctBucket === guessedBucket;
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
    // Local computation is only the offline fallback — the server result is
    // authoritative (it also applies fuzzy matching for typos).
    let resultPayload = {
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
    };
    try {
      const res = await api.submitGuess(gameCode, {
        playerId: selfId ?? currentPlayer?.id ?? 'local-player',
        cardId: currentCard.id,
        guessedArtist: artistInput,
        guessedTitle: titleInput,
        guessedYear: timelineYear,
      });
      const reveal = (res.state as any)?.lastResult as RoundReveal | undefined;
      if (reveal) {
        resultPayload = {
          song: reveal.card,
          guessedArtist: reveal.guessedArtist,
          guessedTitle: reveal.guessedTitle,
          guessedYear: reveal.guessedYear,
          artistCorrect: reveal.artistCorrect,
          titleCorrect: reveal.titleCorrect,
          yearExact: reveal.yearExact,
          timelineCorrect: reveal.timelineCorrect,
          yearDiff: reveal.yearDiff,
          points: reveal.points,
          players: convertPlayers(res.state),
        };
      }
    } catch {
      // Offline — keep the locally computed result
    }

    navigate('/result', {
      state: {
        ...resultPayload,
        round,
        totalRounds,
        currentPlayerIndex,
        gameCode,
      },
    });
  }, [currentCard, artistInput, titleInput, timelineYear, players, currentPlayerIndex, round, totalRounds, gameCode, currentPlayer, navigate, selfId]);

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
        <button
          onClick={handleLeaveGame}
          title="Spiel verlassen"
          style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,77,109,0.3)',
            background: 'rgba(255,77,109,0.08)', color: '#ff4d6d', cursor: 'pointer',
            fontFamily: "'JetBrains Mono', monospace", fontSize: '0.78rem', fontWeight: 600,
          }}
        >
          ✕ Verlassen
        </button>
      </div>

      {/* Spectator banner */}
      {!isMyTurn && (
        <div
          className="fade-up"
          style={{
            width: '100%', maxWidth: 720, marginBottom: 12,
            padding: '10px 16px', borderRadius: 12, textAlign: 'center',
            background: 'rgba(255,214,10,0.08)', border: '1px solid rgba(255,214,10,0.25)',
            color: '#ffd60a', fontSize: '0.85rem', fontWeight: 600,
          }}
        >
          👀 {activePlayerName} ist am Zug — du schaust zu und kannst mithören
        </div>
      )}

      <div style={{ width: '100%', maxWidth: 720, display: 'grid', gap: 14 }}>
        {/* Round reveal — shown to everyone until the guesser continues */}
        {phase === 'round_result' && roundResult && (
          <div
            className="pop-in"
            style={{
              borderRadius: 16,
              padding: 20,
              background: 'linear-gradient(135deg, #1e1c2e 0%, #13121f 100%)',
              border: '1px solid rgba(168,85,247,0.3)',
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#8b7fb8', fontSize: '0.8rem' }}>
                {roundResult.playerName} hat geraten
              </div>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '2.2rem',
                  lineHeight: 1.1,
                  color: roundResult.points > 0 ? '#06d6a0' : '#ff4d6d',
                }}
              >
                {roundResult.points > 0 ? `+${roundResult.points}` : '0'} Punkte
              </div>
            </div>

            <div
              style={{
                padding: 12,
                borderRadius: 12,
                background: 'rgba(168,85,247,0.08)',
                border: '1px solid rgba(168,85,247,0.15)',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 2 }}>{roundResult.card.emoji}</div>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: '1.4rem',
                  background: 'linear-gradient(90deg, #a855f7, #f72585)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {roundResult.card.artist} — {roundResult.card.title}
              </div>
              <div style={{ color: '#8b7fb8', fontSize: '0.8rem', marginTop: 2 }}>
                {roundResult.card.year}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <RevealCheck label="🎤 Interpret" ok={roundResult.artistCorrect} />
              <RevealCheck label="🎶 Titel" ok={roundResult.titleCorrect} />
              <RevealCheck label="📅 Jahr" ok={roundResult.yearExact} />
              <RevealCheck label="📊 Timeline" ok={roundResult.timelineCorrect} />
            </div>

            {roundResult.playerId === selfId ? (
              <button
                onClick={async () => {
                  try {
                    const res = await api.resolveTurn(gameCode!, selfId ?? undefined);
                    if (res.state) syncState(res.state);
                  } catch { /* poll will catch up */ }
                }}
                style={{
                  padding: '14px 24px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: 'white',
                  fontWeight: 700, fontSize: '1rem',
                }}
              >
                Weiter ›
              </button>
            ) : (
              <div style={{ textAlign: 'center', color: '#8b7fb8', fontSize: '0.82rem' }}>
                ⏳ Warte, bis {roundResult.playerName} weiterklickt…
              </div>
            )}
          </div>
        )}

        {/* Current Song Card */}
        {currentCard && phase !== 'round_result' && (
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
                height: 'clamp(64px, 14vw, 84px)',
                background: currentCard.gradient,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'clamp(28px, 6vw, 36px)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  padding: '3px 8px',
                  borderRadius: 8,
                  background: 'rgba(247,37,133,0.7)',
                  backdropFilter: 'blur(4px)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: '0.65rem',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                🎵 Aktuelle Karte
              </div>
              🎵
            </div>
            <div style={{ padding: 'clamp(8px, 2vw, 12px)', display: 'grid', gap: 2 }}>
              <div
                style={{
                  fontFamily: "'Bebas Neue', sans-serif",
                  fontSize: 'clamp(1.05rem, 3.5vw, 1.3rem)',
                  letterSpacing: '0.02em',
                  color: '#f0eeff',
                }}
              >
                ??? — ???
              </div>
              <div style={{ color: '#8b7fb8', fontSize: 'clamp(0.7rem, 2vw, 0.78rem)' }}>
                Erscheinungsjahr raten
              </div>
            </div>
          </div>
        )}

        {/* Timeline — spectators see the active player's live position */}
        <div style={isMyTurn ? undefined : { pointerEvents: 'none', opacity: 0.85 }}>
          <Timeline
            minYear={MIN_YEAR}
            maxYear={MAX_YEAR}
            value={isMyTurn ? timelineYear : (liveInput?.year || timelineYear)}
            onChange={setTimelineYear}
            placedCards={placedYears}
            currentDotYear={selectedCard ? (isMyTurn ? timelineYear : (liveInput?.year || timelineYear)) : undefined}
          />
        </div>

        {/* Inputs + Audio */}
        <div className="fade-up" style={{ animationDelay: '0.14s', display: 'grid', gap: 10 }}>
          {currentCard && phase !== 'round_result' && (
          <div className="fade-up" style={{ animationDelay: '0.14s', display: 'grid', gap: 10 }}>
            <div
              className="grid-2"
            >
              <InputGroup label="🎤 Interpret / Band">
                <input
                  className="text-input"
                  type="text"
                  placeholder={isMyTurn ? 'z.B. Queen, Beyoncé…' : `${activePlayerName} tippt…`}
                  value={isMyTurn ? artistInput : (liveInput?.artist ?? '')}
                  onChange={(e) => setArtistInput(e.target.value)}
                  readOnly={!isMyTurn}
                  style={isMyTurn ? undefined : { opacity: 0.7, cursor: 'default' }}
                />
              </InputGroup>
              <InputGroup label="🎶 Songtitel">
                <input
                  className="text-input"
                  type="text"
                  placeholder={isMyTurn ? 'z.B. Bohemian Rhapsody…' : `${activePlayerName} tippt…`}
                  value={isMyTurn ? titleInput : (liveInput?.title ?? '')}
                  onChange={(e) => setTitleInput(e.target.value)}
                  readOnly={!isMyTurn}
                  style={isMyTurn ? undefined : { opacity: 0.7, cursor: 'default' }}
                />
              </InputGroup>
            </div>

            <AudioPlayer
              previewUrl={currentCard.previewUrl}
              songTitle={undefined}
              artistName={undefined}
              isController={isMyTurn}
              remotePlayback={isMyTurn ? null : playback}
              onTransport={
                isMyTurn && selfId && gameCode
                  ? (playing, positionSec) =>
                      api.sendPlayback(gameCode, { playerId: selfId, playing, positionSec }).catch(() => {})
                  : undefined
              }
            />

            {isMyTurn ? (
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
            ) : (
              <div style={{
                textAlign: 'center', padding: '14px', borderRadius: 12,
                background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
                color: '#8b7fb8', fontSize: '0.85rem',
              }}>
                ⏳ {activePlayerName} rät gerade…
              </div>
            )}
          </div>
        )}

        {/* Draw card button (only when no card is active) */}
        {!currentCard && phase !== 'round_result' && (isMyTurn ? (
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
        ) : (
          <div style={{
            textAlign: 'center', padding: '16px', borderRadius: 16,
            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
            color: '#8b7fb8', fontSize: '0.9rem',
          }}>
            🃏 Warte darauf, dass {activePlayerName} eine Karte zieht…
          </div>
        ))}
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

function RevealCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 8,
        background: ok ? 'rgba(6,214,160,0.08)' : 'rgba(255,77,109,0.06)',
      }}
    >
      <span style={{ color: '#8b7fb8', fontSize: '0.78rem' }}>{label}</span>
      <span style={{ fontSize: '0.95rem' }}>{ok ? '✅' : '❌'}</span>
    </div>
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
