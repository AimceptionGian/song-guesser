import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api-client';

type LobbyPhase = 'form' | 'lobby';

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
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Poll lobby players
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
        });
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
      const result = await api.createLobby({
        hostName: playerName || 'Host',
        hostAvatar: '🎵',
        settings: {
          maxPlayers: 4,
          totalRounds: 5,
          maxPoints: 4,
          timelineOnlyScoring: false,
          yearRange: { min: 1960, max: 2024 },
        },
      });
      setLobbyCode(result.code);
      setLobbyToken(result.token);
      setPlayerId('host');
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
    setPhase('form');
    setLobbyCode('');
    setLobbyPlayers([]);
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
              lobbyPlayers.map((p) => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 12px', borderRadius: 10,
                  background: p.id === playerId ? 'rgba(168,85,247,0.12)' : 'transparent',
                }}>
                  <span style={{ fontSize: 20 }}>{p.avatar}</span>
                  <span style={{ color: '#f0eeff', fontWeight: 600 }}>{p.name}</span>
                  {p.id === playerId && (
                    <span style={{
                      fontSize: '0.7rem', padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(168,85,247,0.2)', color: '#a855f7',
                      marginLeft: 'auto',
                    }}>DU</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Info Grid */}
        <div className="fade-up" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
          width: '100%', maxWidth: 400, animationDelay: '0.18s',
        }}>
          <InfoBox icon="🃏" value={String(displayInfo.totalRounds)} label="Karten pro Spieler" />
          <InfoBox icon="⭐" value={`${displayInfo.maxPoints}`} label="Max. Punkte" />
          <InfoBox icon="📅" value={`${displayInfo.yearRange} J.`} label="Zeitraum" />
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

function InfoBox({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '16px 8px', borderRadius: 12,
      background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.15)',
    }}>
      <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', color: '#a855f7', lineHeight: 1 }}>{value}</div>
      <div style={{ color: '#8b7fb8', fontSize: '0.7rem', marginTop: 2 }}>{label}</div>
    </div>
  );
}

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

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12,
  outline: 'none', background: '#1e1c2e',
  border: '1px solid rgba(168,85,247,0.25)',
  color: '#f0eeff', fontSize: '1rem',
};
