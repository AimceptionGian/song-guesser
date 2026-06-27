import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api-client';

export default function LobbyScreen() {
  const navigate = useNavigate();
  const [gameCode, setGameCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [lobbyInfo, setLobbyInfo] = useState<{
    totalRounds: number;
    maxPoints: number;
    yearRange: number;
    playerCount: number;
  } | null>(null);

  // For "join" mode: poll lobby info when code is entered
  useEffect(() => {
    if (mode !== 'join' || gameCode.length < 4) return;
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
  }, [mode, gameCode]);

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
          maxPoints: 1000,
          timelineOnlyScoring: false,
          yearRange: { min: 1960, max: 2024 },
        },
      });
      navigate(`/game/${result.code}`);
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
      navigate(`/game/${gameCode.toUpperCase()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game nicht gefunden');
    } finally {
      setLoading(false);
    }
  };

  const displayInfo = mode === 'join' && lobbyInfo
    ? lobbyInfo
    : { totalRounds: 5, maxPoints: 1000, yearRange: 64, playerCount: 0 };

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

      {/* ─── Players Section ─── */}
      <div className="fade-up" style={{ width: '100%', maxWidth: 400, animationDelay: '0.1s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ color: '#8b7fb8', fontSize: '0.85rem' }}>👥 {displayInfo.playerCount || 0} Spieler bereit</span>
        </div>
        <div style={{
          padding: '16px 12px', borderRadius: 16,
          background: '#13121f', border: '1px solid rgba(168,85,247,0.2)',
          color: '#8b7fb8', fontSize: '0.9rem', textAlign: 'center',
        }}>
          {displayInfo.playerCount > 0
            ? `${displayInfo.playerCount} Spieler im Lobby`
            : mode === 'join'
              ? 'Code eingeben, um Lobby-Info zu sehen'
              : 'Wird beim Starten geladen…'}
        </div>
      </div>

      {/* ─── Info Grid ─── */}
      <div className="fade-up" style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        width: '100%', maxWidth: 400, animationDelay: '0.18s',
      }}>
        <InfoBox icon="🃏" value={String(displayInfo.totalRounds)} label="Karten" />
        <InfoBox icon="⭐" value={String(displayInfo.maxPoints)} label="Max. Punkte" />
        <InfoBox icon="📅" value={`${displayInfo.yearRange} J.`} label="Zeitraum" />
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
