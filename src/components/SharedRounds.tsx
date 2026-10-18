import { useEffect, useState } from 'react';
import AudioPlayer from './AudioPlayer';
import SnippetPlayer, { formatSnippetSec } from './SnippetPlayer';
import type { Song, Player, BuzzerState, SnippetState, RoundReveal, PlaybackState, BuzzAttempt } from '../types';

// Ansichten der beiden Modi, in denen alle gleichzeitig raten (Buzzer und
// Snippet). Die Zustandsmaschine dahinter lebt im MatchRoom-DO — hier wird
// nur dargestellt und weitergereicht.

// ─── Buzzer ───────────────────────────────────────────────────

interface BuzzerRoundProps {
  card: Song;
  buzzer: BuzzerState;
  players: Player[];
  selfId: string | null;
  /** The player whose turn it is controls the shared playback. */
  isController: boolean;
  playback: PlaybackState | null;
  onTransport?: (playing: boolean, positionSec: number) => void;
  secondsLeft: number | null;
  onBuzz: () => void;
  onAnswer: (answer: { artist: string; title: string }) => Promise<void>;
}

export function BuzzerRound({
  card, buzzer, players, selfId, isController, playback, onTransport, secondsLeft, onBuzz, onAnswer,
}: BuzzerRoundProps) {
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);

  const iAnswer = !!selfId && buzzer.winnerId === selfId;
  const iMissed = !!selfId && buzzer.lockedOut.includes(selfId);
  const canBuzz = !!selfId && !buzzer.winnerId && !iMissed;

  // Fresh inputs for every buzz
  useEffect(() => {
    setArtist('');
    setTitle('');
    setSending(false);
  }, [buzzer.winnerId]);

  // Leertaste = Buzzer (am Desktop schneller als jeder Klick)
  useEffect(() => {
    if (!canBuzz) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code !== 'Space' || target?.closest('input, textarea, button')) return;
      e.preventDefault();
      onBuzz();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canBuzz, onBuzz]);

  const submit = async () => {
    if (sending || (!artist.trim() && !title.trim())) return;
    setSending(true);
    try {
      await onAnswer({ artist: artist.trim(), title: title.trim() });
    } finally {
      setSending(false);
    }
  };

  const stillIn = players.filter((p) => !buzzer.lockedOut.includes(p.id));

  return (
    <div className="slam-in panel" style={{
      padding: 20, display: 'grid', gap: 14,
      background: 'linear-gradient(150deg, rgba(255,79,163,0.10), var(--bg-2) 60%)',
      border: '1px solid rgba(255,79,163,0.35)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="display" style={{ color: 'var(--pink)', fontSize: '0.9rem' }}>🔔 Wer erkennt den Song?</span>
        {secondsLeft !== null && (
          <span className="display" style={{
            fontSize: '1.3rem', fontVariantNumeric: 'tabular-nums',
            color: secondsLeft <= 10 ? 'var(--red)' : 'var(--ink)',
          }}>
            {buzzer.winnerId ? `⏸ ${secondsLeft}s` : `${secondsLeft}s`}
          </span>
        )}
      </div>

      <AudioPlayer
        previewUrl={card.previewUrl}
        isController={isController}
        remotePlayback={isController ? null : playback}
        onTransport={onTransport}
        hold={!!buzzer.winnerId}
      />
      {isController && !buzzer.winnerId && (
        <div style={{ color: 'var(--dim)', fontSize: '0.72rem', textAlign: 'center', marginTop: -6 }}>
          Du legst auf — starte die Musik für alle. Buzzern darfst du trotzdem.
        </div>
      )}

      {iAnswer ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="display" style={{ color: 'var(--lime)', fontSize: '0.9rem', textAlign: 'center' }}>
            Du warst am schnellsten! Interpret UND Titel:
          </div>
          <div className="grid-2">
            <input
              className="text-input"
              autoFocus
              placeholder="Interpret / Band"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
            <input
              className="text-input"
              placeholder="Songtitel"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            />
          </div>
          <button
            onClick={() => void submit()}
            disabled={sending || (!artist.trim() && !title.trim())}
            className="btn-primary"
          >
            {sending ? <><span className="spinner" /> Wird geprüft…</> : 'Antwort abgeben ✓'}
          </button>
        </div>
      ) : buzzer.winnerId ? (
        <div style={{ textAlign: 'center', color: 'var(--gold)', fontWeight: 600, fontSize: '0.95rem' }}>
          🔔 {buzzer.winnerName} hat gebuzzert und rät…
        </div>
      ) : canBuzz ? (
        <button onClick={onBuzz} className="buzzer-button" style={{ justifySelf: 'center' }}>
          BUZZ!
        </button>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
          {iMissed ? '✗ Du hattest deinen Versuch — jetzt sind die anderen dran.' : 'Die anderen können buzzern…'}
        </div>
      )}

      {canBuzz && (
        <div style={{ textAlign: 'center', color: 'var(--dim)', fontSize: '0.7rem', marginTop: -6 }}>
          Nur Interpret und Titel zusammen geben den Punkt · Leertaste buzzert auch
        </div>
      )}

      {buzzer.attempts.length > 0 && <AttemptList attempts={buzzer.attempts} />}

      {players.length > 1 && (
        <div style={{ color: 'var(--dim)', fontSize: '0.7rem', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
          noch im Rennen: {stillIn.map((p) => p.name).join(', ') || '—'}
        </div>
      )}
    </div>
  );
}

function AttemptList({ attempts }: { attempts: BuzzAttempt[] }) {
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {attempts.map((a, i) => {
        const hit = a.artistCorrect && a.titleCorrect;
        const half = !hit && (a.artistCorrect || a.titleCorrect);
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 11px', borderRadius: 10, fontSize: '0.8rem',
            background: hit ? 'rgba(30,215,96,0.08)' : 'rgba(255,84,112,0.06)',
            border: hit ? '1px solid rgba(30,215,96,0.25)' : '1px solid rgba(255,84,112,0.18)',
          }}>
            <span>{hit ? '✅' : '❌'}</span>
            <strong style={{ color: 'var(--ink)' }}>{a.playerName}</strong>
            <span style={{ color: 'var(--muted)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {a.artist || a.title ? `„${[a.artist, a.title].filter(Boolean).join(' – ')}"` : 'keine Antwort'}
            </span>
            {half && (
              <span style={{ marginLeft: 'auto', color: 'var(--gold)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                {a.artistCorrect ? 'Interpret ✓' : 'Titel ✓'}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Snippet ──────────────────────────────────────────────────

interface SnippetRoundProps {
  card: Song;
  snippet: SnippetState;
  players: Player[];
  selfId: string | null;
  secondsLeft: number | null;
  onGuess: (guess: { artist: string; title: string; pass?: boolean }) => Promise<void>;
}

export function SnippetRound({ card, snippet, players, selfId, secondsLeft, onGuess }: SnippetRoundProps) {
  const feedback = selfId ? snippet.feedback[selfId] : undefined;
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [sending, setSending] = useState(false);

  const solved = selfId ? snippet.solved[selfId] : undefined;
  const guessed = !!selfId && snippet.guessed.includes(selfId);
  const durationSec = snippet.stages[snippet.stage];

  // What a player already got right stays right — show it, don't ask again
  useEffect(() => {
    if (feedback?.artistCorrect) setArtist(feedback.artist);
    if (feedback?.titleCorrect) setTitle(feedback.title);
  }, [feedback?.artistCorrect, feedback?.titleCorrect, feedback?.artist, feedback?.title]);

  const send = async (pass = false) => {
    if (sending) return;
    setSending(true);
    try {
      await onGuess({
        artist: feedback?.artistCorrect ? '' : artist.trim(),
        title: feedback?.titleCorrect ? '' : title.trim(),
        pass,
      });
    } finally {
      setSending(false);
    }
  };

  const nothingTyped = !(feedback?.artistCorrect ? '' : artist.trim()) && !(feedback?.titleCorrect ? '' : title.trim());
  const open = players.filter((p) => !snippet.solved[p.id]);
  const waitingFor = open.filter((p) => !snippet.guessed.includes(p.id));

  return (
    <div className="slam-in panel" style={{
      padding: 20, display: 'grid', gap: 14,
      background: 'linear-gradient(150deg, rgba(60,220,255,0.08), var(--bg-2) 60%)',
      border: '1px solid rgba(60,220,255,0.3)',
    }}>
      {/* Stufen-Leiste */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {snippet.stages.map((sec, i) => (
          <span key={i} className="chip" style={{
            pointerEvents: 'none',
            background: i === snippet.stage ? 'var(--cyan)' : i < snippet.stage ? 'rgba(60,220,255,0.12)' : 'transparent',
            color: i === snippet.stage ? '#0b0a12' : i < snippet.stage ? 'var(--cyan)' : 'var(--dim)',
            borderColor: i <= snippet.stage ? 'var(--cyan)' : 'var(--line)',
          }}>
            {formatSnippetSec(sec)}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span className="display" style={{ color: 'var(--cyan)', fontSize: '0.9rem' }}>
          Stufe {snippet.stage + 1}/{snippet.stages.length} · {pointsLabel(snippet.stage)}
        </span>
        {secondsLeft !== null && (
          <span className="display" style={{
            fontSize: '1.2rem', fontVariantNumeric: 'tabular-nums',
            color: secondsLeft <= 10 ? 'var(--red)' : 'var(--ink)',
          }}>{secondsLeft}s</span>
        )}
      </div>

      <SnippetPlayer previewUrl={card.previewUrl} durationSec={durationSec} />

      {solved ? (
        <div style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 700 }}>
          ✓ Erkannt bei {formatSnippetSec(snippet.stages[solved.stage])} — +{solved.points} Punkte!
          {waitingFor.length > 0 && (
            <div style={{ color: 'var(--muted)', fontWeight: 500, fontSize: '0.8rem', marginTop: 4 }}>
              Warte auf {waitingFor.map((p) => p.name).join(', ')}…
            </div>
          )}
        </div>
      ) : guessed ? (
        <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
          {feedback ? <FeedbackLine feedback={feedback} /> : 'Gepasst.'}
          <div style={{ marginTop: 6 }}>
            ⏳ Warte auf {waitingFor.map((p) => p.name).join(', ') || 'die anderen'} — dann kommt ein längerer Ausschnitt.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {feedback && <div style={{ textAlign: 'center', fontSize: '0.8rem' }}><FeedbackLine feedback={feedback} /></div>}
          <div className="grid-2">
            <input
              className="text-input"
              placeholder="Interpret / Band"
              value={artist}
              readOnly={!!feedback?.artistCorrect}
              onChange={(e) => setArtist(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !nothingTyped) void send(); }}
              style={feedback?.artistCorrect ? { borderColor: 'var(--green)', color: 'var(--green)' } : undefined}
            />
            <input
              className="text-input"
              placeholder="Songtitel"
              value={title}
              readOnly={!!feedback?.titleCorrect}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !nothingTyped) void send(); }}
              style={feedback?.titleCorrect ? { borderColor: 'var(--green)', color: 'var(--green)' } : undefined}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <button onClick={() => void send()} disabled={sending || nothingTyped} className="btn-primary">
              {sending ? <><span className="spinner" /> …</> : 'Tipp abgeben ✓'}
            </button>
            <button onClick={() => void send(true)} disabled={sending} className="btn-ghost" style={{ padding: '10px 16px' }}>
              Passen
            </button>
          </div>
        </div>
      )}

      {players.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
          {players.map((p) => {
            const s = snippet.solved[p.id];
            const done = snippet.guessed.includes(p.id);
            return (
              <span key={p.id} style={{
                fontSize: '0.72rem', padding: '4px 10px', borderRadius: 999,
                border: '1px solid var(--line)',
                color: s ? 'var(--green)' : done ? 'var(--ink)' : 'var(--dim)',
                background: s ? 'rgba(30,215,96,0.1)' : 'transparent',
              }}>
                {p.name}{p.id === selfId ? ' (du)' : ''} {s ? `✓ ${formatSnippetSec(snippet.stages[s.stage])}` : done ? '✎' : '…'}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function pointsLabel(stage: number): string {
  const points = [5, 4, 3, 2, 1][stage] ?? 1;
  return `${points} ${points === 1 ? 'Punkt' : 'Punkte'}`;
}

function FeedbackLine({ feedback }: { feedback: SnippetState['feedback'][string] }) {
  const mark = (ok: boolean) => (ok ? '✓' : '✗');
  return (
    <span>
      Dein letzter Tipp: Interpret <strong style={{ color: feedback.artistCorrect ? 'var(--green)' : 'var(--red)' }}>{mark(feedback.artistCorrect)}</strong>
      {' · '}
      Titel <strong style={{ color: feedback.titleCorrect ? 'var(--green)' : 'var(--red)' }}>{mark(feedback.titleCorrect)}</strong>
    </span>
  );
}

// ─── Auflösung (beide Modi) ───────────────────────────────────

/** Mode-specific part of the reveal; the song card and "Weiter" live in GameScreen. */
export function SharedRevealDetails({ result, selfId }: { result: RoundReveal; selfId: string | null }) {
  if (result.mode === 'buzzer' && result.buzz) {
    const { winnerName, winnerId, attempts } = result.buzz;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ textAlign: 'center', color: winnerId ? 'var(--gold)' : 'var(--muted)', fontWeight: 600 }}>
          {winnerId
            ? (winnerId === selfId ? '🔔 Du hast den Punkt geholt!' : `🔔 ${winnerName} holt den Punkt!`)
            : 'Niemand hat ihn erkannt.'}
        </div>
        {attempts.length > 0 && <AttemptList attempts={attempts} />}
      </div>
    );
  }

  if (result.mode === 'snippet' && result.snippetResults) {
    const ranked = [...result.snippetResults].sort((a, b) =>
      b.points - a.points || a.playerName.localeCompare(b.playerName)
    );
    return (
      <div style={{ display: 'grid', gap: 6 }}>
        {ranked.map((r) => (
          <div key={r.playerId} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10,
            background: r.points > 0 ? 'rgba(30,215,96,0.08)' : 'rgba(244,241,255,0.03)',
            border: r.points > 0 ? '1px solid rgba(30,215,96,0.25)' : '1px solid var(--line)',
          }}>
            <strong style={{ color: 'var(--ink)', fontSize: '0.85rem' }}>
              {r.playerName}{r.playerId === selfId ? ' (du)' : ''}
            </strong>
            <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
              {r.solvedAtSec !== null ? `erkannt bei ${formatSnippetSec(r.solvedAtSec)}` : 'nicht erkannt'}
            </span>
            <span className="display" style={{
              marginLeft: 'auto', fontSize: '0.95rem',
              color: r.points > 0 ? 'var(--lime)' : 'var(--dim)',
            }}>
              +{r.points}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

/** Points the viewing player earned in a shared-mode reveal (for the reveal sound). */
export function ownSharedPoints(result: RoundReveal, selfId: string | null): number {
  if (result.mode === 'buzzer') return result.buzz?.winnerId && result.buzz.winnerId === selfId ? 1 : 0;
  if (result.mode === 'snippet') return result.snippetResults?.find((r) => r.playerId === selfId)?.points ?? 0;
  return result.points;
}
