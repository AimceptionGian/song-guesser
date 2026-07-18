import { DurableObject } from 'cloudflare:workers';
import type { MatchState, MatchPlayer, Card, CommandEnvelope, ResponseEnvelope, CommandType, LiveInput, PlaybackState } from '../types';
import { MOCK_TRACKS, shuffleArray } from '../db/mock-data';
import { calculateFullScore } from '../services/scoring-service';
import type { GuessSubmission } from '../types';
import type { Env } from '../env';

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
    });
  }

  // ─── WebSocket handling ───

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const playerId = url.searchParams.get('playerId') || 'unknown';

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
      }
      return Response.json({ accepted: true, count: deck?.length ?? 0 });
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
    return { ...this.state, liveInput: this.liveInput, playback: this.playback };
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

    switch (command.commandType) {
      case 'start_match':
        return this.startMatch(command);
      case 'draw_card':
        return this.drawCard(command);
      case 'submit_guess':
        return this.submitGuess(command);
      case 'resolve_turn':
        return this.resolveTurn(command);
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

    const deck = shuffleArray(this.seededDeck && this.seededDeck.length > 0 ? this.seededDeck : MOCK_TRACKS);

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
    };
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: 'drawing' },
    };
  }

  private drawCard(command: CommandEnvelope): ResponseEnvelope {
    if (!this.state) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NO_MATCH' };
    }

    if (!this.isCurrentPlayer(command.payload.playerId)) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOT_YOUR_TURN' };
    }

    // The pending reveal must be resolved before the next card
    if (this.state.phase === 'round_result') {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'RESOLVE_FIRST' };
    }

    // Idempotent while a card is already active: a second draw (double-click,
    // re-render) must not burn another card from the deck.
    if (this.state.phase === 'guessing' && this.state.currentCard) {
      return {
        accepted: true,
        newVersion: this.version,
        stateDelta: { phase: 'guessing', currentCard: this.state.currentCard },
      };
    }

    const card = this.state.deck.pop();
    if (!card) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'DECK_EMPTY' };
    }

    this.state.currentCard = card;
    this.state.phase = 'guessing';
    this.state.version = ++this.version;
    this.liveInput = null;
    this.playback = null;
    this.persistState();

    return {
      accepted: true,
      newVersion: this.version,
      stateDelta: { phase: 'guessing', currentCard: card },
    };
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
    const card = this.state.currentCard;

    if (!this.isCurrentPlayer(submission.playerId)) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'NOT_YOUR_TURN' };
    }

    const playerIdx = this.state.players.findIndex((p) => p.id === submission.playerId);
    if (playerIdx === -1) {
      return { accepted: false, newVersion: this.version, stateDelta: {}, errorCode: 'PLAYER_NOT_FOUND' };
    }

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

    this.state.players[playerIdx] = {
      ...this.state.players[playerIdx],
      score: this.state.players[playerIdx].score + result.points,
      hand: [...this.state.players[playerIdx].hand, card],
      placedCards: [
        ...this.state.players[playerIdx].placedCards,
        { card, placedYear: submission.guessedYear, isCorrect: result.timelineCorrect },
      ],
    };

    // Pause on the reveal: everyone sees the result until the guesser
    // explicitly continues (resolve_turn). Turn/round do NOT advance here.
    this.state.phase = 'round_result';
    this.state.lastResult = {
      playerId: submission.playerId,
      playerName: this.state.players[playerIdx].name,
      card,
      guessedArtist: submission.guessedArtist,
      guessedTitle: submission.guessedTitle,
      guessedYear: submission.guessedYear,
      artistCorrect: result.artistCorrect,
      titleCorrect: result.titleCorrect,
      yearExact: result.yearExact,
      timelineCorrect: result.timelineCorrect,
      yearDiff: result.yearDiff,
      points: result.points,
    };
    this.state.version = ++this.version;
    this.liveInput = null;
    this.playback = null;
    this.persistState();

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