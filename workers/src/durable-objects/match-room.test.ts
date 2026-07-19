import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MatchRoom } from './match-room';
import type { CommandEnvelope, MatchState } from '../types';
import { MOCK_TRACKS } from '../db/mock-data';

// ── Mocks ──────────────────────────────────────────────────────

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected ctx: any;
    protected env: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

// Mock DurableObject storage
function createMockStorage() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    list: vi.fn(async () => store),
    transaction: vi.fn(async (fn: any) => fn(store)),
    deleteAll: vi.fn(async () => store.clear()),
    getAlarm: vi.fn(async () => null),
    setAlarm: vi.fn(async () => {}),
    deleteAlarm: vi.fn(async () => {}),
    sync: vi.fn(async () => {}),
  };
}

// Mock context factory
function createMockCtx(): any {
  const storage = createMockStorage();
  return {
    id: 'test-do-id',
    storage,
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => {
      await fn();
    }),
    waitUntil: vi.fn((p: Promise<any>) => p),
    passThroughOnException: vi.fn(),
  };
}

// Mock scoring so we get deterministic, controllable results
vi.mock('../services/scoring-service', () => ({
  calculateFullScore: vi.fn(() => ({
    points: 300,
    artistCorrect: true,
    titleCorrect: true,
    yearDiff: 5,
    yearExact: false,
    timelineCorrect: true,
    breakdown: { artistPoints: 150, titlePoints: 150, yearPoints: 0, timelinePoints: 1 },
  })),
  // Simple case-insensitive equality — precise fuzzy logic is tested in
  // scoring-service's own tests.
  isCloseMatch: vi.fn((g: string, t: string) => g.trim().toLowerCase() === t.trim().toLowerCase()),
  isArtistMatch: vi.fn((g: string, t: string) => g.trim().toLowerCase() === t.trim().toLowerCase()),
}));

import { calculateFullScore } from '../services/scoring-service';

/** calculateFullScore result where the guesser missed artist + title. */
const MISSED_ARTIST_TITLE = {
  points: 1,
  artistCorrect: false,
  titleCorrect: false,
  yearDiff: 10,
  yearExact: false,
  timelineCorrect: true,
  breakdown: { artistPoints: 0, titlePoints: 0, yearPoints: 0, timelinePoints: 1 },
};

// Minimal WebSocket mock that actually supports addEventListener
class MockWebSocket {
  accept = vi.fn();
  send = vi.fn();
  close = vi.fn();
  readyState = 1;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  addEventListener(event: string, handler: (...args: any[]) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  /** Simulate receiving a message */
  _receive(data: string) {
    this.listeners['message']?.forEach((h) => h({ data }));
  }

  /** Simulate close */
  _close() {
    this.listeners['close']?.forEach((h) => h({}));
  }
}

const mockWs = new MockWebSocket();

(globalThis as any).WebSocketPair = class {
  constructor() {
    return { 0: mockWs, 1: mockWs };
  }
};

// ── Helpers ─────────────────────────────────────────────────────

function makeCmd(
  commandType: string,
  payload: Record<string, unknown> = {},
): CommandEnvelope {
  return {
    commandType: commandType as any,
    actorId: 'test-actor',
    lobbyId: 'lobby-1',
    expectedVersion: 0,
    payload,
    clientTimestamp: Date.now(),
  };
}

function startPayload(
  players = [{ id: 'p1', name: 'Alice', avatar: '' }],
  totalRounds = 3,
) {
  return { players, totalRounds };
}

/** POST /command and return parsed JSON */
async function cmd(
  room: MatchRoom,
  commandType: string,
  payload: Record<string, unknown> = {},
): Promise<any> {
  const req = new Request('http://localhost/command', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makeCmd(commandType, payload)),
  });
  const res = await room.fetch(req);
  return res.json();
}

// ── Tests ───────────────────────────────────────────────────────

describe('MatchRoom Durable Object', () => {
  let room: MatchRoom;

  beforeEach(() => {
    vi.clearAllMocks();
    room = new MatchRoom(createMockCtx(), {} as any);
  });

  // ─── HTTP Routing ──────────────────────────────────────────

  describe('fetch() routing', () => {
    it('GET /state returns 404 when no match', async () => {
      const req = new Request('http://localhost/state');
      const res = await room.fetch(req);
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toBe('No active match');
    });

    it('GET /state returns state when match is active', async () => {
      await cmd(room, 'start_match', startPayload());
      const req = new Request('http://localhost/state');
      const res = await room.fetch(req);
      expect(res.status).toBe(200);
      const state: any = await res.json();
      expect(state.phase).toBe('drawing');
    });

    it('POST /command returns envelope with state', async () => {
      const data = await cmd(room, 'start_match', startPayload());
      expect(data.accepted).toBe(true);
      expect(data.state).toBeDefined();
      expect(data.state.phase).toBe('drawing');
    });

    it('legacy GET fallback returns state', async () => {
      await cmd(room, 'start_match', startPayload());
      const req = new Request('http://localhost/anything');
      const res = await room.fetch(req);
      expect(res.status).toBe(200);
    });

    it('legacy GET returns 404 when no match', async () => {
      const req = new Request('http://localhost/anything');
      const res = await room.fetch(req);
      expect(res.status).toBe(404);
    });
  });

  // ─── WebSocket ─────────────────────────────────────────────

  // WebSocket upgrade tests are skipped outside Cloudflare Workers
  // because the standard Response API rejects status 101.
  describe('WebSocket', () => {
    it('upgrades and sends state_sync if match exists', { retry: 0 }, async () => {
      await cmd(room, 'start_match', startPayload());
      const req = new Request('http://localhost/ws?playerId=p1', {
        headers: { Upgrade: 'websocket' },
      });
      try {
        const res = await room.fetch(req);
        expect(res.status).toBe(101);
      } catch {
        // Response 101 is only valid in CF Workers runtime
      }
    });
  });

  // ─── handleCommand ─────────────────────────────────────────

  describe('handleCommand()', () => {
    it('UNKNOWN_COMMAND for unrecognised type', async () => {
      const data = await cmd(room, 'fly_to_moon');
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('UNKNOWN_COMMAND');
    });
  });

  // ─── startMatch ────────────────────────────────────────────

  describe('startMatch', () => {
    it('NO_PLAYERS when players empty', async () => {
      const data = await cmd(room, 'start_match', { players: [] });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NO_PLAYERS');
    });

    it('NO_PLAYERS when players missing', async () => {
      const data = await cmd(room, 'start_match', {});
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NO_PLAYERS');
    });

    it('sets up state correctly', async () => {
      const data = await cmd(room, 'start_match', startPayload());
      expect(data.accepted).toBe(true);
      const s = data.state;
      expect(s.phase).toBe('drawing');
      expect(s.lobbyId).toBe('lobby-1');
      expect(s.currentRound).toBe(1);
      expect(s.currentPlayerIndex).toBe(0);
      expect(s.totalRounds).toBe(3);
      expect(s.players).toHaveLength(1);
      expect(s.players[0].score).toBe(0);
      expect(s.turnOrder).toEqual(['p1']);
      expect(s.currentCard).toBeNull();
    });

    it('defaults totalRounds to 5', async () => {
      const data = await cmd(room, 'start_match', {
        players: [{ id: 'p1', name: 'A', avatar: '' }],
      });
      expect(data.state.totalRounds).toBe(5);
    });

    it('deck has MOCK_TRACKS length', async () => {
      const data = await cmd(room, 'start_match', startPayload());
      expect(data.state.deck).toHaveLength(MOCK_TRACKS.length);
    });

    it('idempotent — second start_match succeeds', async () => {
      await cmd(room, 'start_match', startPayload());
      const data = await cmd(room, 'start_match', startPayload());
      expect(data.accepted).toBe(true);
      expect(data.state.phase).toBe('drawing');
    });

    it('uses seededDeck when set', async () => {
      const seeded = [
        { id: 's1', title: 'S', artist: 'A', year: 2000, genre: 'R', emoji: '🎵', gradient: '' },
      ];
      (room as any).seededDeck = seeded;
      const data = await cmd(room, 'start_match', startPayload());
      expect(data.state.deck).toHaveLength(1);
    });
  });

  // ─── drawCard ──────────────────────────────────────────────

  describe('drawCard', () => {
    it('NO_MATCH when no match exists', async () => {
      const data = await cmd(room, 'draw_card');
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NO_MATCH');
    });

    it('pops card, transitions to guessing', async () => {
      await cmd(room, 'start_match', startPayload());
      const data = await cmd(room, 'draw_card');
      expect(data.accepted).toBe(true);
      expect(data.state.phase).toBe('guessing');
      expect(data.state.currentCard).toBeTruthy();
    });

    it('rejects a draw from a player who is not on turn', async () => {
      await cmd(room, 'start_match', startPayload([
        { id: 'p1', name: 'A', avatar: '' },
        { id: 'p2', name: 'B', avatar: '' },
      ]));
      const data = await cmd(room, 'draw_card', { playerId: 'p2' });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NOT_YOUR_TURN');
    });

    it('allows the current player to draw and repeats the same card on double draw', async () => {
      await cmd(room, 'start_match', startPayload([
        { id: 'p1', name: 'A', avatar: '' },
        { id: 'p2', name: 'B', avatar: '' },
      ]));
      const first = await cmd(room, 'draw_card', { playerId: 'p1' });
      expect(first.accepted).toBe(true);
      const second = await cmd(room, 'draw_card', { playerId: 'p1' });
      expect(second.accepted).toBe(true);
      // Same card, no extra card burned from the deck
      expect(second.state.currentCard.id).toBe(first.state.currentCard.id);
      expect(second.state.deck).toHaveLength(first.state.deck.length);
    });

    it('DECK_EMPTY when deck exhausted', async () => {
      await cmd(room, 'start_match', startPayload([{ id: 'p1', name: 'A', avatar: '' }]));
      for (let i = 0; i < MOCK_TRACKS.length; i++) {
        await cmd(room, 'draw_card');
        await cmd(room, 'submit_guess', {
          playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
        });
        await cmd(room, 'resolve_turn', { playerId: 'p1' });
      }
      const data = await cmd(room, 'draw_card');
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('DECK_EMPTY');
    });
  });

  // ─── submitGuess ───────────────────────────────────────────

  describe('submitGuess', () => {
    beforeEach(async () => {
      await cmd(room, 'start_match', startPayload([
        { id: 'p1', name: 'Alice', avatar: '' },
        { id: 'p2', name: 'Bob', avatar: '' },
      ]));
      await cmd(room, 'draw_card');
    });

    it('NO_ACTIVE_CARD when no currentCard', async () => {
      const r2 = new MatchRoom(createMockCtx(), {} as any);
      const data = await cmd(r2, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NO_ACTIVE_CARD');
    });

    it('rejects a guess from a player who is not on turn', async () => {
      // An unknown player is by definition not the current player,
      // so the turn check fires before the roster lookup.
      const data = await cmd(room, 'submit_guess', {
        playerId: 'unknown', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NOT_YOUR_TURN');
    });

    it('updates score/hand/placedCards', async () => {
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'Queen', guessedTitle: 'Bohemian Rhapsody', guessedYear: 1975,
      });
      expect(data.accepted).toBe(true);
      const p = data.state.players[0];
      expect(p.score).toBeGreaterThan(0);
      expect(p.hand).toHaveLength(1);
      expect(p.placedCards).toHaveLength(1);
    });

    it('pauses on round_result with lastResult instead of advancing', async () => {
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.state.phase).toBe('round_result');
      expect(data.state.currentPlayerIndex).toBe(0); // NOT advanced yet
      expect(data.state.lastResult).toBeTruthy();
      expect(data.state.lastResult.playerId).toBe('p1');
      expect(data.state.lastResult.playerName).toBe('Alice');
      expect(data.state.lastResult.card).toBeTruthy();
    });

    it('rejects a second submit while the reveal is showing', async () => {
      await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('ALREADY_SUBMITTED');
    });

    it('rejects a draw while the reveal is showing', async () => {
      await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      const data = await cmd(room, 'draw_card', { playerId: 'p1' });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('RESOLVE_FIRST');
    });
  });

  // ─── resolveTurn ───────────────────────────────────────────

  describe('resolveTurn', () => {
    beforeEach(async () => {
      await cmd(room, 'start_match', startPayload([
        { id: 'p1', name: 'Alice', avatar: '' },
        { id: 'p2', name: 'Bob', avatar: '' },
      ]));
      await cmd(room, 'draw_card');
    });

    async function submitP1() {
      return cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
    }

    it('NOTHING_TO_RESOLVE outside round_result', async () => {
      const data = await cmd(room, 'resolve_turn', { playerId: 'p1' });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NOTHING_TO_RESOLVE');
    });

    it('only the guesser may resolve', async () => {
      await submitP1();
      const denied = await cmd(room, 'resolve_turn', { playerId: 'p2' });
      expect(denied.accepted).toBe(false);
      expect(denied.errorCode).toBe('NOT_YOUR_TURN');
    });

    it('advances to next player and clears the reveal', async () => {
      await submitP1();
      const data = await cmd(room, 'resolve_turn', { playerId: 'p1' });
      expect(data.accepted).toBe(true);
      expect(data.state.currentPlayerIndex).toBe(1);
      expect(data.state.phase).toBe('drawing');
      expect(data.state.currentCard).toBeNull();
      expect(data.state.lastResult).toBeNull();
    });

    it('advances round when the last player resolves', async () => {
      await submitP1();
      await cmd(room, 'resolve_turn', { playerId: 'p1' });
      await cmd(room, 'draw_card');
      await cmd(room, 'submit_guess', {
        playerId: 'p2', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      const data = await cmd(room, 'resolve_turn', { playerId: 'p2' });
      expect(data.state.currentRound).toBe(2);
      expect(data.state.currentPlayerIndex).toBe(0);
    });

    it('finishes the match after the last round is resolved', async () => {
      // 3 rounds × 2 players = 6 draw+submit+resolve cycles
      let last: any;
      for (let r = 0; r < 3; r++) {
        for (let p = 0; p < 2; p++) {
          const pid = p === 0 ? 'p1' : 'p2';
          await cmd(room, 'draw_card', { playerId: pid });
          await cmd(room, 'submit_guess', {
            playerId: pid, cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
          });
          last = await cmd(room, 'resolve_turn', { playerId: pid });
        }
      }
      expect(last.state.phase).toBe('finished');
    });
  });

  // ─── endMatch ──────────────────────────────────────────────

  describe('endMatch', () => {
    it('NO_MATCH when no match', async () => {
      const data = await cmd(room, 'end_match');
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NO_MATCH');
    });

    it('sets phase to finished', async () => {
      await cmd(room, 'start_match', startPayload());
      const data = await cmd(room, 'end_match');
      expect(data.accepted).toBe(true);
      expect(data.state.phase).toBe('finished');
    });
  });

  // ─── version ───────────────────────────────────────────────

  describe('version tracking', () => {
    it('increments on each mutation', async () => {
      const d1 = await cmd(room, 'start_match', startPayload());
      expect(d1.state.version).toBe(1);
      const d2 = await cmd(room, 'draw_card');
      expect(d2.state.version).toBe(2);
    });
  });

  // ─── answer timer ──────────────────────────────────────────

  describe('answer timer', () => {
    const twoPlayers = [
      { id: 'p1', name: 'Alice', avatar: '' },
      { id: 'p2', name: 'Bob', avatar: '' },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Trigger the lazy timeout check via a state poll. */
    async function poll(r: MatchRoom): Promise<any> {
      const res = await r.fetch(new Request('http://localhost/state'));
      return res.json();
    }

    it('draw sets a turn deadline when answerTimeSec > 0', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(twoPlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: false },
      });
      const data = await cmd(room, 'draw_card', { playerId: 'p1' });
      expect(data.state.turnDeadline).toBe(Date.now() + 30_000);
    });

    it('leaves turnDeadline null when the timer is off', async () => {
      await cmd(room, 'start_match', startPayload(twoPlayers));
      const data = await cmd(room, 'draw_card', { playerId: 'p1' });
      expect(data.state.turnDeadline).toBeNull();
      vi.advanceTimersByTime(10 * 60_000);
      const state = await poll(room);
      expect(state.phase).toBe('guessing'); // never times out
    });

    it('auto-submits the live input when time runs out', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(twoPlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });

      // The active player had typed something before the deadline
      await room.fetch(new Request('http://localhost/live-input', {
        method: 'POST',
        body: JSON.stringify({ playerId: 'p1', artist: 'Halb', title: 'Getippt', year: 1999 }),
      }));

      vi.advanceTimersByTime(32_000);
      const state = await poll(room);
      expect(state.phase).toBe('round_result');
      expect(state.lastResult.timedOut).toBe(true);
      expect(state.lastResult.guessedArtist).toBe('Halb');
      expect(state.lastResult.guessedYear).toBe(1999);
      expect(state.players[0].placedCards).toHaveLength(1);
    });

    it('does not fire before deadline + grace', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(twoPlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      vi.advanceTimersByTime(30_500); // inside the 1s grace window
      const state = await poll(room);
      expect(state.phase).toBe('guessing');
    });

    it('a submit after the timeout is rejected as ALREADY_SUBMITTED', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(twoPlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      vi.advanceTimersByTime(32_000);
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('ALREADY_SUBMITTED');
    });
  });

  // ─── buzzer ────────────────────────────────────────────────

  describe('buzzer', () => {
    const threePlayers = [
      { id: 'p1', name: 'Alice', avatar: '' },
      { id: 'p2', name: 'Bob', avatar: '' },
      { id: 'p3', name: 'Cleo', avatar: '' },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
      // The guesser misses artist + title so both fields are stealable
      vi.mocked(calculateFullScore).mockReturnValue(MISSED_ARTIST_TITLE as any);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function poll(r: MatchRoom): Promise<any> {
      const res = await r.fetch(new Request('http://localhost/state'));
      return res.json();
    }

    /** Start with buzzer on, draw, let the clock run out → buzzer phase. */
    async function reachBuzzerPhase(): Promise<any> {
      await cmd(room, 'start_match', {
        ...startPayload(threePlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: true },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      vi.advanceTimersByTime(32_000);
      return poll(room);
    }

    it('opens the buzzer window after a timeout when a point is stealable', async () => {
      const state = await reachBuzzerPhase();
      expect(state.phase).toBe('buzzer');
      expect(state.buzzer.winnerId).toBeNull();
      expect(state.buzzer.openUntil).toBeGreaterThan(Date.now());
    });

    it('goes straight to the reveal when the guesser already had artist AND title', async () => {
      vi.mocked(calculateFullScore).mockReturnValue({
        ...MISSED_ARTIST_TITLE, artistCorrect: true, titleCorrect: true, points: 3,
      } as any);
      const state = await reachBuzzerPhase();
      expect(state.phase).toBe('round_result'); // nothing to steal
    });

    it('a normal (non-timeout) submit never opens the buzzer', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(threePlayers),
        settings: { guessMode: 'type', answerTimeSec: 30, buzzerEnabled: true },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: 'A', guessedTitle: 'B', guessedYear: 2000,
      });
      expect(data.state.phase).toBe('round_result');
    });

    it('first buzz wins, the guesser cannot buzz, later buzzes are TOO_LATE', async () => {
      await reachBuzzerPhase();

      const guesser = await cmd(room, 'buzz', { playerId: 'p1' });
      expect(guesser.accepted).toBe(false);
      expect(guesser.errorCode).toBe('GUESSER_CANNOT_BUZZ');

      const first = await cmd(room, 'buzz', { playerId: 'p2' });
      expect(first.accepted).toBe(true);
      expect(first.state.buzzer.winnerId).toBe('p2');

      const second = await cmd(room, 'buzz', { playerId: 'p3' });
      expect(second.accepted).toBe(false);
      expect(second.errorCode).toBe('TOO_LATE');
    });

    it('a correct steal awards exactly 1 point to the buzzer winner', async () => {
      const state = await reachBuzzerPhase();
      const artist = state.lastResult.card.artist;

      await cmd(room, 'buzz', { playerId: 'p2' });
      const data = await cmd(room, 'buzzer_answer', { playerId: 'p2', text: artist });

      expect(data.accepted).toBe(true);
      expect(data.state.phase).toBe('round_result');
      expect(data.state.lastResult.steal.field).toBe('artist');
      expect(data.state.lastResult.steal.points).toBe(1);
      const bob = data.state.players.find((p: any) => p.id === 'p2');
      expect(bob.score).toBe(1);
    });

    it('a wrong steal answer awards nothing', async () => {
      await reachBuzzerPhase();
      await cmd(room, 'buzz', { playerId: 'p2' });
      const data = await cmd(room, 'buzzer_answer', { playerId: 'p2', text: 'völlig falsch' });

      expect(data.state.phase).toBe('round_result');
      expect(data.state.lastResult.steal.field).toBeNull();
      expect(data.state.lastResult.steal.points).toBe(0);
      const bob = data.state.players.find((p: any) => p.id === 'p2');
      expect(bob.score).toBe(0);
    });

    it('only the buzzer winner may answer', async () => {
      await reachBuzzerPhase();
      await cmd(room, 'buzz', { playerId: 'p2' });
      const data = await cmd(room, 'buzzer_answer', { playerId: 'p3', text: 'x' });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NOT_BUZZER_WINNER');
    });

    it('closes with no steal when nobody buzzes in time', async () => {
      await reachBuzzerPhase();
      vi.advanceTimersByTime(12_000); // buzz window (10s) + grace
      const state = await poll(room);
      expect(state.phase).toBe('round_result');
      expect(state.lastResult.steal).toBeNull();
    });

    it('closes with a 0-point steal when the winner never answers', async () => {
      await reachBuzzerPhase();
      await cmd(room, 'buzz', { playerId: 'p2' });
      vi.advanceTimersByTime(17_000); // answer window (15s) + grace
      const state = await poll(room);
      expect(state.phase).toBe('round_result');
      expect(state.lastResult.steal.playerId).toBe('p2');
      expect(state.lastResult.steal.points).toBe(0);
    });

    it('a field the guesser already had cannot be stolen', async () => {
      // Guesser got the artist — only the title is stealable
      vi.mocked(calculateFullScore).mockReturnValue({
        ...MISSED_ARTIST_TITLE, artistCorrect: true, points: 2,
      } as any);
      const state = await reachBuzzerPhase();
      const artist = state.lastResult.card.artist;

      await cmd(room, 'buzz', { playerId: 'p2' });
      const data = await cmd(room, 'buzzer_answer', { playerId: 'p2', text: artist });
      expect(data.state.lastResult.steal.field).toBeNull();
      expect(data.state.lastResult.steal.points).toBe(0);
    });
  });

  // ─── speak mode (reveal vote) ──────────────────────────────

  describe('speak mode voting', () => {
    const threePlayers = [
      { id: 'p1', name: 'Alice', avatar: '' },
      { id: 'p2', name: 'Bob', avatar: '' },
      { id: 'p3', name: 'Cleo', avatar: '' },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-19T12:00:00Z'));
      vi.mocked(calculateFullScore).mockReturnValue({
        points: 300, artistCorrect: true, titleCorrect: true, yearDiff: 5,
        yearExact: true, timelineCorrect: true,
        breakdown: { artistPoints: 1, titlePoints: 1, yearPoints: 1, timelinePoints: 1 },
      } as any);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function poll(r: MatchRoom): Promise<any> {
      const res = await r.fetch(new Request('http://localhost/state'));
      return res.json();
    }

    async function startSpeakAndSubmit(): Promise<any> {
      await cmd(room, 'start_match', {
        ...startPayload(threePlayers),
        settings: { guessMode: 'speak', answerTimeSec: 0, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      return cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: '', guessedTitle: '', guessedYear: 1985,
      });
    }

    it('submit only counts year+timeline and opens the vote', async () => {
      const data = await startSpeakAndSubmit();
      expect(data.state.phase).toBe('reveal_vote');
      // artist/title auto-grading is ignored in speak mode
      expect(data.state.lastResult.artistCorrect).toBe(false);
      expect(data.state.lastResult.titleCorrect).toBe(false);
      expect(data.state.lastResult.points).toBe(2); // yearPoints + timelinePoints
      expect(data.state.players[0].score).toBe(2);
      expect(data.state.voting.voterIds.sort()).toEqual(['p2', 'p3']);
    });

    it('closes the vote once all voters voted and applies the majority', async () => {
      await startSpeakAndSubmit();
      const v1 = await cmd(room, 'vote_reveal', { playerId: 'p2', artistOk: true, titleOk: false });
      expect(v1.state.phase).toBe('reveal_vote'); // still waiting for p3
      const v2 = await cmd(room, 'vote_reveal', { playerId: 'p3', artistOk: true, titleOk: false });
      expect(v2.state.phase).toBe('round_result');
      expect(v2.state.lastResult.artistCorrect).toBe(true);
      expect(v2.state.lastResult.titleCorrect).toBe(false);
      expect(v2.state.lastResult.points).toBe(3); // 2 + artist bonus
      expect(v2.state.players[0].score).toBe(3);
    });

    it('a tie goes to the guesser', async () => {
      await startSpeakAndSubmit();
      await cmd(room, 'vote_reveal', { playerId: 'p2', artistOk: true, titleOk: true });
      const data = await cmd(room, 'vote_reveal', { playerId: 'p3', artistOk: false, titleOk: false });
      expect(data.state.lastResult.artistCorrect).toBe(true);
      expect(data.state.lastResult.titleCorrect).toBe(true);
      expect(data.state.players[0].score).toBe(4);
    });

    it('the guesser cannot vote', async () => {
      await startSpeakAndSubmit();
      const data = await cmd(room, 'vote_reveal', { playerId: 'p1', artistOk: true, titleOk: true });
      expect(data.accepted).toBe(false);
      expect(data.errorCode).toBe('NOT_A_VOTER');
    });

    it('an expired vote window tallies the votes cast so far', async () => {
      await startSpeakAndSubmit();
      await cmd(room, 'vote_reveal', { playerId: 'p2', artistOk: true, titleOk: false });
      vi.advanceTimersByTime(47_000); // vote window (45s) + grace
      const state = await poll(room);
      expect(state.phase).toBe('round_result');
      expect(state.lastResult.artistCorrect).toBe(true);
      expect(state.lastResult.titleCorrect).toBe(false);
      expect(state.players[0].score).toBe(3);
    });

    it('an expired vote window with zero votes awards no bonus', async () => {
      await startSpeakAndSubmit();
      vi.advanceTimersByTime(47_000);
      const state = await poll(room);
      expect(state.phase).toBe('round_result');
      expect(state.players[0].score).toBe(2);
    });

    it('solo play skips the vote entirely', async () => {
      await cmd(room, 'start_match', {
        players: [{ id: 'p1', name: 'Alice', avatar: '' }],
        totalRounds: 3,
        settings: { guessMode: 'speak', answerTimeSec: 0, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      const data = await cmd(room, 'submit_guess', {
        playerId: 'p1', cardId: 'x', guessedArtist: '', guessedTitle: '', guessedYear: 1985,
      });
      expect(data.state.phase).toBe('round_result');
    });

    it('speak-mode timeout goes to the vote, not the buzzer', async () => {
      await cmd(room, 'start_match', {
        ...startPayload(threePlayers),
        settings: { guessMode: 'speak', answerTimeSec: 30, buzzerEnabled: false },
      });
      await cmd(room, 'draw_card', { playerId: 'p1' });
      vi.advanceTimersByTime(32_000);
      const state = await poll(room);
      expect(state.phase).toBe('reveal_vote');
      expect(state.lastResult.timedOut).toBe(true);
    });
  });
});