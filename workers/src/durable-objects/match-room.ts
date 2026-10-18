import { DurableObject } from 'cloudflare:workers';
import type {
  MatchState, MatchPlayer, MatchSettings, Card, CommandEnvelope, ResponseEnvelope, CommandType,
  LiveInput, PlaybackState, GameMode, BuzzAttempt, SnippetPlayerResult,
} from '../types';
import { MOCK_TRACKS, shuffleArray } from '../db/mock-data';
import { calculateFullScore, isCloseMatch, isArtistMatch } from '../services/scoring-service';
import { resolvePlayableCard, PreviewUnavailableError } from '../services/preview-service';
import { buildRefillCards, cardKey } from '../services/deck-service';
import type { GuessSubmission } from '../types';
import type { Env } from '../env';

// Timeouts are enforced lazily: every request (commands and the 1.5s state
// polls) first runs checkTimeouts(), so an expired deadline is applied within
// one poll interval — no DO alarms needed.
const TIMEOUT_GRACE_MS = 1000;   // latency headroom before a deadline fires
const VOTE_WINDOW_MS = 45_000;   // how long the reveal vote stays open
const FALLBACK_GUESS_YEAR = 1992; // matches the frontend's initial slider position
// How many unplayable cards a single draw may skip looking for a playable
// preview. Each attempt is one lookup, so this also bounds the draw's latency.
const MAX_DRAW_ATTEMPTS = 6;
// Cards added when the deck runs dry mid-match (see refillDeck).
const REFILL_SIZE = 20;

// Buzzer mode
const BUZZ_ROUND_MS = 45_000;      // how long a song stays open for buzzing (preview is 30s)
const BUZZ_ANSWER_MS = 20_000;     // how long the buzz winner may answer
const BUZZ_REOPEN_MIN_MS = 8_000;  // after a miss, the others get at least this long

// Snippet mode: snippet length per stage and the points for naming the
// song at that stage. The shorter the snippet, the more it's worth.
export const SNIPPET_STAGES_SEC = [0.1, 0.5, 2, 8, 15];
export const SNIPPET_POINTS = [5, 4, 3, 2, 1];
const SNIPPET_STAGE_MS = 45_000;   // a stage closes after this even if someone hasn't guessed

const GAME_MODES: GameMode[] = ['timeline', 'buzzer', 'snippet'];

const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  gameMode: 'timeline',
  guessMode: 'type',
  answerTimeSec: 0,
};

const reject = (version: number, errorCode: string): ResponseEnvelope =>
  ({ accepted: false, newVersion: version, stateDelta: {}, errorCode });

// WebSocket client metadata
interface WSClient {
  playerId: string;
  ws: WebSocket;
}

/**
 * MatchRoom — authoritative game state machine per lobby.
 * One Durable Object instance per active match.
 * Handles WebSocket connections, turn commands, and state persistence.
 */
export class MatchRoom extends DurableObject {
  private state: MatchState | null = null;
  private clients: Map<string, WSClient> = new Map();
  private version = 0;
  private seededDeck: Card[] | null = null;
  private storage: DurableObjectState['storage'];
  // Transient: what the active player is currently typing (not persisted)
  private liveInput: LiveInput | null = null;
  // Transient: the active player's audio playback state (not persisted)
  private playback: PlaybackState | null = null;
  // A draw awaits preview lookups, and a DO keeps serving requests while an
  // outgoing fetch is pending — a double click would otherwise pop two cards.
  private drawing: Promise<ResponseEnvelope> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;

    // Restore persisted state on wake-up
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<MatchState>('match-state');
      if (saved) {
        this.state = saved;
        this.version = saved.version;
      }
      // The deck is seeded before start_match arrives; persisting it means an
      // eviction in between can't silently drop the match back to MOCK_TRACKS.
      const deck = await ctx.storage.get<Card[]>('seeded-deck');
      if (deck?.length) this.seededDeck = deck;
    });
  }

  // ─── WebSocket handling ───

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || 'unknown';

    // Apply any expired deadlines before handling the request — this is what
    // makes the answer timer/buzzer windows tick without DO alarms.
    this.checkTimeouts();

    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      await this.handleWebSocket(playerId, server);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP init-deck endpoint (seeds the deck before start_match)
    if (request.url.endsWith('/init-deck') && request.method === 'POST') {
      const { deck } = (await request.json()) as { deck: Card[] };
      if (deck && deck.length > 0) {
        this.seededDeck = deck;
        await this.storage.put('seeded-deck', deck);
      }
      return Response.json({ accepted: true, count: deck?.length ?? 0 });
    }

    // Lets the start route skip a redundant deck build when one is already
    // seeded (the lobby start and the first draw both used to build one).
    if (request.url.endsWith('/deck-info') && request.method === 'GET') {
      return Response.json({
        seeded: this.seededDeck?.length ?? 0,
        matchStarted: !!this.state,
        remaining: this.state?.deck.length ?? 0,
      });
    }

    // HTTP command endpoint (REST fallback for unreliable WS)
    if (request.url.endsWith('/command') && request.method === 'POST') {
      const raw = (await request.json()) as Record<string, unknown>;
      const msg: CommandEnvelope = {
        commandType: (raw.commandType || raw.type) as CommandType,
        actorId: (raw.actorId || 'local-player') as string,
        lobbyId: (raw.lobbyId || this.state?.lobbyId || '') as string,
        expectedVersion: (raw.expectedVersion ?? 0) as number,
        payload: (raw.payload || {}) as Record<string, unknown>,
        clientTimestamp: (raw.clientTimestamp ?? Date.now()) as number,
      };
      const response = await this.handleCommand(msg);
      // Also broadcast to any connected WS clients
      this.broadcastState();
      // Return both the response envelope AND the full current state
      return Response.json({
        ...response,
        state: this.state ? this.stateWithTransients() : this.state,
      });
    }

    // Active player pushes what they're typing; spectators poll it via /state
    if (request.url.endsWith('/live-input') && request.method === 'POST') {
      const input = (await request.json()) as LiveInput;
      if (!this.isCurrentPlayer(input.playerId)) {
        return Response.json({ accepted: false, errorCode: 'NOT_YOUR_TURN' }, { status: 403 });
      }
      this.liveInput = input;
      return Response.json({ accepted: true });
    }

    // Active player controls audio playback; spectators follow via /state
    if (request.url.endsWith('/playback') && request.method === 'POST') {
      const body = (await request.json()) as { playerId: string; playing: boolean; positionSec: number };
      if (!this.isCurrentPlayer(body.playerId)) {
        return Response.json({ accepted: false, errorCode: 'NOT_YOUR_TURN' }, { status: 403 });
      }
      this.playback = {
        playing: !!body.playing,
        positionSec: Number(body.positionSec) || 0,
        updatedAt: Date.now(),
      };
      return Response.json({ accepted: true });
    }

    // HTTP state query
    if (request.url.endsWith('/state') && request.method === 'GET') {
      if (this.state) {
        return Response.json(this.stateWithTransients());
      }
      return Response.json({ error: 'No active match' }, { status: 404 });
    }

    // HTTP fallback for state queries (legacy)
    if (this.state) {
      return Response.json(this.stateWithTransients());
    }
    return Response.json({ error: 'No active match' }, { status: 404 });
  }

  private stateWithTransients() {
    // serverNow lets clients render countdowns without trusting their own clock
    return { ...this.state, liveInput: this.liveInput, playback: this.playback, serverNow: Date.now() };
  }

  /**
   * Turn check: only the player whose turn it is may draw, guess, or
   * broadcast live input. Solo/legacy clients that don't send a player id
   * ('local-player') are exempt so the single-device flow keeps working.
   */
  private isCurrentPlayer(playerId: unknown): boolean {
    if (!this.state) return false;
    if (!playerId || playerId === 'local-player') return true;
    return this.state.turnOrder[this.state.currentPlayerIndex] === playerId;
  }

  private async handleWebSocket(playerId: string, ws: WebSocket): Promise<void> {
    ws.accept();

    this.clients.set(playerId, { playerId, ws });

    ws.addEventListener('message', async (event) => {
      try {
        const raw = JSON.parse(event.data as string);
        // Accept both CommandEnvelope format and simple { type, payload } format
        const msg: CommandEnvelope = raw.commandType
          ? raw
          : {
              commandType: raw.type || raw.commandType,
              actorId: raw.actorId || 'unknown',
              lobbyId: raw.lobbyId || raw.payload?.lobbyId || 'unknown',
              expectedVersion: raw.expectedVersion ?? 0,
              payload: raw.payload || {},
              clientTimestamp: raw.clientTimestamp ?? Date.now(),
            };
        const response = await this.handleCommand(msg);
        ws.send(JSON.stringify(response));
        this.broadcastState();
      } catch (err) {
        ws.send(JSON.stringify({
          accepted: false,
          newVersion: this.version,
          stateDelta: {},
          errorCode: 'INVALID_COMMAND',
        }));
      }
    });

    ws.addEventListener('close', () => {
      this.clients.delete(playerId);
    });

    // Send current state on connect
    if (this.state) {
      ws.send(JSON.stringify({
        type: 'state_sync',
        payload: this.state,
      }));
    }
  }

  // ─── Match lifecycle commands ───

  async handleCommand(command: CommandEnvelope): Promise<ResponseEnvelope> {
    // Version gating disabled for single-player prototype
    // All commands accepted and processed in order

    // WS messages bypass fetch(), so expired deadlines are applied here too
    this.checkTimeouts();

    switch (command.commandType) {
      case 'start_match':
        return this.startMatch(command);
      case 'draw_card':
        return this.drawCard(command);
      case 'submit_guess':
        return this.submitGuess(command);
      case 'resolve_turn':
        return this.resolveTurn(command);
      case 'buzz':
        return this.buzz(command);
      case 'buzzer_answer':
        return this.buzzerAnswer(command);
      case 'snippet_guess':
        return this.snippetGuess(command);
      case 'vote_reveal':
        return this.voteReveal(command);
      case 'end_match':
        return this.endMatch(command);
      default:
        return {
          accepted: false,
          newVersion: this.version,
          stateDelta: {},
          errorCode: 'UNKNOWN_COMMAND',
        };
    }
  }

  private startMatch(command: CommandEnvelope): ResponseEnvelope {
    // Idempotent: if match is already running, return current state
    if (this.state) {
      return {
        accepted: true,
        newVersion: this.version,
        stateDelta: { phase: this.state.phase },
      };
    }

    const players = command.payload.players as Array<{ id: string; name: string; avatar: string }>;
    const totalRounds = command.payload.totalRounds as number || 5;
    const rawSettings = (command.payload.settings ?? {}) as Partial<MatchSettings>;
    const settings: MatchSettings = {
      gameMode: GAME_MODES.includes(rawSettings.gameMode as GameMode)
        ? (rawSettings.gameMode as GameMode)
        : DEFAULT_MATCH_SETTINGS.gameMode,
      guessMode: rawSettings.guessMode === 'speak' ? 'speak' : 'type',
      answerTimeSec: Number(rawSettings.answerTimeSec) || 0,
    };

    if (!players || players.length === 0) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_PLAYERS' };
    }

    const matchPlayers: MatchPlayer[] = players.map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: 0,
      hand: [],
      placedCards: [],
    }));

    // A seeded deck is already randomised AND ordered so the same artist
    // doesn't come up twice in a row (see deck-service) — reshuffling it here
    // would throw that spacing away. Only the static mock fallback needs it.
    const deck = this.seededDeck?.length ? [...this.seededDeck] : shuffleArray(MOCK_TRACKS);

    this.state = {
      lobbyId: command.lobbyId,
      version: ++this.version,
      phase: 'drawing',
      players: matchPlayers,
      currentPlayerIndex: 0,
      currentRound: 1,
      totalRounds,
      currentCard: null,
      deck,
      turnOrder: players.map((p) => p.id),
      startedAt: Date.now(),
      settings,
      turnDeadline: null,
      buzzer: null,
      snippet: null,
      voting: null,
      drawnKeys: [],
    };
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: 'drawing' },
    };
  }

  private gameMode(): GameMode {
    return this.state?.settings?.gameMode ?? 'timeline';
  }

  private drawCard(command: CommandEnvelope): Promise<ResponseEnvelope> {
    if (this.drawing) return this.drawing;
    this.drawing = this.doDrawCard(command).finally(() => { this.drawing = null; });
    return this.drawing;
  }

  private async doDrawCard(command: CommandEnvelope): Promise<ResponseEnvelope> {
    if (!this.state) return reject(this.version, 'NO_MATCH');

    if (!this.isCurrentPlayer(command.payload.playerId)) return reject(this.version, 'NOT_YOUR_TURN');

    // The pending reveal must be resolved before the next card
    if (this.state.phase === 'round_result') return reject(this.version, 'RESOLVE_FIRST');

    // Idempotent while a card is already active: a second draw (double-click,
    // re-render) must not burn another card from the deck.
    if (this.state.phase !== 'drawing' && this.state.currentCard) {
      return {
        accepted: true,
        newVersion: this.version,
        stateDelta: { phase: this.state.phase, currentCard: this.state.currentCard },
      };
    }
    if (this.state.phase !== 'drawing') return reject(this.version, 'NOT_DRAWING');

    // Preview URLs expire (Deezer signs them for 15 minutes), so they are
    // resolved now rather than at deck-build time. A card without audio is
    // discarded and the next one is drawn — the players never see a dead
    // card, only the draw taking a moment longer.
    //
    // Two failure modes are kept strictly apart, because conflating them is
    // what used to end matches early or stop them from starting:
    // - "this song has no preview" → skip the card, try the next one
    // - "the lookup service is unavailable" (rate limit, outage) → the card
    //   is fine; put it back and let the player retry. Never end the match.
    let card: Card | null = null;
    let lookupUnavailable = false;
    for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt++) {
      if (this.state.deck.length === 0) this.refillDeck();
      const candidate = this.state.deck.pop();
      if (!candidate) break;

      try {
        card = await resolvePlayableCard(candidate);
      } catch (err) {
        if (!(err instanceof PreviewUnavailableError)) console.error('[MatchRoom] preview lookup failed:', err);
        this.state.deck.push(candidate);
        lookupUnavailable = true;
        break;
      }
      this.markDrawn(candidate);
      if (card) break;

      console.warn(`[MatchRoom] no playable preview for "${candidate.artist} – ${candidate.title}", skipping`);
    }

    if (!card) {
      if (lookupUnavailable || this.state.deck.length > 0) {
        // Recoverable: the phase stays 'drawing' and the player can draw again.
        this.state.version = ++this.version;
        this.persistState();
        return reject(this.version, lookupUnavailable ? 'PREVIEW_UNAVAILABLE' : 'NO_PLAYABLE_CARD');
      }
      // Deck and refill pool both exhausted — only reachable after hundreds
      // of songs. Ending the match beats freezing on a draw that can't work.
      console.warn('[MatchRoom] deck exhausted — finishing match early');
      this.state.phase = 'finished';
      this.state.currentCard = null;
      this.state.version = ++this.version;
      this.persistState();
      return { accepted: false, newVersion: this.version, stateDelta: { phase: 'finished' }, errorCode: 'DECK_EMPTY' };
    }

    this.startRound(card);

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: this.state.phase, currentCard: card },
    };
  }

  /** Remember a dealt card so a refill can't bring it back. */
  private markDrawn(card: Card): void {
    if (!this.state) return;
    this.state.drawnKeys = [...(this.state.drawnKeys ?? []), cardKey(card)];
  }

  /**
   * The deck ran dry before the match is over — a small history pool, or a
   * run of songs without previews. Top it up with curated classics that
   * haven't come up yet instead of ending the match.
   */
  private refillDeck(): void {
    if (!this.state) return;
    const exclude = new Set(this.state.drawnKeys ?? []);
    if (this.state.currentCard) exclude.add(cardKey(this.state.currentCard));
    const refill = buildRefillCards(REFILL_SIZE, exclude);
    if (refill.length) console.warn(`[MatchRoom] deck ran dry — refilled with ${refill.length} curated cards`);
    this.state.deck.push(...refill);
  }

  /** A playable card was drawn: open the round the game mode calls for. */
  private startRound(card: Card): void {
    if (!this.state) return;
    const now = Date.now();
    this.state.currentCard = card;
    this.state.lastResult = null;
    this.state.turnDeadline = null;
    this.state.buzzer = null;
    this.state.snippet = null;

    switch (this.gameMode()) {
      case 'buzzer':
        this.state.phase = 'buzzer';
        this.state.buzzer = {
          openUntil: now + BUZZ_ROUND_MS,
          remainingMs: BUZZ_ROUND_MS,
          winnerId: null,
          winnerName: null,
          answerDeadline: null,
          lockedOut: [],
          attempts: [],
        };
        break;
      case 'snippet':
        this.state.phase = 'snippet';
        this.state.snippet = {
          stage: 0,
          stages: SNIPPET_STAGES_SEC,
          deadline: now + SNIPPET_STAGE_MS,
          guessed: [],
          solved: {},
          feedback: {},
        };
        break;
      default: {
        this.state.phase = 'guessing';
        // Answer timer starts the moment the card is drawn
        const answerTimeSec = this.state.settings?.answerTimeSec ?? 0;
        this.state.turnDeadline = answerTimeSec > 0 ? now + answerTimeSec * 1000 : null;
      }
    }

    this.state.version = ++this.version;
    this.liveInput = null;
    this.playback = null;
    this.persistState();
  }

  private submitGuess(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state || !this.state.currentCard) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_ACTIVE_CARD' };
    }

    // Guard against double submits: while the reveal is showing the card is
    // still set, but scoring it again would double-count.
    if (this.state.phase !== 'guessing') {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'ALREADY_SUBMITTED' };
    }

    const submission = command.payload as unknown as GuessSubmission;

    if (!this.isCurrentPlayer(submission.playerId)) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOT_YOUR_TURN' };
    }

    const applied = this.applyGuess(submission, false);
    if (!applied) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'PLAYER_NOT_FOUND' };
    }

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: {
        phase: this.state.phase,
        players: this.state.players,
        lastResult: this.state.lastResult,
      },
    };
  }

  /**
   * Score a guess and move the match to the phase that follows it:
   * - type mode:  full auto-grading → round_result (or buzzer after a timeout
   *   when artist/title are still stealable)
   * - speak mode: only year/timeline are auto-graded; artist/title points are
   *   decided by the other players in reveal_vote
   * Returns false when the player is unknown. Used by both the explicit
   * submit command and the timeout auto-submit.
   */
  private applyGuess(submission: GuessSubmission, timedOut: boolean): boolean {
    if (!this.state || !this.state.currentCard) return false;
    const card = this.state.currentCard;

    const playerIdx = this.state.players.findIndex((p) => p.id === submission.playerId);
    if (playerIdx === -1) return false;

    const speakMode = (this.state.settings?.guessMode ?? 'type') === 'speak';

    // All placed cards stay visible on the timeline, so every one of them
    // anchors the bucket check — not just the correctly placed ones
    const existingYears = this.state.players[playerIdx].placedCards
      .map((pc) => pc.card.year);

    const result = calculateFullScore(
      submission,
      card.artist,
      card.title,
      card.year,
      existingYears
    );

    // Speak mode: artist/title are said aloud, so their auto-grading is
    // meaningless — only count year + timeline now, votes add the rest.
    const yearTimelinePoints =
      (result.breakdown?.yearPoints ?? 0) + (result.breakdown?.timelinePoints ?? 0);
    const points = speakMode ? yearTimelinePoints : result.points;

    this.state.players[playerIdx] = {
      ...this.state.players[playerIdx],
      score: this.state.players[playerIdx].score + points,
      hand: [...this.state.players[playerIdx].hand, card],
      placedCards: [
        ...this.state.players[playerIdx].placedCards,
        { card, placedYear: submission.guessedYear, isCorrect: result.timelineCorrect },
      ],
    };

    this.state.lastResult = {
      playerId: submission.playerId,
      playerName: this.state.players[playerIdx].name,
      card,
      guessedArtist: submission.guessedArtist,
      guessedTitle: submission.guessedTitle,
      guessedYear: submission.guessedYear,
      artistCorrect: speakMode ? false : result.artistCorrect,
      titleCorrect: speakMode ? false : result.titleCorrect,
      yearExact: result.yearExact,
      timelineCorrect: result.timelineCorrect,
      yearDiff: result.yearDiff,
      points,
      timedOut,
      mode: 'timeline',
    };

    const others = this.state.players.filter((p) => p.id !== submission.playerId);

    if (speakMode && others.length > 0) {
      // The other players decide whether artist/title were said correctly
      this.state.phase = 'reveal_vote';
      this.state.voting = {
        deadline: Date.now() + VOTE_WINDOW_MS,
        voterIds: others.map((p) => p.id),
        votes: {},
      };
    } else {
      // Pause on the reveal: everyone sees the result until the guesser
      // explicitly continues (resolve_turn). Turn/round do NOT advance here.
      this.state.phase = 'round_result';
    }

    this.state.turnDeadline = null;
    this.state.version = ++this.version;
    this.liveInput = null;
    this.playback = null;
    this.persistState();
    return true;
  }

  // ─── Timeouts (lazy — applied on every request) ───

  private checkTimeouts(): void {
    if (!this.state) return;
    const now = Date.now();

    // Active player ran out of answer time → auto-submit what they typed
    if (
      this.state.phase === 'guessing' &&
      this.state.turnDeadline &&
      now > this.state.turnDeadline + TIMEOUT_GRACE_MS
    ) {
      const activeId = this.state.turnOrder[this.state.currentPlayerIndex];
      const live = this.liveInput && this.liveInput.playerId === activeId ? this.liveInput : null;
      this.applyGuess({
        playerId: activeId,
        cardId: this.state.currentCard?.id ?? '',
        guessedArtist: live?.artist ?? '',
        guessedTitle: live?.title ?? '',
        guessedYear: live?.year ?? FALLBACK_GUESS_YEAR,
      }, true);
      return;
    }

    if (this.state.phase === 'buzzer' && this.state.buzzer) {
      const b = this.state.buzzer;
      // Nobody named the song in time → reveal
      if (!b.winnerId && b.openUntil && now > b.openUntil + TIMEOUT_GRACE_MS) {
        this.finishBuzzerRound(null);
        return;
      }
      // Buzz winner never answered → counts as a miss, the others may buzz
      if (b.winnerId && b.answerDeadline && now > b.answerDeadline + TIMEOUT_GRACE_MS) {
        this.resolveBuzzAttempt(b.winnerId, '', '');
        return;
      }
    }

    // Snippet stage closed → whoever hasn't guessed just doesn't score here
    if (
      this.state.phase === 'snippet' &&
      this.state.snippet &&
      now > this.state.snippet.deadline + TIMEOUT_GRACE_MS
    ) {
      this.advanceSnippetStage();
      this.state.version = ++this.version;
      this.persistState();
      return;
    }

    // Vote window closed → tally whatever votes came in
    if (
      this.state.phase === 'reveal_vote' &&
      this.state.voting &&
      now > this.state.voting.deadline + TIMEOUT_GRACE_MS
    ) {
      this.tallyVotes();
    }
  }

  // ─── Buzzer ───

  // Buzzer mode: the song plays for everyone, anyone may buzz. The first
  // buzz freezes the clock and gives that player the answer; artist AND
  // title must both be right for the point. A miss locks that player out
  // for this song and hands the buzzer back to the others.

  private buzz(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state || this.state.phase !== 'buzzer' || !this.state.buzzer) {
      return reject(this.version, 'NO_BUZZER_PHASE');
    }
    const playerId = command.payload.playerId as string | undefined;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!playerId || !player) return reject(this.version, 'PLAYER_NOT_FOUND');

    const b = this.state.buzzer;
    if (b.winnerId) return reject(this.version, 'TOO_LATE');
    if (b.lockedOut.includes(playerId)) return reject(this.version, 'ALREADY_MISSED');

    const now = Date.now();
    this.state.buzzer = {
      ...b,
      winnerId: playerId,
      winnerName: player.name,
      // Freeze the clock while they answer; it resumes after a miss
      remainingMs: Math.max(0, (b.openUntil ?? now) - now),
      openUntil: null,
      answerDeadline: now + BUZZ_ANSWER_MS,
    };
    this.state.version = ++this.version;
    this.persistState();

    return { accepted: true, newVersion: this.version, stateDelta: { buzzer: this.state.buzzer } };
  }

  private buzzerAnswer(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state || this.state.phase !== 'buzzer' || !this.state.buzzer?.winnerId) {
      return reject(this.version, 'NO_BUZZER_PHASE');
    }
    const playerId = command.payload.playerId as string | undefined;
    if (!playerId || playerId !== this.state.buzzer.winnerId) {
      return reject(this.version, 'NOT_BUZZER_WINNER');
    }

    this.resolveBuzzAttempt(
      playerId,
      String(command.payload.artist ?? '').trim(),
      String(command.payload.title ?? '').trim(),
    );

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: {
        phase: this.state.phase,
        players: this.state.players,
        buzzer: this.state.buzzer,
        lastResult: this.state.lastResult,
      },
    };
  }

  /** Grade the buzz winner's answer: a hit ends the song, a miss reopens the buzzer. */
  private resolveBuzzAttempt(playerId: string, artist: string, title: string): void {
    if (!this.state?.buzzer || !this.state.currentCard) return;
    const card = this.state.currentCard;
    const b = this.state.buzzer;

    const attempt: BuzzAttempt = {
      playerId,
      playerName: b.winnerName ?? '',
      artist,
      title,
      artistCorrect: !!artist && isArtistMatch(artist, card.artist),
      titleCorrect: !!title && isCloseMatch(title, card.title),
    };
    const attempts = [...b.attempts, attempt];

    if (attempt.artistCorrect && attempt.titleCorrect) {
      const idx = this.state.players.findIndex((p) => p.id === playerId);
      if (idx !== -1) {
        const p = this.state.players[idx];
        this.state.players[idx] = { ...p, score: p.score + 1, hand: [...p.hand, card] };
      }
      this.state.buzzer = { ...b, attempts };
      this.finishBuzzerRound(playerId);
      return;
    }

    const lockedOut = [...b.lockedOut, playerId];
    if (this.state.players.every((p) => lockedOut.includes(p.id))) {
      // Everyone has had their go
      this.state.buzzer = { ...b, attempts, lockedOut };
      this.finishBuzzerRound(null);
      return;
    }

    this.state.buzzer = {
      ...b,
      attempts,
      lockedOut,
      winnerId: null,
      winnerName: null,
      answerDeadline: null,
      openUntil: Date.now() + Math.max(b.remainingMs, BUZZ_REOPEN_MIN_MS),
    };
    this.state.version = ++this.version;
    this.persistState();
  }

  /** Close the song in buzzer mode and show the reveal. */
  private finishBuzzerRound(winnerId: string | null): void {
    if (!this.state?.currentCard) return;
    const winner = winnerId ? this.state.players.find((p) => p.id === winnerId) : undefined;
    this.state.lastResult = {
      ...this.sharedRevealBase(this.state.currentCard),
      mode: 'buzzer',
      artistCorrect: !!winner,
      titleCorrect: !!winner,
      points: winner ? 1 : 0,
      buzz: {
        winnerId: winner?.id ?? null,
        winnerName: winner?.name ?? null,
        attempts: this.state.buzzer?.attempts ?? [],
      },
    };
    this.state.phase = 'round_result';
    this.state.buzzer = null;
    this.state.version = ++this.version;
    this.persistState();
  }

  /**
   * Reveal skeleton for the modes everyone plays at once. It is owned by
   * the player whose turn it is (they drew the card and continue the game);
   * the timeline-only fields stay neutral.
   */
  private sharedRevealBase(card: Card): NonNullable<MatchState['lastResult']> {
    const drawerId = this.state!.turnOrder[this.state!.currentPlayerIndex];
    const drawer = this.state!.players.find((p) => p.id === drawerId);
    return {
      playerId: drawerId,
      playerName: drawer?.name ?? '',
      card,
      guessedArtist: '',
      guessedTitle: '',
      guessedYear: card.year,
      artistCorrect: false,
      titleCorrect: false,
      yearExact: false,
      timelineCorrect: false,
      yearDiff: 0,
      points: 0,
    };
  }

  // ─── Snippet mode ───
  // Everyone hears the same snippet (played locally on each device) and
  // guesses once per stage. Artist and title can be found in different
  // stages — what a player got right stays right — and the song counts as
  // named once both are. The stage advances when every player still in the
  // race has guessed (or passed), or when the stage deadline runs out.

  private snippetGuess(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state || this.state.phase !== 'snippet' || !this.state.snippet || !this.state.currentCard) {
      return reject(this.version, 'NO_SNIPPET_PHASE');
    }
    const playerId = command.payload.playerId as string | undefined;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!playerId || !player) return reject(this.version, 'PLAYER_NOT_FOUND');

    const s = this.state.snippet;
    if (s.solved[playerId]) return reject(this.version, 'ALREADY_SOLVED');
    if (s.guessed.includes(playerId)) return reject(this.version, 'ALREADY_GUESSED');

    const card = this.state.currentCard;
    const artist = String(command.payload.artist ?? '').trim();
    const title = String(command.payload.title ?? '').trim();
    const passed = !!command.payload.pass || (!artist && !title);

    const prev = s.feedback[playerId];
    const feedback = { ...s.feedback };
    const solved = { ...s.solved };
    if (!passed) {
      const artistCorrect = !!prev?.artistCorrect || (!!artist && isArtistMatch(artist, card.artist));
      const titleCorrect = !!prev?.titleCorrect || (!!title && isCloseMatch(title, card.title));
      feedback[playerId] = {
        artist: artist || prev?.artist || '',
        title: title || prev?.title || '',
        artistCorrect,
        titleCorrect,
      };
      if (artistCorrect && titleCorrect) {
        const points = SNIPPET_POINTS[s.stage] ?? 1;
        solved[playerId] = { stage: s.stage, points };
        const idx = this.state.players.findIndex((p) => p.id === playerId);
        const p = this.state.players[idx];
        this.state.players[idx] = { ...p, score: p.score + points, hand: [...p.hand, card] };
      }
    }

    this.state.snippet = { ...s, feedback, solved, guessed: [...s.guessed, playerId] };

    const stillGuessing = this.state.players.filter(
      (p) => !solved[p.id] && !this.state!.snippet!.guessed.includes(p.id)
    );
    if (stillGuessing.length === 0) this.advanceSnippetStage();

    this.state.version = ++this.version;
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: {
        phase: this.state.phase,
        players: this.state.players,
        snippet: this.state.snippet,
        lastResult: this.state.lastResult,
      },
    };
  }

  /**
   * Next, longer snippet — or the reveal, once everyone has named the song
   * or the longest snippet is done. Mutates state only; the caller bumps the
   * version and persists.
   */
  private advanceSnippetStage(): void {
    if (!this.state?.snippet) return;
    const s = this.state.snippet;
    const everyoneSolved = this.state.players.every((p) => s.solved[p.id]);
    if (everyoneSolved || s.stage >= s.stages.length - 1) {
      this.finishSnippetRound();
      return;
    }
    this.state.snippet = {
      ...s,
      stage: s.stage + 1,
      guessed: [],
      deadline: Date.now() + SNIPPET_STAGE_MS,
    };
  }

  private finishSnippetRound(): void {
    if (!this.state?.snippet || !this.state.currentCard) return;
    const s = this.state.snippet;
    const results: SnippetPlayerResult[] = this.state.players.map((p) => ({
      playerId: p.id,
      playerName: p.name,
      solvedAtSec: s.solved[p.id] ? s.stages[s.solved[p.id].stage] : null,
      points: s.solved[p.id]?.points ?? 0,
      lastArtist: s.feedback[p.id]?.artist ?? '',
      lastTitle: s.feedback[p.id]?.title ?? '',
    }));
    const anySolved = results.some((r) => r.solvedAtSec !== null);
    this.state.lastResult = {
      ...this.sharedRevealBase(this.state.currentCard),
      mode: 'snippet',
      artistCorrect: anySolved,
      titleCorrect: anySolved,
      points: results.reduce((sum, r) => sum + r.points, 0),
      snippetResults: results,
    };
    this.state.phase = 'round_result';
    this.state.snippet = null;
  }

  // ─── Speak mode voting ───

  private voteReveal(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state || this.state.phase !== 'reveal_vote' || !this.state.voting) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_VOTE_PHASE' };
    }
    const playerId = command.payload.playerId as string | undefined;
    if (!playerId || !this.state.voting.voterIds.includes(playerId)) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOT_A_VOTER' };
    }

    this.state.voting = {
      ...this.state.voting,
      votes: {
        ...this.state.voting.votes,
        [playerId]: {
          artistOk: !!command.payload.artistOk,
          titleOk: !!command.payload.titleOk,
        },
      },
    };

    const allVoted = this.state.voting.voterIds.every((id) => this.state!.voting!.votes[id]);
    if (allVoted) {
      this.tallyVotes();
    } else {
      this.state.version = ++this.version;
      this.persistState();
    }

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: this.state.phase, voting: this.state.voting, lastResult: this.state.lastResult },
    };
  }

  /**
   * Majority of cast votes decides artist/title; ties go to the guesser.
   * No votes at all (window expired) → no extra points.
   */
  private tallyVotes(): void {
    if (!this.state || !this.state.voting || !this.state.lastResult) return;
    const votes = Object.values(this.state.voting.votes);
    const majority = (key: 'artistOk' | 'titleOk') =>
      votes.length > 0 && votes.filter((v) => v[key]).length * 2 >= votes.length;

    const artistOk = majority('artistOk');
    const titleOk = majority('titleOk');
    const bonus = (artistOk ? 1 : 0) + (titleOk ? 1 : 0);

    const idx = this.state.players.findIndex((p) => p.id === this.state!.lastResult!.playerId);
    if (idx !== -1 && bonus > 0) {
      this.state.players[idx] = {
        ...this.state.players[idx],
        score: this.state.players[idx].score + bonus,
      };
    }

    this.state.lastResult = {
      ...this.state.lastResult,
      artistCorrect: artistOk,
      titleCorrect: titleOk,
      points: this.state.lastResult.points + bonus,
    };
    this.state.phase = 'round_result';
    this.state.voting = null;
    this.state.version = ++this.version;
    this.persistState();
  }

  /**
   * The guesser confirms the reveal; only now does the turn advance.
   */
  private resolveTurn(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_MATCH' };
    }
    if (this.state.phase !== 'round_result' || !this.state.lastResult) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOTHING_TO_RESOLVE' };
    }

    const pid = command.payload.playerId;
    if (pid && pid !== 'local-player' && pid !== this.state.lastResult.playerId) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOT_YOUR_TURN' };
    }

    // Advance to next player or round
    const isLastPlayer = this.state.currentPlayerIndex >= this.state.players.length - 1;
    if (isLastPlayer) {
      this.state.currentRound++;
      this.state.currentPlayerIndex = 0;
    } else {
      this.state.currentPlayerIndex++;
    }

    const isGameOver = this.state.currentRound > this.state.totalRounds;
    this.state.phase = isGameOver ? 'finished' : 'drawing';
    this.state.currentCard = null;
    this.state.lastResult = null;
    this.state.turnDeadline = null;
    this.state.buzzer = null;
    this.state.snippet = null;
    this.state.voting = null;
    this.state.version = ++this.version;
    this.liveInput = null;
    this.playback = null;
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: {
        phase: this.state.phase,
        currentPlayerIndex: this.state.currentPlayerIndex,
        currentRound: this.state.currentRound,
        currentCard: null,
      },
    };
  }

  private endMatch(_command: CommandEnvelope): ResponseEnvelope {
    if (!this.state) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_MATCH' };
    }

    this.state.phase = 'finished';
    this.state.version = ++this.version;
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: 'finished' },
    };
  }

  private broadcastState(): void {
    if (!this.state) return;
    const currentVersion = this.state.version;
    this.clients.forEach((client) => {
      try {
        client.ws.send(JSON.stringify({
          type: 'state_sync',
          payload: this.state,
          version: currentVersion,
        }));
      } catch {
        this.clients.delete(client.playerId);
      }
    });
  }

  /**
   * Persist current state to DO storage for durability across evictions.
   * Called after every state mutation.
   */
  private persistState(): void {
    if (!this.state) return;
    this.storage.put('match-state', this.state).catch((err) => {
      console.error('[MatchRoom] Failed to persist state:', err);
    });
  }
}