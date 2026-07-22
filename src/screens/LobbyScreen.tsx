import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sfx } from '../services/sfx';
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

// Akzentfarbe pro Kategorie-Kachel — gibt jeder Kachel ihren eigenen Charakter
const CATEGORY_ACCENTS = ['var(--lime)', 'var(--pink)', 'var(--cyan)', 'var(--orange)'];

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

  // Kleiner Pop-Sound, wenn jemand Neues die Lobby betritt
  const prevPlayerCountRef = useRef(0);
  useEffect(() => {
    if (lobbyPlayers.length > prevPlayerCountRef.current && prevPlayerCountRef.current > 0) {
      sfx.join();
    }
    prevPlayerCountRef.current = lobbyPlayers.length;
  }, [lobbyPlayers.length]);
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
    const syncLobby = async () => {
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
    };
    // Sofort einmal laden — sonst sind die Regler in den ersten 2 Sekunden
    // stumm (lobbySettings ist bis zum ersten Poll-Tick null).
    void syncLobby();
    pollingRef.current = setInterval(syncLobby, 2000);
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
  // Mobil: eine gestapelte Flex-Spalte (unverändert). Ab Desktop-Breite
  // wird daraus ein zweispaltiges Dashboard — die .lobby-cols/.lobby-col-
  // Wrapper sind mobil per display:contents unsichtbar (siehe global.css),
  // sodass sich am Mobile-Layout nichts ändert.
  if (phase === 'lobby') {
    return (
      <div className="lobby-page">
        <Ticker text={`GAME ${lobbyCode} · WARTERAUM · CREW SAMMELN ·`} />

        <div className="lobby-room">

        {/* Kopf */}
        <div className="fade-up lobby-head" style={{ textAlign: 'center', marginTop: 6 }}>
          <h1 className="heading-xl" style={{ position: 'relative', display: 'inline-block' }}>
            <span className="outline-text">Warte</span>
            <span style={{ color: 'var(--lime)' }}>raum</span>
            <span
              className="sticker pink tilt-r"
              style={{ position: 'absolute', top: -12, right: -28 }}
            >
              {lobbyPlayers.length === 1 ? '1 Spieler' : `${lobbyPlayers.length} Spieler`}
            </span>
          </h1>
          <p className="serif-note" style={{ color: 'var(--muted)', fontSize: '1.05rem', marginTop: 6 }}>
            gleich geht's los …
          </p>
        </div>

        <div className="lobby-cols">
        <div className="lobby-col lobby-col-left">

        {/* Game-Code-Ticket */}
        <div className="pop-in panel lobby-section lobby-code" style={{
          textAlign: 'center',
          padding: '22px 30px',
          overflow: 'hidden',
        }}>
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.5,
              background: 'radial-gradient(ellipse 90% 70% at 50% -20%, rgba(214,245,69,0.12), transparent)',
            }}
          />
          <div className="mono-label" style={{ marginBottom: 12 }}>Game-Code</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {lobbyCode.split('').map((ch, i) => (
              <span
                key={i}
                className="display pop-in"
                style={{
                  width: 'clamp(44px, 13vw, 58px)',
                  height: 'clamp(56px, 16vw, 72px)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 'clamp(1.6rem, 7vw, 2.3rem)',
                  borderRadius: 12,
                  background: 'rgba(244,241,255,0.05)',
                  border: '1px solid var(--line-strong)',
                  color: i % 2 === 0 ? 'var(--lime)' : 'var(--pink)',
                  animationDelay: `${i * 0.07}s`,
                }}
              >
                {ch}
              </span>
            ))}
          </div>
          <div style={{ color: 'var(--dim)', fontSize: '0.78rem', marginTop: 12 }}>
            Teile diesen Code mit deiner Crew
          </div>
          <button onClick={handleShareLink} className="btn-ghost" style={{ margin: '12px auto 0', fontSize: '0.8rem', padding: '9px 16px' }}>
            {linkCopied ? '✓ Link kopiert!' : '🔗 Einladungslink teilen'}
          </button>
        </div>

        {/* Line-up (Spieler) */}
        <section className="fade-up lobby-section lobby-lineup" style={{ animationDelay: '0.1s' }}>
          <SectionHeading index="01" title="Line-up" />
          <div className="panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lobbyPlayers.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center', padding: '10px 0' }}>
                <span className="eq paused" style={{ marginRight: 8, verticalAlign: 'middle' }}>
                  <span /><span /><span /><span />
                </span>
                Warte auf Spieler…
              </div>
            ) : (
              lobbyPlayers.map((p) => {
                const isSelf = p.id === playerId;
                const hasHistory = playersWithHistory.includes(p.id) || (isSelf && historyStatus === 'done');
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 12,
                    background: isSelf ? 'rgba(214,245,69,0.06)' : 'transparent',
                    border: isSelf ? '1px solid rgba(214,245,69,0.2)' : '1px solid transparent',
                  }}>
                    <span style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      display: 'grid', placeItems: 'center', fontSize: 17,
                      background: 'rgba(139,92,246,0.18)', border: '1px solid var(--line)',
                    }}>{p.avatar}</span>
                    <span style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '0.92rem' }}>{p.name}</span>
                    {isSelf && <span className="sticker" style={{ fontSize: '0.52rem', padding: '3px 7px' }}>Du</span>}
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hasHistory ? (
                        <span title="Spotify verbunden" style={{
                          fontFamily: 'var(--font-mono)', fontSize: '0.66rem', fontWeight: 600,
                          padding: '3px 9px', borderRadius: 999,
                          background: 'rgba(30,215,96,0.14)', color: 'var(--green)',
                          border: '1px solid rgba(30,215,96,0.3)',
                        }}>✓ SPOTIFY</span>
                      ) : isSelf ? (
                        <button
                          onClick={handleConnectSpotify}
                          disabled={historyStatus === 'syncing'}
                          style={{
                            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', fontWeight: 600,
                            padding: '5px 11px', borderRadius: 999,
                            border: 'none', cursor: historyStatus === 'syncing' ? 'default' : 'pointer',
                            background: 'var(--green)', color: '#04160a',
                            opacity: historyStatus === 'syncing' ? 0.6 : 1,
                            transition: 'transform 0.12s',
                          }}
                        >
                          {historyStatus === 'syncing' ? '⏳ SYNC…' : '♫ SPOTIFY VERBINDEN'}
                        </button>
                      ) : (
                        <span title="Noch nicht verbunden" style={{ fontSize: '0.7rem', color: 'var(--dim)' }}>–</span>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>
        </div>

        <div className="lobby-col lobby-col-right">

        {/* Kategorie */}
        <section className="fade-up lobby-section lobby-category" style={{ animationDelay: '0.14s' }}>
          <SectionHeading index="02" title={isHost ? 'Kategorie wählen' : 'Kategorie'} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {categories.map((cat, idx) => {
              const avail = categoryAvailability[cat.name];
              const eligible = avail?.eligible ?? !cat.requiresHistory;
              const selected = selectedCategory === cat.name;
              const clickable = isHost && eligible;
              const accent = CATEGORY_ACCENTS[idx % CATEGORY_ACCENTS.length];
              return (
                <button
                  key={cat.name}
                  onClick={() => clickable && handleSelectCategory(cat.name)}
                  disabled={!clickable}
                  title={!eligible ? avail?.reason : cat.description}
                  style={{
                    position: 'relative',
                    textAlign: 'left', padding: '14px 12px 12px', borderRadius: 16,
                    border: selected ? `2px solid ${accent}` : '1px solid var(--line)',
                    background: selected
                      ? `linear-gradient(160deg, color-mix(in srgb, ${accent} 12%, var(--bg-2)), var(--bg-2))`
                      : 'var(--bg-2)',
                    cursor: clickable ? 'pointer' : 'default',
                    opacity: eligible ? 1 : 0.42,
                    transform: selected ? 'rotate(-0.6deg) scale(1.02)' : 'none',
                    transition: 'border-color 0.15s, background 0.15s, transform 0.2s',
                  }}
                >
                  {selected && (
                    <span
                      className="sticker"
                      style={{
                        position: 'absolute', top: -9, right: -6,
                        fontSize: '0.5rem', padding: '3px 7px',
                        background: accent, color: '#0b0a12',
                      }}
                    >
                      ✓ Gewählt
                    </span>
                  )}
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{cat.emoji}</div>
                  <div
                    className="display"
                    style={{ color: selected ? accent : 'var(--ink)', fontSize: '0.78rem', letterSpacing: '0.02em' }}
                  >
                    {cat.label}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.68rem', marginTop: 4, lineHeight: 1.45 }}>
                    {cat.description}
                  </div>
                  {!eligible && avail?.reason && (
                    <div style={{ color: 'var(--gold)', fontSize: '0.64rem', marginTop: 5 }}>
                      ⚠ {avail.reason}
                    </div>
                  )}
                  {eligible && cat.requiresHistory && avail && (
                    <div style={{
                      fontFamily: 'var(--font-mono)', color: 'var(--green)',
                      fontSize: '0.62rem', marginTop: 5,
                    }}>
                      {avail.totalSongs} Songs verfügbar
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {!isHost && (
            <div style={{ color: 'var(--dim)', fontSize: '0.7rem', marginTop: 6, textAlign: 'center' }}>
              Der Host wählt die Kategorie
            </div>
          )}
        </section>

        {/* Regeln */}
        <section className="fade-up lobby-section lobby-rules" style={{ animationDelay: '0.18s' }}>
          <SectionHeading index="03" title={isHost ? 'Regeln' : 'Regeln (nur Host)'} />
          <div className="lobby-rules-grid" style={{ display: 'grid', gap: 10 }}>

            {/* Karten pro Spieler */}
            <div style={settingRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>🃏</span>
                <span style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 500 }}>Karten pro Spieler</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {isHost && (
                  <button
                    onClick={() => handleChangeRounds(-1)}
                    disabled={(lobbySettings?.totalRounds ?? 5) <= 3}
                    style={stepperButtonStyle((lobbySettings?.totalRounds ?? 5) <= 3)}
                  >−</button>
                )}
                <span className="display" style={{
                  fontSize: '1.4rem', color: 'var(--lime)',
                  minWidth: 32, textAlign: 'center', lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
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

            {/* Rate-Modus: tippen vs. ansagen */}
            <div style={settingRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>{(lobbySettings?.guessMode ?? 'type') === 'speak' ? '🗣️' : '⌨️'}</span>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 500 }}>Rate-Modus</div>
                  <div style={{ color: 'var(--dim)', fontSize: '0.68rem', marginTop: 2 }}>
                    {(lobbySettings?.guessMode ?? 'type') === 'speak'
                      ? 'Laut ansagen — Mitspieler bewerten'
                      : 'Eintippen — automatische Wertung'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className={`chip${(lobbySettings?.guessMode ?? 'type') === 'type' ? ' active' : ''}`}
                  disabled={!isHost}
                  onClick={() => handleChangeSetting({ guessMode: 'type' })}
                >⌨ Tippen</button>
                <button
                  className={`chip${(lobbySettings?.guessMode ?? 'type') === 'speak' ? ' active' : ''}`}
                  disabled={!isHost}
                  onClick={() => handleChangeSetting({ guessMode: 'speak' })}
                >🗣 Ansagen</button>
              </div>
            </div>

            {/* Antwortzeit */}
            <div style={settingRowStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>⏱️</span>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 500 }}>Antwortzeit</div>
                  <div style={{ color: 'var(--dim)', fontSize: '0.68rem', marginTop: 2 }}>
                    {(lobbySettings?.answerTimeSec ?? 0) === 0 ? 'Kein Zeitlimit' : 'Pro Zug, ab Karte ziehen'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {[0, 30, 45, 60, 90].map((secs) => (
                  <button
                    key={secs}
                    className={`chip${(lobbySettings?.answerTimeSec ?? 0) === secs ? ' active' : ''}`}
                    disabled={!isHost}
                    onClick={() => handleChangeSetting({ answerTimeSec: secs })}
                  >{secs === 0 ? 'Aus' : `${secs}s`}</button>
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
                  <div style={{ color: 'var(--muted)', fontSize: '0.85rem', fontWeight: 500 }}>Buzzer</div>
                  <div style={{ color: 'var(--dim)', fontSize: '0.68rem', marginTop: 2 }}>
                    {(lobbySettings?.answerTimeSec ?? 0) === 0
                      ? 'Braucht eine Antwortzeit'
                      : (lobbySettings?.guessMode ?? 'type') === 'speak'
                        ? 'Nur im Tipp-Modus'
                        : 'Nach Zeitablauf: 1 Punkt klauen'}
                  </div>
                </div>
              </div>
              <button
                className={`chip${lobbySettings?.buzzerEnabled ? ' active' : ''}`}
                disabled={!isHost || (lobbySettings?.answerTimeSec ?? 0) === 0 || (lobbySettings?.guessMode ?? 'type') === 'speak'}
                onClick={() => handleChangeSetting({ buzzerEnabled: !lobbySettings?.buzzerEnabled })}
              >{lobbySettings?.buzzerEnabled ? 'An' : 'Aus'}</button>
            </div>
          </div>
        </section>
        </div>
        </div>

        {/* Aktionen */}
        <div className="fade-up lobby-section lobby-actions" style={{ animationDelay: '0.25s' }}>
          {isHost ? (
            <>
              <button onClick={handleStartGame} disabled={loading} className="btn-primary">
                {loading ? (<><span className="spinner" /> Wird gestartet…</>) : '▶ Spiel starten'}
              </button>
              <button
                onClick={handleLeaveLobby}
                className="btn-ghost danger"
                style={{ width: '100%', marginTop: 10 }}
              >
                Lobby verlassen
              </button>
            </>
          ) : (
            <p style={{
              color: 'var(--muted)', fontSize: '0.9rem', textAlign: 'center',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}>
              <span className="eq"><span /><span /><span /><span /></span>
              Warte darauf, dass der Host das Spiel startet…
            </p>
          )}
        </div>

        {error && <div className="error-banner lobby-section lobby-error">{error}</div>}
        </div>
      </div>
    );
  }

  // ─── Create / Join Form ───
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: '100vh', padding: '0 16px 48px', gap: 24,
      position: 'relative', zIndex: 1,
    }}>
      <Ticker text="BEAT TIMELINE · RATE DEN SONG · PLATZIERE DAS JAHR · HÖR GENAU HIN ·" />

      {/* ─── Hero ─── */}
      <div className="fade-up" style={{ textAlign: 'center', marginTop: 'clamp(18px, 6vh, 56px)', position: 'relative' }}>
        <h1 className="heading-giant" style={{ position: 'relative', display: 'inline-block' }}>
          <span className="outline-text" style={{ display: 'block' }}>Beat</span>
          <span style={{ display: 'block', color: 'var(--lime)', textShadow: '5px 5px 0 rgba(255,79,163,0.55)' }}>
            Time
          </span>
          <span style={{ display: 'block', color: 'var(--pink)', textShadow: '5px 5px 0 rgba(214,245,69,0.35)' }}>
            line
          </span>
          {/* Vinyl im Layout verankert */}
          <span
            aria-hidden
            className="vinyl spinning"
            style={{
              position: 'absolute',
              width: 'clamp(64px, 18vw, 104px)',
              height: 'clamp(64px, 18vw, 104px)',
              right: 'clamp(-40px, -8vw, -56px)',
              top: '30%',
              zIndex: -1,
              opacity: 0.9,
            }}
          >
            <span style={{ width: '26%', height: '26%', borderRadius: '50%', background: 'var(--pink)', zIndex: 1 }} />
          </span>
          <span
            className="sticker gold"
            style={{ position: 'absolute', top: -14, left: -18, fontSize: '0.58rem' }}
          >
            Multiplayer
          </span>
        </h1>
        <p className="serif-note" style={{ color: 'var(--muted)', fontSize: 'clamp(1.05rem, 3.5vw, 1.3rem)', maxWidth: 340, margin: '14px auto 0', lineHeight: 1.5 }}>
          Karte ziehen, Song erkennen,<br />das Jahr auf die Timeline setzen.
        </p>
      </div>

      {/* ─── Modus-Umschalter ─── */}
      <div className="fade-up" style={{ display: 'flex', gap: 22, animationDelay: '0.2s' }}>
        <ModeTab active={mode === 'create'} onClick={() => { setMode('create'); setError(null); }}>
          Neues Spiel
        </ModeTab>
        <ModeTab active={mode === 'join'} onClick={() => { setMode('join'); setError(null); }}>
          Beitreten
        </ModeTab>
      </div>

      {/* ─── Formular ─── */}
      <div className="fade-up panel" style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: '24px 18px',
        width: '100%', maxWidth: 400, animationDelay: '0.28s',
      }}>
        <label className="mono-label" htmlFor="player-name">Dein Name</label>
        <input
          id="player-name"
          className="text-input"
          type="text"
          placeholder="Dein Name (optional)"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
        />
        {mode === 'join' && (
          <>
            <label className="mono-label" htmlFor="game-code" style={{ marginTop: 4 }}>Game-Code</label>
            <input
              id="game-code"
              className="text-input code"
              type="text"
              placeholder="ABCD"
              value={gameCode}
              onChange={(e) => setGameCode(e.target.value.toUpperCase())}
              maxLength={4}
            />
            {lobbyInfo && (
              <div className="panel-inset pop-in" style={{
                display: 'flex', justifyContent: 'center', gap: 16, padding: '9px 12px',
                fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)',
              }}>
                <span>👥 {lobbyInfo.playerCount} in der Lobby</span>
                <span>🃏 {lobbyInfo.totalRounds} Karten</span>
              </div>
            )}
          </>
        )}
        <button
          onClick={mode === 'create' ? handleCreateGame : handleJoinGame}
          disabled={loading}
          className={`btn-primary${mode === 'join' ? ' pink' : ''}`}
          style={{ marginTop: 6 }}
        >
          {loading ? (<><span className="spinner" /> Wird geladen…</>) : mode === 'create' ? '✦ Game erstellen' : '→ Game beitreten'}
        </button>
        {error && <div className="error-banner">{error}</div>}
      </div>

      {/* Feature-Zeile */}
      <div className="fade-up" style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 22px',
        animationDelay: '0.36s', maxWidth: 420,
      }}>
        {['♫ Spotify-History', '🃏 Timeline-Duell', '🔔 Buzzer-Steals'].map((f) => (
          <span key={f} style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--dim)',
            textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>{f}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ───

/** Laufender Ticker am oberen Rand */
function Ticker({ text }: { text: string }) {
  const chunk = ` ${text} `;
  return (
    <div className="marquee" style={{ width: '100%', padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="marquee-inner">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i}>{i % 2 === 0 ? chunk : <em>{chunk}</em>}</span>
        ))}
      </div>
    </div>
  );
}

/** Editorial-Abschnittskopf: "01 — Line-up" */
function SectionHeading({ index, title }: { index: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
      <span className="display" style={{ fontSize: '0.85rem', color: 'var(--pink)' }}>{index}</span>
      <span className="display" style={{ fontSize: '0.85rem', letterSpacing: '0.05em' }}>{title}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line)', alignSelf: 'center' }} />
    </div>
  );
}

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="display"
      style={{
        padding: '8px 2px',
        border: 'none',
        borderBottom: active ? '3px solid var(--lime)' : '3px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
        color: active ? 'var(--ink)' : 'var(--dim)',
        fontSize: '1.05rem',
        letterSpacing: '0.03em',
        transition: 'color 0.2s, border-color 0.2s',
      }}
    >
      {children}
    </button>
  );
}

const settingRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '13px 14px', borderRadius: 14,
  background: 'var(--bg-2)', border: '1px solid var(--line)',
};

const stepperButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: 32, height: 32, borderRadius: 10,
  border: disabled ? '1px solid var(--line)' : '1px solid var(--line-strong)',
  background: disabled ? 'transparent' : 'rgba(214,245,69,0.1)',
  color: disabled ? 'var(--dim)' : 'var(--lime)',
  fontSize: '1.1rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
});
