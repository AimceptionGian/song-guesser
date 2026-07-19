import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api,
  saveLobbySession,
  clearLobbySession,
  saveHistoryCache,
  getHistoryCache,
  getLobbyPrefs,
  saveLobbyPrefs,
} from '../services/api-client';
import type { CategoryInfo, CategoryAvailability, LobbyPrefs } from '../services/api-client';
import {
  beginSpotifyAuth,
  exchangeCodeForToken,
  getPendingAuth,
  clearPendingAuth,
} from '../services/spotify-auth';

type LobbyPhase = 'form' | 'lobby';
type HistoryStatus = 'idle' | 'syncing' | 'done' | 'error';

const DEFAULT_CATEGORY = 'random_hits';

export default function LobbyScreen() {
  const navigate = useNavigate();
  const [gameCode, setGameCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [phase, setPhase] = useState<LobbyPhase>('form');

  // Lobby state (after creation or join)
  const [lobbyCode, setLobbyCode] = useState('');
  const [lobbyToken, setLobbyToken] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [lobbyPlayers, setLobbyPlayers] = useState<Array<{ id: string; name: string; avatar: string }>>([]);
  const [lobbySettings, setLobbySettings] = useState<{
    totalRounds: number;
    maxPoints: number;
    yearRange: { min: number; max: number };
    guessMode: 'type' | 'speak';
    answerTimeSec: number;
    buzzerEnabled: boolean;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Categories + Spotify history state
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [spotifyClientId, setSpotifyClientId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(DEFAULT_CATEGORY);
  const [categoryAvailability, setCategoryAvailability] = useState<Record<string, CategoryAvailability>>({});
  const [playersWithHistory, setPlayersWithHistory] = useState<string[]>([]);
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>('idle');

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Poll lobby players + category state
  const startPolling = useCallback((code: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const lobby = await api.getLobby(code);
        setLobbyPlayers(lobby.players);
        setLobbySettings({
          totalRounds: lobby.settings.totalRounds,
          maxPoints: lobby.settings.maxPoints,
          yearRange: lobby.settings.yearRange,
          guessMode: lobby.settings.guessMode ?? 'type',
          answerTimeSec: lobby.settings.answerTimeSec ?? 0,
          buzzerEnabled: lobby.settings.buzzerEnabled ?? false,
        });
        setSelectedCategory(lobby.category ?? DEFAULT_CATEGORY);
        setCategoryAvailability(lobby.categoryAvailability ?? {});
        setPlayersWithHistory(lobby.playersWithHistory ?? []);
        // If host started the game, auto-navigate
        if (lobby.state === 'starting' || lobby.state === 'in_game') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          navigate(`/game/${code}`);
        }
      } catch {
        // Lobby might be gone
      }
    }, 2000);
  }, [navigate]);

  // Load category definitions + Spotify client ID once we're in a lobby
  useEffect(() => {
    if (phase !== 'lobby') return;
    api.getCategories(true).then((r) => setCategories(r.categories)).catch(() => {});
    api.getConfig().then((r) => setSpotifyClientId(r.spotifyClientId)).catch(() => {});
  }, [phase]);

  // Persist the lobby session (survives reloads and the OAuth redirect)
  useEffect(() => {
    if (phase === 'lobby' && lobbyCode && playerId) {
      saveLobbySession({ code: lobbyCode, playerId, isHost });
    }
  }, [phase, lobbyCode, playerId, isHost]);

  // Auto-import a cached Spotify history into this lobby: once connected,
  // players shouldn't have to redo the OAuth dance for every new lobby.
  const historyImportedRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== 'lobby' || !lobbyCode || !playerId) return;
    if (historyStatus !== 'idle') return;
    if (playersWithHistory.includes(playerId)) return;
    if (historyImportedRef.current === lobbyCode) return;

    const cached = getHistoryCache();
    if (!cached) return;

    historyImportedRef.current = lobbyCode;
    setHistoryStatus('syncing');
    api.importCachedHistory({ playerId, lobbyCode, tracks: cached })
      .then(() => {
        setHistoryStatus('done');
        setPlayersWithHistory((prev) => [...new Set([...prev, playerId])]);
      })
      .catch(() => setHistoryStatus('idle'));
  }, [phase, lobbyCode, playerId, historyStatus, playersWithHistory]);

  // ?join=CODE deep link: preselect join mode with the code filled in
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get('join');
    if (joinCode && /^[A-Z0-9]{4,5}$/i.test(joinCode)) {
      setMode('join');
      setGameCode(joinCode.toUpperCase());
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Spotify OAuth callback: restore the lobby session and sync history ───
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get('code');
    const authError = params.get('error');
    if (!authCode && !authError) return;

    const pending = getPendingAuth();
    // Strip the OAuth params from the URL either way
    window.history.replaceState({}, '', window.location.pathname);
    if (!pending) return;

    // Restore the lobby session we had before the redirect
    setLobbyCode(pending.lobbyCode);
    setPlayerId(pending.playerId);
    setIsHost(pending.isHost);
    setLobbyToken(pending.token);
    setPhase('lobby');
    startPolling(pending.lobbyCode);

    if (authError || !authCode) {
      clearPendingAuth();
      setHistoryStatus('error');
      setError('Spotify-Verbindung abgebrochen.');
      return;
    }

    (async () => {
      setHistoryStatus('syncing');
      try {
        const cfg = await api.getConfig();
        if (!cfg.spotifyClientId) throw new Error('Spotify ist nicht konfiguriert');
        const accessToken = await exchangeCodeForToken(cfg.spotifyClientId, authCode);
        if (!accessToken) throw new Error('Token-Austausch fehlgeschlagen');
        const result = await api.syncSpotifyHistory({
          playerId: pending.playerId,
          accessToken,
          lobbyCode: pending.lobbyCode,
        });
        // Cache locally so future lobbies can import without re-auth
        if (result.trackList?.length) saveHistoryCache(result.trackList);
        setHistoryStatus('done');
        setPlayersWithHistory((prev) => [...new Set([...prev, pending.playerId])]);
        console.log(`[Spotify] ${result.tracks} Songs synchronisiert`);
      } catch (err) {
        setHistoryStatus('error');
        setError(err instanceof Error ? err.message : 'Spotify-Sync fehlgeschlagen');
      } finally {
        clearPendingAuth();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnectSpotify = useCallback(async () => {
    if (!spotifyClientId) {
      setError('Spotify ist nicht konfiguriert (SPOTIFY_CLIENT_ID fehlt im Backend).');
      return;
    }
    await beginSpotifyAuth(spotifyClientId, {
      lobbyCode,
      playerId,
      isHost,
      token: lobbyToken,
    });
  }, [spotifyClientId, lobbyCode, playerId, isHost, lobbyToken]);

  const handleSelectCategory = useCallback(async (name: string) => {
    if (!isHost) return;
    setSelectedCategory(name); // optimistic
    try {
      await api.setCategory(lobbyCode, name);
    } catch {
      setError('Kategorie konnte nicht gesetzt werden.');
    }
  }, [isHost, lobbyCode]);

  // For "join" mode: poll lobby info when code is entered
  const [lobbyInfo, setLobbyInfo] = useState<{
    totalRounds: number;
    maxPoints: number;
    yearRange: number;
    playerCount: number;
  } | null>(null);

  useEffect(() => {
    if (mode !== 'join' || gameCode.length < 4 || phase !== 'form') return;
    const timer = setTimeout(async () => {
      try {
        const lobby = await api.getLobby(gameCode.toUpperCase());
        setLobbyInfo({
          totalRounds: lobby.settings.totalRounds,
          maxPoints: lobby.settings.maxPoints,
          yearRange: lobby.settings.yearRange.max - lobby.settings.yearRange.min,
          playerCount: lobby.players.length,
        });
        setError(null);
      } catch {
        setLobbyInfo(null);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [mode, gameCode, phase]);

  const handleCreateGame = async () => {
    setLoading(true);
    setError(null);
    try {
      // Last-used settings from this browser pre-fill the new lobby
      const prefs = getLobbyPrefs();
      const result = await api.createLobby({
        hostName: playerName || 'Host',
        hostAvatar: '🎵',
        settings: {
          maxPlayers: 4,
          totalRounds: prefs.totalRounds,
          maxPoints: 4,
          timelineOnlyScoring: false,
          yearRange: { min: 1960, max: 2024 },
          guessMode: prefs.guessMode,
          answerTimeSec: prefs.answerTimeSec,
          buzzerEnabled: prefs.buzzerEnabled,
        },
      });
      setLobbyCode(result.code);
      setLobbyToken(result.token);
      setPlayerId(result.hostId);
      setIsHost(true);
      setPhase('lobby');
      startPolling(result.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backend nicht erreichbar. Starte mit `npm run dev` im workers/ Ordner.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGame = async () => {
    if (!gameCode.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.joinLobby(gameCode.toUpperCase(), {
        playerName: playerName || 'Player',
        playerAvatar: '🎤',
      });
      setLobbyCode(gameCode.toUpperCase());
      setLobbyToken(result.token);
      setPlayerId(result.playerId);
      setIsHost(false);
      setPhase('lobby');
      startPolling(gameCode.toUpperCase());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game nicht gefunden');
    } finally {
      setLoading(false);
    }
  };

  const handleStartGame = async () => {
    setLoading(true);
    setError(null);
    try {
      // Start game on backend
      await api.startGame(lobbyCode);
      // Navigate to game screen — GameScreen will call startMatch + drawCard
      navigate(`/game/${lobbyCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Spiel konnte nicht gestartet werden.');
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveLobby = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (playerId && lobbyCode) {
      api.leaveLobby(lobbyCode, playerId).catch(() => {});
    }
    clearLobbySession();
    historyImportedRef.current = null;
    setHistoryStatus('idle');
    setPhase('form');
    setLobbyCode('');
    setLobbyPlayers([]);
  };

  const inviteLink = `${window.location.origin}/?join=${lobbyCode}`;
  const [linkCopied, setLinkCopied] = useState(false);

  const handleShareLink = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Beat Timeline',
          text: `Spiel mit bei Beat Timeline! Game-Code: ${lobbyCode}`,
          url: inviteLink,
        });
        return;
      }
    } catch {
      // user cancelled the share sheet — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setError('Link konnte nicht kopiert werden.');
    }
  };

  /**
   * Host changes a rule: optimistic UI, push to the lobby, and remember it
   * in this browser so the next created lobby starts with the same rules.
   */
  const handleChangeSetting = async (patch: Partial<LobbyPrefs>) => {
    if (!isHost || !lobbySettings) return;
    const next = { ...lobbySettings, ...patch };
    // Buzzer needs a running clock and typed answers
    if (next.answerTimeSec === 0 || next.guessMode === 'speak') {
      next.buzzerEnabled = false;
    }
    setLobbySettings(next); // optimistic
    saveLobbyPrefs({
      totalRounds: next.totalRounds,
      guessMode: next.guessMode,
      answerTimeSec: next.answerTimeSec,
      buzzerEnabled: next.buzzerEnabled,
    });
    try {
      await api.updateSettings(lobbyCode, {
        totalRounds: next.totalRounds,
        guessMode: next.guessMode,
        answerTimeSec: next.answerTimeSec,
        buzzerEnabled: next.buzzerEnabled,
      });
    } catch {
      setError('Einstellung konnte nicht gespeichert werden.');
    }
  };

  const handleChangeRounds = (delta: number) => {
    if (!lobbySettings) return;
    const next = Math.max(3, Math.min(10, lobbySettings.totalRounds + delta));
    if (next !== lobbySettings.totalRounds) handleChangeSetting({ totalRounds: next });
  };

  const displayInfo = mode === 'join' && lobbyInfo && phase === 'form'
    ? lobbyInfo
    : lobbySettings
      ? {
          totalRounds: lobbySettings.totalRounds,
          maxPoints: lobbySettings.maxPoints,
          yearRange: lobbySettings.yearRange.max - lobbySettings.yearRange.min,
          playerCount: lobbyPlayers.length,
        }
      : { totalRounds: 5, maxPoints: 4, yearRange: 64, playerCount: 0 };

  // ─── Lobby Waiting Room ───
  if (phase === 'lobby') {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        minHeight: '100vh', padding: '24px 16px 40px', gap: 20,
        position: 'relative', zIndex: 1,
      }}>
        <div className="fade-up" style={{ textAlign: 'center', marginTop: 20 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            boxShadow: '0 0 30px rgba(168,85,247,0.5)',
            margin: '0 auto 16px', fontSize: 26,
          }}>🎵</div>
          <h1 style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(2rem,8vw,3.5rem)', lineHeight: 0.95,
            letterSpacing: '0.02em', textAlign: 'center',
          }}>
            LOBBY
          </h1>
        </div>

        {/* Game Code Display */}
        <div className="pop-in" style={{
          textAlign: 'center',
          padding: '20px 32px',
          borderRadius: 16,
          background: '#13121f',
          border: '1px solid rgba(168,85,247,0.3)',
          boxShadow: '0 0 40px rgba(168,85,247,0.15)',
        }}>
          <div style={{ color: '#8b7fb8', fontSize: '0.82rem', marginBottom: 8 }}>Game-Code</div>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif",
            fontSize: 'clamp(2.5rem, 10vw, 4rem)',
            letterSpacing: '0.15em',
            background: 'linear-gradient(90deg, #a855f7, #f72585)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            {lobbyCode}
          </div>
          <div style={{ color: '#6a5f8a', fontSize: '0.75rem', marginTop: 8 }}>
            Teile diesen Code mit anderen Spielern
          </div>
          <button
            onClick={handleShareLink}
            style={{
              marginTop: 12, padding: '8px 16px', borderRadius: 10, border: '1px solid rgba(168,85,247,0.35)',
              background: 'rgba(168,85,247,0.1)', color: '#c4b8ff', cursor: 'pointer',
              fontSize: '0.8rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {linkCopied ? '✓ Link kopiert!' : '🔗 Einladungslink teilen'}
          </button>
        </div>

        {/* Players in Lobby */}
        <div className="fade-up" style={{ width: '100%', maxWidth: 400, animationDelay: '0.1s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>👥 {lobbyPlayers.length} Spieler</span>
          </div>
          <div style={{
            padding: '16px 12px', borderRadius: 16,
            background: '#13121f', border: '1px solid rgba(168,85,247,0.2)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {lobbyPlayers.length === 0 ? (
              <div style={{ color: '#8b7fb8', fontSize: '0.9rem', textAlign: 'center' }}>
                Warte auf Spieler…
              </div>
            ) : (
              lobbyPlayers.map((p) => {
                const isSelf = p.id === playerId;
                const hasHistory = playersWithHistory.includes(p.id) || (isSelf && historyStatus === 'done');
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 10,
                    background: isSelf ? 'rgba(168,85,247,0.12)' : 'transparent',
                  }}>
                    <span style={{ fontSize: 20 }}>{p.avatar}</span>
                    <span style={{ color: '#f0eeff', fontWeight: 600 }}>{p.name}</span>
                    {isSelf && (
                      <span style={{
                        fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6,
                        background: 'rgba(168,85,247,0.2)', color: '#a855f7',
                      }}>DU</span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hasHistory ? (
                        <span title="Spotify verbunden" style={{
                          fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6,
                          background: 'rgba(29,185,84,0.15)', color: '#1db954', fontWeight: 600,
                        }}>✓ Spotify</span>
                      ) : isSelf ? (
                        <button
                          onClick={handleConnectSpotify}
                          disabled={historyStatus === 'syncing'}
                          style={{
                            fontSize: '0.72rem', padding: '4px 10px', borderRadius: 8,
                            border: 'none', cursor: historyStatus === 'syncing' ? 'default' : 'pointer',
                            background: '#1db954', color: '#04160a', fontWeight: 700,
                            opacity: historyStatus === 'syncing' ? 0.6 : 1,
                          }}
                        >
                          {historyStatus === 'syncing' ? '⏳ Sync…' : '♫ Spotify verbinden'}
                        </button>
                      ) : (
                        <span title="Noch nicht verbunden" style={{ fontSize: '0.7rem', color: '#6a5f8a' }}>–</span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Category Selection */}
        <div className="fade-up" style={{ width: '100%', maxWidth: 400, animationDelay: '0.14s' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>
              🎯 Kategorie {isHost ? 'wählen' : ''}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {categories.map((cat) => {
              const avail = categoryAvailability[cat.name];
              const eligible = avail?.eligible ?? !cat.requiresHistory;
              const selected = selectedCategory === cat.name;
              const clickable = isHost && eligible;
              return (
                <button
                  key={cat.name}
                  onClick={() => clickable && handleSelectCategory(cat.name)}
                  disabled={!clickable}
                  title={!eligible ? avail?.reason : cat.description}
                  style={{
                    textAlign: 'left', padding: '12px 12px', borderRadius: 12,
                    border: selected ? '1px solid rgba(6,214,160,0.6)' : '1px solid rgba(168,85,247,0.2)',
                    background: selected ? 'rgba(6,214,160,0.08)' : '#13121f',
                    cursor: clickable ? 'pointer' : 'default',
                    opacity: eligible ? 1 : 0.45,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{cat.emoji}</div>
                  <div style={{
                    color: selected ? '#06d6a0' : '#f0eeff', fontWeight: 700, fontSize: '0.85rem',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    {cat.label}
                    {selected && <span style={{ fontSize: '0.75rem' }}>✓</span>}
                  </div>
                  <div style={{ color: '#8b7fb8', fontSize: '0.68rem', marginTop: 3, lineHeight: 1.4 }}>
                    {cat.description}
                  </div>
                  {!eligible && avail?.reason && (
                    <div style={{ color: '#ffd60a', fontSize: '0.65rem', marginTop: 4 }}>
                      ⚠ {avail.reason}
                    </div>
                  )}
                  {eligible && cat.requiresHistory && avail && (
                    <div style={{ color: '#06d6a0', fontSize: '0.65rem', marginTop: 4 }}>
                      {avail.totalSongs} Songs verfügbar
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {!isHost && (
            <div style={{ color: '#6a5f8a', fontSize: '0.7rem', marginTop: 6, textAlign: 'center' }}>
              Der Host wählt die Kategorie
            </div>
          )}
        </div>

        {/* Settings (host adjustable, everyone sees them) */}
        <div className="fade-up" style={{
          display: 'grid', gridTemplateColumns: '1fr', gap: 10,
          width: '100%', maxWidth: 400, animationDelay: '0.18s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>⚙️ Regeln {isHost ? '' : '(nur Host)'}</span>
          </div>

          {/* Cards per player */}
          <div style={settingRowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🃏</span>
              <span style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>Karten pro Spieler</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {isHost && (
                <button
                  onClick={() => handleChangeRounds(-1)}
                  disabled={(lobbySettings?.totalRounds ?? 5) <= 3}
                  style={stepperButtonStyle((lobbySettings?.totalRounds ?? 5) <= 3)}
                >−</button>
              )}
              <span style={{
                fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem',
                color: '#a855f7', minWidth: 28, textAlign: 'center', lineHeight: 1,
              }}>
                {displayInfo.totalRounds}
              </span>
              {isHost && (
                <button
                  onClick={() => handleChangeRounds(1)}
                  disabled={(lobbySettings?.totalRounds ?? 5) >= 10}
                  style={stepperButtonStyle((lobbySettings?.totalRounds ?? 5) >= 10)}
                >+</button>
              )}
            </div>
          </div>

          {/* Guess mode: type vs. speak */}
          <div style={settingRowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{(lobbySettings?.guessMode ?? 'type') === 'speak' ? '🗣️' : '⌨️'}</span>
              <div>
                <div style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>Rate-Modus</div>
                <div style={{ color: '#6a5f8a', fontSize: '0.68rem', marginTop: 2 }}>
                  {(lobbySettings?.guessMode ?? 'type') === 'speak'
                    ? 'Laut ansagen — Mitspieler bewerten'
                    : 'Eintippen — automatische Wertung'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <OptionChip
                active={(lobbySettings?.guessMode ?? 'type') === 'type'}
                disabled={!isHost}
                onClick={() => handleChangeSetting({ guessMode: 'type' })}
              >⌨️ Tippen</OptionChip>
              <OptionChip
                active={(lobbySettings?.guessMode ?? 'type') === 'speak'}
                disabled={!isHost}
                onClick={() => handleChangeSetting({ guessMode: 'speak' })}
              >🗣️ Ansagen</OptionChip>
            </div>
          </div>

          {/* Answer time */}
          <div style={settingRowStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>⏱️</span>
              <div>
                <div style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>Antwortzeit</div>
                <div style={{ color: '#6a5f8a', fontSize: '0.68rem', marginTop: 2 }}>
                  {(lobbySettings?.answerTimeSec ?? 0) === 0 ? 'Kein Zeitlimit' : 'Pro Zug, ab Karte ziehen'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {[0, 30, 45, 60, 90].map((secs) => (
                <OptionChip
                  key={secs}
                  active={(lobbySettings?.answerTimeSec ?? 0) === secs}
                  disabled={!isHost}
                  onClick={() => handleChangeSetting({ answerTimeSec: secs })}
                >{secs === 0 ? 'Aus' : `${secs}s`}</OptionChip>
              ))}
            </div>
          </div>

          {/* Buzzer */}
          <div style={{
            ...settingRowStyle,
            opacity: (lobbySettings?.answerTimeSec ?? 0) > 0 && (lobbySettings?.guessMode ?? 'type') === 'type' ? 1 : 0.45,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <div>
                <div style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>Buzzer</div>
                <div style={{ color: '#6a5f8a', fontSize: '0.68rem', marginTop: 2 }}>
                  {(lobbySettings?.answerTimeSec ?? 0) === 0
                    ? 'Braucht eine Antwortzeit'
                    : (lobbySettings?.guessMode ?? 'type') === 'speak'
                      ? 'Nur im Tipp-Modus'
                      : 'Nach Zeitablauf: 1 Punkt klauen'}
                </div>
              </div>
            </div>
            <OptionChip
              active={!!lobbySettings?.buzzerEnabled}
              disabled={!isHost || (lobbySettings?.answerTimeSec ?? 0) === 0 || (lobbySettings?.guessMode ?? 'type') === 'speak'}
              onClick={() => handleChangeSetting({ buzzerEnabled: !lobbySettings?.buzzerEnabled })}
            >{lobbySettings?.buzzerEnabled ? 'An' : 'Aus'}</OptionChip>
          </div>
        </div>

        {/* Actions */}
        <div className="fade-up" style={{ width: '100%', maxWidth: 400, animationDelay: '0.25s' }}>
          {isHost ? (
            <>
              <button
                onClick={handleStartGame}
                disabled={loading}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', padding: '18px 24px', borderRadius: 16, border: 'none',
                  cursor: loading ? 'default' : 'pointer',
                  background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #f72585 100%)',
                  color: 'white', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em',
                  boxShadow: loading ? 'none' : '0 0 40px rgba(168,85,247,0.4)',
                  opacity: loading ? 0.6 : 1,
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 0 55px rgba(168,85,247,0.55)'; }}}
                onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(168,85,247,0.4)'; }}}
              >
                {loading ? '⏳ Wird gestartet…' : '🎮 Spiel starten'}
              </button>
              <button
                onClick={handleLeaveLobby}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  width: '100%', padding: '12px', borderRadius: 12, border: 'none',
                  cursor: 'pointer', marginTop: 8,
                  background: 'rgba(255,77,109,0.1)', color: '#ff4d6d',
                  fontWeight: 600, fontSize: '0.9rem',
                }}
              >
                Lobby verlassen
              </button>
            </>
          ) : (
            <p style={{ color: '#8b7fb8', fontSize: '0.9rem', textAlign: 'center' }}>
              Warte darauf, dass der Host das Spiel startet…
            </p>
          )}
        </div>

        {error && <div style={{ color: '#ff4d6d', fontSize: '0.85rem', textAlign: 'center' }}>{error}</div>}
      </div>
    );
  }

  // ─── Create / Join Form ───
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: '100vh', padding: '24px 16px 40px', gap: 20,
      position: 'relative', zIndex: 1,
    }}>
      {/* ─── Header ─── */}
      <div className="fade-up" style={{ textAlign: 'center', marginTop: 20 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
          boxShadow: '0 0 30px rgba(168,85,247,0.5)',
          margin: '0 auto 16px', fontSize: 26,
        }}>🎵</div>
        <h1 style={{
          fontFamily: "'Bebas Neue', sans-serif",
          fontSize: 'clamp(3rem,12vw,6rem)', lineHeight: 0.95,
          letterSpacing: '0.02em', textAlign: 'center',
        }}>
          BEAT<br />
          <span style={{
            background: 'linear-gradient(90deg, #a855f7, #f72585)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>TIMELINE</span>
        </h1>
        <p style={{ color: '#8b7fb8', fontSize: '0.95rem', textAlign: 'center', maxWidth: 340, margin: '12px auto 0', lineHeight: 1.5 }}>
          Ziehe Karten · Platziere Songs auf der Timeline · Rate Interpret &amp; Titel
        </p>
      </div>

      {/* ─── Mode Toggle ─── */}
      <div className="fade-up" style={{
        display: 'flex', gap: 8, animationDelay: '0.25s',
        background: '#0a0a12', borderRadius: 12, padding: 4,
        border: '1px solid rgba(168,85,247,0.15)',
      }}>
        <TabButton active={mode === 'create'} onClick={() => { setMode('create'); setError(null); }}>✨ Erstellen</TabButton>
        <TabButton active={mode === 'join'} onClick={() => { setMode('join'); setError(null); }}>🔗 Beitreten</TabButton>
      </div>

      {/* ─── Create / Join Form ─── */}
      <div className="fade-up" style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: '24px 16px', borderRadius: 16,
        background: '#13121f', border: '1px solid rgba(168,85,247,0.2)',
        width: '100%', maxWidth: 400, animationDelay: '0.3s',
      }}>
        <input
          type="text"
          placeholder={mode === 'create' ? 'Dein Name (optional)' : 'Dein Name (optional)'}
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          style={inputStyle}
        />
        {mode === 'join' && (
          <input
            type="text"
            placeholder="Game-Code (z.B. ABCD)"
            value={gameCode}
            onChange={(e) => setGameCode(e.target.value.toUpperCase())}
            maxLength={4}
            style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.3rem' }}
          />
        )}
        <button
          onClick={mode === 'create' ? handleCreateGame : handleJoinGame}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            width: '100%', padding: '18px 24px', borderRadius: 16, border: 'none',
            cursor: loading ? 'default' : 'pointer',
            background: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #f72585 100%)',
            color: 'white', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em',
            boxShadow: loading ? 'none' : '0 0 40px rgba(168,85,247,0.4)',
            opacity: loading ? 0.6 : 1,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.boxShadow = '0 0 55px rgba(168,85,247,0.55)'; }}}
          onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(168,85,247,0.4)'; }}}
        >
          {loading ? '⏳ Wird geladen…' : mode === 'create' ? '🎮 Game erstellen' : '🚪 Game beitreten'}
        </button>
        {error && <div style={{ color: '#ff4d6d', fontSize: '0.85rem', textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  );
}

// ─── Helpers ───

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
        background: active ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'transparent',
        color: active ? 'white' : '#8b7fb8',
        fontWeight: 600, fontSize: '0.9rem',
        transition: 'all 0.2s',
      }}
    >
      {children}
    </button>
  );
}

function OptionChip({ active, disabled, onClick, children }: {
  active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px', borderRadius: 8,
        border: active ? '1px solid rgba(6,214,160,0.6)' : '1px solid rgba(168,85,247,0.25)',
        background: active ? 'rgba(6,214,160,0.12)' : 'transparent',
        color: active ? '#06d6a0' : '#8b7fb8',
        fontSize: '0.75rem', fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

const settingRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '12px 14px', borderRadius: 12,
  background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.15)',
};

const stepperButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(168,85,247,0.35)',
  background: disabled ? 'transparent' : 'rgba(168,85,247,0.15)',
  color: disabled ? '#6a5f8a' : '#a855f7',
  fontSize: '1.1rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
});

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12,
  outline: 'none', background: '#1e1c2e',
  border: '1px solid rgba(168,85,247,0.25)',
  color: '#f0eeff', fontSize: '1rem',
};
