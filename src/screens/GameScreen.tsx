import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Timeline from '../components/Timeline';
import type { PlacedCardInfo } from '../components/Timeline';
import AudioPlayer from '../components/AudioPlayer';
import Scoreboard from '../components/Scoreboard';
import { MIN_YEAR, MAX_YEAR } from '../constants';
import { api, getLobbySession, clearLobbySession } from '../services/api-client';
import type { Song, Player, LiveInput, PlaybackState, RoundReveal, MatchSettings, BuzzerState, VoteState } from '../types';

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
  const [settings, setSettings] = useState<MatchSettings | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [buzzer, setBuzzer] = useState<BuzzerState | null>(null);
  const [voting, setVoting] = useState<VoteState | null>(null);
  // Server-clock offset (serverNow - clientNow) so countdowns don't drift
  const clockOffsetRef = useRef(0);
  const [nowTick, setNowTick] = useState(Date.now());
  const [buzzerGuess, setBuzzerGuess] = useState('');
  const [myVote, setMyVote] = useState<{ artistOk: boolean; titleOk: boolean } | null>(null);
  const [voteSent, setVoteSent] = useState(false);

  const currentPlayer = players[currentPlayerIndex] || players[0];
  const speakMode = settings?.guessMode === 'speak';

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
    if (state.settings) setSettings(state.settings as MatchSettings);
    setTurnDeadline((state.turnDeadline as number | undefined) ?? null);
    setBuzzer((state.buzzer as BuzzerState | undefined) ?? null);
    setVoting((state.voting as VoteState | undefined) ?? null);
    if (typeof state.serverNow === 'number') {
      clockOffsetRef.current = state.serverNow - Date.now();
    }
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

  // ─── Countdown tick + deadline poke ───
  // The server enforces deadlines lazily (each request applies expired
  // timers), so when a countdown hits zero we poke /state once to make the
  // transition happen right away instead of on the next 1.5s poll.
  const activeDeadline =
    phase === 'guessing' ? turnDeadline
    : phase === 'buzzer' ? (buzzer?.winnerId ? buzzer?.answerDeadline : buzzer?.openUntil) ?? null
    : phase === 'reveal_vote' ? voting?.deadline ?? null
    : null;

  const pokedDeadlineRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeDeadline) return;
    const id = setInterval(() => {
      setNowTick(Date.now());
      const serverNow = Date.now() + clockOffsetRef.current;
      if (serverNow > activeDeadline + 1200 && pokedDeadlineRef.current !== activeDeadline && gameCode) {
        pokedDeadlineRef.current = activeDeadline;
        api.getGameState(gameCode).then(syncState).catch(() => {});
      }
    }, 250);
    return () => clearInterval(id);
  }, [activeDeadline, gameCode, syncState]);

  /** Seconds left on the active deadline (server clock), or null. */
  const secondsLeft = activeDeadline
    ? Math.max(0, Math.ceil((activeDeadline - (nowTick + clockOffsetRef.current)) / 1000))
    : null;

  // Reset per-turn transients whenever a new card/turn begins
  useEffect(() => {
    if (phase === 'drawing' || phase === 'guessing') {
      setBuzzerGuess('');
      setMyVote(null);
      setVoteSent(false);
    }
  }, [phase, currentPlayerIndex, round]);

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
        // Speak mode: the answer was said aloud — nothing typed to grade
        guessedArtist: speakMode ? '' : artistInput,
        guessedTitle: speakMode ? '' : titleInput,
        guessedYear: timelineYear,
      });

      // Multiplayer: stay here — the shared reveal (and in speak mode the
      // vote) is rendered phase-based for everyone, including the guesser.
      if (selfId) {
        if (res.state) syncState(res.state);
        setArtistInput('');
        setTitleInput('');
        setIsLoading(false);
        return;
      }

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

    // Solo flow keeps the dedicated result screen
    navigate('/result', {
      state: {
        ...resultPayload,
        round,
        totalRounds,
        currentPlayerIndex,
        gameCode,
      },
    });
  }, [currentCard, artistInput, titleInput, timelineYear, players, currentPlayerIndex, round, totalRounds, gameCode, currentPlayer, navigate, selfId, speakMode, syncState]);

  // ─── Buzzer actions ───
  const handleBuzz = useCallback(async () => {
    if (!gameCode || !selfId) return;
    try {
      const res = await api.buzz(gameCode, selfId);
      if (res.state) syncState(res.state);
    } catch { /* poll will catch up */ }
  }, [gameCode, selfId, syncState]);

  const handleBuzzerAnswer = useCallback(async () => {
    if (!gameCode || !selfId || !buzzerGuess.trim()) return;
    try {
      const res = await api.buzzerAnswer(gameCode, selfId, buzzerGuess.trim());
      if (res.state) syncState(res.state);
    } catch { /* poll will catch up */ }
  }, [gameCode, selfId, buzzerGuess, syncState]);

  // ─── Speak mode vote ───
  const handleSendVote = useCallback(async () => {
    if (!gameCode || !selfId || !myVote) return;
    setVoteSent(true);
    try {
      const res = await api.voteReveal(gameCode, { playerId: selfId, ...myVote });
      if (res.state) syncState(res.state);
    } catch {
      setVoteSent(false);
    }
  }, [gameCode, selfId, myVote, syncState]);

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
      {/* ─── Game HUD: progress, turn, timer, leave ─── */}
      <div className="game-hud" style={{ width: '100%', maxWidth: 720, marginBottom: 14 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 8, marginBottom: 8, flexWrap: 'wrap',
          }}
        >
          <Pill color="purple">🃏 Karte {round}/{totalRounds}</Pill>
          <Pill color={isMyTurn ? 'green' : 'gold'}>
            {isMyTurn ? '🎯 Du bist am Zug!' : `👀 ${currentPlayer?.avatar ?? ''} ${activePlayerName} ist am Zug`}
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
            ✕
          </button>
        </div>

        {/* Round progress bar */}
        <div style={{ height: 5, borderRadius: 3, background: 'rgba(168,85,247,0.12)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3,
            width: `${Math.min(100, Math.round(((round - 1) / Math.max(1, totalRounds)) * 100))}%`,
            background: 'linear-gradient(90deg, #7c3aed, #a855f7, #f72585)',
            transition: 'width 0.5s ease',
          }} />
        </div>

        {/* Player chips — everyone at a glance, active player highlighted */}
        {players.length > 1 && (
          <div style={{
            display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap',
          }}>
            {players.map((p, i) => {
              const isActive = i === currentPlayerIndex;
              const best = Math.max(...players.map((x) => x.score));
              const leads = p.score > 0 && p.score === best;
              return (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 20,
                  background: isActive ? 'rgba(6,214,160,0.12)' : 'rgba(168,85,247,0.07)',
                  border: isActive ? '1px solid rgba(6,214,160,0.45)' : '1px solid rgba(168,85,247,0.15)',
                  boxShadow: isActive ? '0 0 12px rgba(6,214,160,0.25)' : 'none',
                  transition: 'all 0.3s',
                }}>
                  <span style={{ fontSize: 14 }}>{p.avatar}</span>
                  <span style={{
                    color: isActive ? '#06d6a0' : '#c4b8ff', fontSize: '0.75rem', fontWeight: 600,
                    maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {p.name}{p.id === selfId ? ' (du)' : ''}
                  </span>
                  <span style={{
                    fontFamily: "'Bebas Neue', sans-serif", fontSize: '0.95rem',
                    color: leads ? '#ffd60a' : '#a855f7',
                  }}>
                    {leads && '👑'}{p.score}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Answer timer */}
        {phase === 'guessing' && turnDeadline && secondsLeft !== null && settings && (
          <TimerBar
            secondsLeft={secondsLeft}
            totalSec={settings.answerTimeSec}
            label={isMyTurn ? 'Deine Antwortzeit' : `Antwortzeit von ${activePlayerName}`}
          />
        )}
      </div>

      <div style={{ width: '100%', maxWidth: 720, display: 'grid', gap: 14 }}>
        {/* ─── Buzzer phase: time ran out, a point is stealable ─── */}
        {phase === 'buzzer' && roundResult && (
          <div
            className="pop-in"
            style={{
              borderRadius: 16, padding: 20, textAlign: 'center',
              background: 'linear-gradient(135deg, #2e1c1c 0%, #1f1212 100%)',
              border: '1px solid rgba(255,77,109,0.35)',
              display: 'grid', gap: 12,
            }}
          >
            <div style={{ color: '#ffd60a', fontWeight: 700, fontSize: '0.95rem' }}>
              ⏰ Zeit abgelaufen bei {roundResult.playerName}!
            </div>

            {!buzzer?.winnerId ? (
              <>
                <div style={{ color: '#8b7fb8', fontSize: '0.82rem' }}>
                  Wer zuerst buzzert, darf Interpret <em>oder</em> Titel raten — 1 Punkt!
                </div>
                {secondsLeft !== null && (
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: '#ff4d6d' }}>
                    {secondsLeft}s
                  </div>
                )}
                {selfId && selfId !== roundResult.playerId ? (
                  <button onClick={handleBuzz} className="buzzer-button">
                    🔔 BUZZ!
                  </button>
                ) : (
                  <div style={{ color: '#8b7fb8', fontSize: '0.82rem' }}>
                    Die anderen können jetzt buzzern…
                  </div>
                )}
              </>
            ) : buzzer.winnerId === selfId ? (
              <>
                <div style={{ color: '#06d6a0', fontWeight: 700 }}>
                  🔔 Du warst am schnellsten! Interpret ODER Titel:
                </div>
                {secondsLeft !== null && (
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85rem', color: '#ff4d6d' }}>
                    noch {secondsLeft}s
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="text-input"
                    type="text"
                    autoFocus
                    placeholder="Interpret oder Titel…"
                    value={buzzerGuess}
                    onChange={(e) => setBuzzerGuess(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleBuzzerAnswer(); }}
                  />
                  <button
                    onClick={handleBuzzerAnswer}
                    disabled={!buzzerGuess.trim()}
                    style={{
                      padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
                      background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: 'white',
                      fontWeight: 700, whiteSpace: 'nowrap', opacity: buzzerGuess.trim() ? 1 : 0.5,
                    }}
                  >
                    ✓
                  </button>
                </div>
              </>
            ) : (
              <div style={{ color: '#ffd60a', fontSize: '0.9rem', fontWeight: 600 }}>
                🔔 {buzzer.winnerName} hat gebuzzert und rät…
                {secondsLeft !== null && <span style={{ color: '#8b7fb8' }}> ({secondsLeft}s)</span>}
              </div>
            )}
          </div>
        )}

        {/* ─── Speak mode: the others judge the spoken answer ─── */}
        {phase === 'reveal_vote' && roundResult && (
          <div
            className="pop-in"
            style={{
              borderRadius: 16, padding: 20,
              background: 'linear-gradient(135deg, #1e1c2e 0%, #13121f 100%)',
              border: '1px solid rgba(255,214,10,0.3)',
              display: 'grid', gap: 12,
            }}
          >
            <div style={{ textAlign: 'center', color: '#ffd60a', fontWeight: 700, fontSize: '0.95rem' }}>
              🗣️ {roundResult.playerName} hat angesagt — das war der Song:
            </div>

            <div style={{
              padding: 12, borderRadius: 12, textAlign: 'center',
              background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.15)',
            }}>
              <div style={{ fontSize: 28, marginBottom: 2 }}>{roundResult.card.emoji}</div>
              <div style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem',
                background: 'linear-gradient(90deg, #a855f7, #f72585)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {roundResult.card.artist} — {roundResult.card.title}
              </div>
              <div style={{ color: '#8b7fb8', fontSize: '0.8rem', marginTop: 2 }}>{roundResult.card.year}</div>
            </div>

            {selfId && voting?.voterIds.includes(selfId) && !voteSent && !voting.votes[selfId] ? (
              <>
                <div style={{ textAlign: 'center', color: '#8b7fb8', fontSize: '0.82rem' }}>
                  Hat {roundResult.playerName} es richtig angesagt?
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <VoteToggle
                    label="🎤 Interpret"
                    value={myVote?.artistOk ?? null}
                    onChange={(ok) => setMyVote((v) => ({ artistOk: ok, titleOk: v?.titleOk ?? false }))}
                  />
                  <VoteToggle
                    label="🎶 Titel"
                    value={myVote?.titleOk ?? null}
                    onChange={(ok) => setMyVote((v) => ({ artistOk: v?.artistOk ?? false, titleOk: ok }))}
                  />
                </div>
                <button
                  onClick={handleSendVote}
                  disabled={!myVote}
                  style={{
                    padding: '12px 24px', borderRadius: 12, border: 'none',
                    cursor: myVote ? 'pointer' : 'default',
                    background: myVote ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(168,85,247,0.15)',
                    color: 'white', fontWeight: 700, opacity: myVote ? 1 : 0.6,
                  }}
                >
                  Bewertung abschicken ✓
                </button>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: '#8b7fb8', fontSize: '0.82rem' }}>
                {selfId === roundResult.playerId
                  ? '⏳ Die anderen bewerten deine Ansage…'
                  : '✓ Bewertung abgegeben — warte auf die anderen…'}
                {voting && (
                  <div style={{ marginTop: 6, fontFamily: "'JetBrains Mono', monospace", fontSize: '0.75rem' }}>
                    {Object.keys(voting.votes).length}/{voting.voterIds.length} Stimmen
                    {secondsLeft !== null && ` · ${secondsLeft}s`}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

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
                {roundResult.timedOut ? `⏰ Zeit abgelaufen — ${roundResult.playerName}` : `${roundResult.playerName} hat geraten`}
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

            {/* Buzzer steal outcome */}
            {roundResult.steal && (
              <div style={{
                padding: '10px 12px', borderRadius: 10, textAlign: 'center', fontSize: '0.85rem',
                background: roundResult.steal.points > 0 ? 'rgba(255,214,10,0.08)' : 'rgba(255,77,109,0.06)',
                border: roundResult.steal.points > 0 ? '1px solid rgba(255,214,10,0.25)' : '1px solid rgba(255,77,109,0.15)',
                color: roundResult.steal.points > 0 ? '#ffd60a' : '#8b7fb8',
              }}>
                {roundResult.steal.points > 0 ? (
                  <>🔔 <strong>{roundResult.steal.playerName}</strong> hat den {roundResult.steal.field === 'artist' ? 'Interpreten' : 'Titel'} abgestaubt: +1 Punkt!</>
                ) : roundResult.steal.guess ? (
                  <>🔔 {roundResult.steal.playerName} hat gebuzzert, aber „{roundResult.steal.guess}" war nicht richtig.</>
                ) : (
                  <>🔔 {roundResult.steal.playerName} hat gebuzzert, aber nicht geantwortet.</>
                )}
              </div>
            )}

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
          {currentCard && phase === 'guessing' && (
          <div className="fade-up" style={{ animationDelay: '0.14s', display: 'grid', gap: 10 }}>
            {speakMode ? (
              <div style={{
                padding: '12px 16px', borderRadius: 12, textAlign: 'center',
                background: 'rgba(255,214,10,0.06)', border: '1px dashed rgba(255,214,10,0.3)',
                color: '#ffd60a', fontSize: '0.85rem', fontWeight: 600,
              }}>
                {isMyTurn
                  ? '🗣️ Sag Interpret & Titel laut an — die anderen bewerten danach!'
                  : `👂 ${activePlayerName} sagt die Antwort laut an — gleich bewertest du sie!`}
              </div>
            ) : (
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
            )}

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
                ) : speakMode ? (
                  'Auflösen — die anderen bewerten 🗣️'
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
        {!currentCard && phase !== 'round_result' && phase !== 'buzzer' && phase !== 'reveal_vote' && (isMyTurn ? (
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

function TimerBar({ secondsLeft, totalSec, label }: { secondsLeft: number; totalSec: number; label: string }) {
  const fraction = totalSec > 0 ? Math.max(0, Math.min(1, secondsLeft / totalSec)) : 0;
  const urgent = secondsLeft <= 10;
  const color = urgent ? '#ff4d6d' : secondsLeft <= totalSec / 2 ? '#ffd60a' : '#06d6a0';
  return (
    <div style={{ marginTop: 10 }} className={urgent ? 'timer-urgent' : undefined}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4,
      }}>
        <span style={{ color: '#8b7fb8', fontSize: '0.72rem' }}>⏱️ {label}</span>
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.3rem', lineHeight: 1, color,
        }}>
          {secondsLeft}s
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'rgba(168,85,247,0.12)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${fraction * 100}%`,
          background: color,
          boxShadow: `0 0 10px ${color}`,
          transition: 'width 0.25s linear, background 0.3s',
        }} />
      </div>
    </div>
  );
}

function VoteToggle({ label, value, onChange }: {
  label: string; value: boolean | null; onChange: (ok: boolean) => void;
}) {
  return (
    <div style={{
      display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 10,
      background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
    }}>
      <span style={{ color: '#8b7fb8', fontSize: '0.78rem', textAlign: 'center' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
        <button
          onClick={() => onChange(true)}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
            border: value === true ? '1px solid rgba(6,214,160,0.6)' : '1px solid rgba(168,85,247,0.2)',
            background: value === true ? 'rgba(6,214,160,0.15)' : 'transparent',
            color: value === true ? '#06d6a0' : '#8b7fb8', fontWeight: 700, fontSize: '0.85rem',
          }}
        >
          ✓ Richtig
        </button>
        <button
          onClick={() => onChange(false)}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer',
            border: value === false ? '1px solid rgba(255,77,109,0.6)' : '1px solid rgba(168,85,247,0.2)',
            background: value === false ? 'rgba(255,77,109,0.12)' : 'transparent',
            color: value === false ? '#ff4d6d' : '#8b7fb8', fontWeight: 700, fontSize: '0.85rem',
          }}
        >
          ✗ Falsch
        </button>
      </div>
    </div>
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
