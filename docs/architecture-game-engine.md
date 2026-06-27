# 🎵 SongGuesser Game Engine Architecture

> Deep-dive document covering game state management, real-time WebSocket synchronization,  
> multiplayer conflict resolution, Durable Object lifecycle, and turn state transitions.

---

## Table of Contents

1. [High-Level Architecture Overview](#1-high-level-architecture-overview)
2. [Game State Management](#2-game-state-management)
3. [Turn Lifecycle & State Transitions](#3-turn-lifecycle--state-transitions)
4. [Real-Time WebSocket Communication](#4-real-time-websocket-communication)
5. [Multiplayer Conflict Resolution](#5-multiplayer-conflict-resolution)
6. [Durable Object Lifecycle & Failover Strategy](#6-durable-object-lifecycle--failover-strategy)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Edge Cases & Failure Modes](#8-edge-cases--failure-modes)

---

## 1. High-Level Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENTS (React SPA)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ Player 1 │  │ Player 2 │  │ Player 3 │  │ Player N │            │
│  │  (Host)  │  │          │  │          │  │          │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │              │                  │
│       │  WebSocket   │  WebSocket   │  WebSocket   │  WebSocket     │
│       └──────────┬───┴──────┬───────┴──────┬───────┘                │
└──────────────────┼──────────┼──────────────┼─────────────────────────┘
                   │          │              │
          ┌────────▼──────────▼──────────────▼────────┐
          │     CLOUDFLARE DURABLE OBJECTS             │
          │     (WebSocket Hibernation API)            │
          │                                            │
          │  ┌──────────────────────────────────────┐  │
          │  │         MatchRoom DO                 │  │
          │  │  - Authoritative game state          │  │
          │  │  - Turn sequencing                   │  │
          │  │  - Score calculation                 │  │
          │  │  - Deck management                   │  │
          │  │  - Broadcast to all clients          │  │
          │  └──────────────────────────────────────┘  │
          │                                            │
          │  ┌──────────────────────────────────────┐  │
          │  │         PresenceRoom DO              │  │
          │  │  - Online/offline tracking           │  │
          │  │  - Heartbeat management              │  │
          │  │  - Lobby occupancy                   │  │
          │  └──────────────────────────────────────┘  │
          │                                            │
          │  ┌──────────────────────────────────────┐  │
          │  │         LeaderboardDO                │  │
          │  │  - Persistent score history          │  │
          │  │  - Queryable via D1 or KV            │  │
          │  └──────────────────────────────────────┘  │
          └────────────────────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │   Cloudflare KV       │
              │   (State snapshots)   │
              │   (Seeded decks)      │
              └───────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Persistence |
|-----------|---------------|-------------|
| **MatchRoom DO** | Authoritative game state, turn logic, scoring, broadcast | In-memory + KV snapshots |
| **PresenceRoom DO** | Player online/offline tracking, heartbeat | In-memory |
| **LeaderboardDO** | Historical scores, statistics | D1/KV |
| **Cloudflare KV** | State snapshots for recovery, seeded decks | Persistent |
| **React Client** | UI rendering, optimistic state, input collection | Local state |

---

## 2. Game State Management

### 2.1 Authoritative State Model

The server (MatchRoom Durable Object) holds the **single source of truth**. The client maintains a **shadow copy** that is updated via server-pushed deltas.

```typescript
// ── Server-side canonical state (MatchRoom) ──
interface MatchState {
  lobbyId: string;
  version: number;              // Monotonic version counter (CRDT-like)
  phase: GamePhase;
  players: MatchPlayer[];
  currentPlayerIndex: number;
  currentRound: number;
  totalRounds: number;
  currentCard: Track | null;
  deck: Track[];
  turnOrder: string[];          // Player IDs in seating order
  startedAt: number;
}

type GamePhase =
  | 'lobby'       // Waiting for players, configuring
  | 'drawing'     // Current player must draw a card
  | 'guessing'    // Players submit year guesses
  | 'scoring'     // Scores calculated, results displayed
  | 'finished';   // All rounds complete

interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  score: number;
  hand: Track[];                // Cards won this match
  placedCards: PlacedCard[];    // Historical placement data
}

interface PlacedCard {
  card: Track;
  placedYear: number;
  isCorrect: boolean;
}
```

### 2.2 Client-Side Shadow State

The client maintains a mirror of the server state, updated through two channels:

1. **Full state sync** (`state_sync` messages) — complete replacement
2. **Delta patches** (`state_delta` messages) — partial updates for efficiency

```typescript
// ── Client-side state manager ──
interface ClientGameState {
  serverState: MatchState;       // Last known server state
  localOptimistic: Partial<MatchState>;  // Uncommitted local changes
  lastSyncVersion: number;      // Version of last acknowledged sync
  pendingCommands: CommandEnvelope[];    // Commands awaiting server ack
}

// Resolution: merge server state with local optimistic overlay
function resolveDisplayState(client: ClientGameState): MatchState {
  return { ...client.serverState, ...client.localOptimistic };
}
```

### 2.3 State Snapshot & Recovery

To survive Durable Object restarts (hibernation, eviction), state is periodically persisted to KV:

```
Snapshot Strategy:
┌─────────────────────────────────────────────┐
│  Every state-mutating operation:            │
│    1. Mutate in-memory state                │
│    2. Increment version                     │
│    3. Broadcast to clients                  │
│    4. Async persist to KV (non-blocking)    │
│                                             │
│  On DO wake from hibernation:               │
│    1. Load latest snapshot from KV          │
│    2. Validate state integrity              │
│    3. Resume from loaded state              │
│    4. Notify clients of reconnection        │
└─────────────────────────────────────────────┘
```

```typescript
// KV snapshot key convention
const SNAPSHOT_KEY = (lobbyId: string) => `match:${lobbyId}:snapshot`;
const SNAPSHOT_TTL = 60 * 60 * 2;  // 2 hours expiry

// Persist (fire-and-forget, non-blocking)
private async persistSnapshot(): Promise<void> {
  if (!this.state) return;
  await this.env.KV.put(
    SNAPSHOT_KEY(this.state.lobbyId),
    JSON.stringify({ state: this.state, version: this.version }),
    { expirationTtl: SNAPSHOT_TTL }
  );
}

// Restore (on wake)
private async restoreFromSnapshot(lobbyId: string): Promise<boolean> {
  const raw = await this.env.KV.get(SNAPSHOT_KEY(lobbyId));
  if (!raw) return false;
  const snapshot = JSON.parse(raw);
  this.state = snapshot.state;
  this.version = snapshot.version;
  return true;
}
```

---

## 3. Turn Lifecycle & State Transitions

### 3.1 State Machine

```
                          ┌─────────┐
                          │  LOBBY  │◄─────────────────────┐
                          └────┬────┘                      │
                               │ startMatch                │
                               ▼                           │
                     ┌─────────────────┐                   │
                     │    DRAWING      │──── endMatch ─────┘
                     │ (active player  │                   │
                     │  draws a card)  │                   │
                     └────────┬────────┘                   │
                              │ drawCard                   │
                              ▼                            │
                     ┌─────────────────┐                   │
                     │   GUESSING      │                   │
                     │ (all players    │                   │
                     │  submit guesses)│                   │
                     └────────┬────────┘                   │
                              │ submitGuess (last player)  │
                              ▼                            │
                     ┌─────────────────┐     round ≤ max   │
                     │    SCORING      │────────────────────┘
                     │ (results shown, │     (next round:
                     │  next turn prep)│      back to DRAWING)
                     └────────┬────────┘
                              │ round > totalRounds
                              ▼
                     ┌─────────────────┐
                     │    FINISHED     │
                     │ (final scores,  │
                     │  leaderboard)   │
                     └─────────────────┘
```

### 3.2 Detailed Turn Flow

```
Turn N (Player P, Round R):
━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌─ DRAWING Phase ─────────────────────────────────────────┐
  │                                                          │
  │  1. Server sets phase = 'drawing', currentPlayerIndex=P  │
  │  2. Server broadcasts state_sync to all clients          │
  │  3. Client[P] sees "Your turn! Draw a card" prompt       │
  │  4. Client[P] clicks "Draw Card"                         │
  │  5. Client sends: { type: 'command', action: 'drawCard' }│
  │                                                          │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             ▼
  ┌─ GUESSING Phase ────────────────────────────────────────┐
  │                                                          │
  │  6. Server pops card from deck → currentCard             │
  │  7. Server sets phase = 'guessing'                       │
  │  8. Server broadcasts: { currentCard, phase: 'guessing' }│
  │  9. ALL clients receive card details (artist, title,     │
  │     album art, audio preview)                            │
  │  10. Each client independently computes their local      │
  │      "year slider" UI                                   │
  │  11. Players select their year guess (parallel, async)   │
  │                                                          │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             ▼
  ┌─ Scoring (per-player on submit) ────────────────────────┐
  │                                                          │
  │  12. Player submits guess:                               │
  │      { type: 'command', action: 'submitGuess',           │
  │        payload: { playerId, guessedYear } }              │
  │  13. Server validates:                                   │
  │      - Player is in the match                            │
  │      - currentCard exists                                │
  │      - Player hasn't already submitted this turn         │
  │  14. Server calculates score:                            │
  │      yearDiff = |guessedYear - actualYear|               │
  │      - ≤1 year  → 5 points                              │
  │      - ≤5 years → 3 points                              │
  │      - >5 years → 1 point                               │
  │  15. Server updates player's score & hand                │
  │  16. Server broadcasts partial update to all             │
  │                                                          │
  └──────────────────────────┬───────────────────────────────┘
                             │
                             ▼
  ┌─ Round Advancement ─────────────────────────────────────┐
  │                                                          │
  │  17. After last player submits:                          │
  │      - If round < totalRounds:                           │
  │        currentRound++, currentPlayerIndex=0              │
  │        phase → 'drawing'                                 │
  │      - If round = totalRounds:                           │
  │        phase → 'finished'                                │
  │  18. Server broadcasts final round state                 │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
```

### 3.3 Turn Timing & Timeouts

```
Timeout Strategy:
┌─────────────────────────────────────────────────────┐
│                                                     │
│  DRAWING Phase:                                     │
│    - No strict timeout (player-driven)              │
│    - Optional: 60s idle kick if player disconnects  │
│                                                     │
│  GUESSING Phase:                                    │
│    - 30-second countdown (configurable)             │
│    - Server enforces: if timer expires,             │
│      unsubmitted players get 1-point default        │
│    - Broadcast timer_sync every second              │
│                                                     │
│  SCORING Phase:                                     │
│    - 10-second display window (auto-advance)        │
│    - Host can manually advance early                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

```typescript
// Timer implementation in MatchRoom
private startGuessingTimer(): void {
  this.guessingDeadline = Date.now() + 30_000;  // 30 seconds

  const tick = () => {
    if (this.state?.phase !== 'guessing') return;

    const remaining = Math.max(0, this.guessingDeadline - Date.now());
    this.broadcast({ type: 'timer_sync', payload: { remainingMs: remaining } });

    if (remaining <= 0) {
      this.forceResolveGuesses();  // Auto-score unsubmitted players
      return;
    }

    setTimeout(tick, 1000);
  };

  tick();
}

private forceResolveGuesses(): void {
  // Players who didn't submit get minimum score (1 point)
  // Advance to scoring phase
}
```

---

## 4. Real-Time WebSocket Communication

### 4.1 Protocol Design

All messages use a standardized envelope format:

```typescript
// ── Message Envelope ──
interface MessageEnvelope {
  type: MessageType;
  payload: unknown;
  version?: number;       // State version for ordering
  timestamp: number;      // Sender's Date.now()
  clientId?: string;      // Originating client ID
}

type MessageType =
  // Client → Server (Commands)
  | 'command'
  // Server → Client (Events)
  | 'state_sync'          // Full state replacement
  | 'state_delta'         // Partial state patch
  | 'timer_sync'          // Countdown timer update
  | 'player_joined'       // New player notification
  | 'player_left'         // Player disconnect notification
  | 'error'               // Error notification
  | 'ack';                // Command acknowledgment

// ── Command Envelope (Client → Server) ──
interface CommandEnvelope {
  type: 'command';
  action: CommandAction;
  payload: unknown;
  commandId: string;       // UUID for deduplication
  clientId: string;
  lobbyId: string;
}

type CommandAction =
  | 'createLobby'
  | 'joinLobby'
  | 'startMatch'
  | 'drawCard'
  | 'submitGuess'
  | 'endMatch';

// ── Response Envelope (Server → Client) ──
interface ResponseEnvelope {
  type: 'state_sync' | 'state_delta' | 'ack' | 'error';
  payload: unknown;
  version: number;
  commandId?: string;      // Correlates to originating command
}
```

### 4.2 Connection Architecture

```
Connection Lifecycle:
━━━━━━━━━━━━━━━━━━━━

  Client                          MatchRoom DO
    │                                  │
    │  1. HTTP Connect Request         │
    │  ─────────────────────────────►  │
    │     ?playerId=xxx&lobbyId=yyy    │
    │                                  │
    │  2. DO accepts, stores client    │
    │     in Map<playerId, {ws, meta}> │
    │                                  │
    │  3. Send current state_sync      │
    │  ◄─────────────────────────────  │
    │     { type: 'state_sync',        │
    │       payload: fullState,        │
    │       version: N }               │
    │                                  │
    │  ══════ Active Session ══════    │
    │                                  │
    │  4a. Client sends command        │
    │  ─────────────────────────────►  │
    │                                  │
    │  4b. Server processes, mutates   │
    │      state, broadcasts delta     │
    │  ◄─────────────────────────────  │
    │                                  │
    │  5. Client sends heartbeat       │
    │  ─────────────────────────────►  │
    │     (every 15s)                  │
    │                                  │
    │  ════ Disconnection ══════════   │
    │                                  │
    │  6. WebSocket closes             │
    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ►  │
    │                                  │
    │  7. DO marks player offline      │
    │     Starts reconnection timer    │
    │     (60s grace period)           │
    │                                  │
    │  8. If reconnects:               │
    │     Resend full state_sync       │
    │  ◄─────────────────────────────  │
    │                                  │
    │  9. If timeout:                  │
    │     Remove from match            │
    │     Broadcast player_left        │
    │                                  │
```

### 4.3 WebSocket Hibernation API

The server uses Cloudflare's **WebSocket Hibernation API** to minimize billing while maintaining persistent connections:

```typescript
// ── Durable Object with Hibernation ──
export class MatchRoom {
  private state: DurableObjectState;
  private clients: Map<string, ClientInfo>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.clients = new Map();

    // Restore state from storage on wake
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get<MatchState>('gameState');
      if (saved) this.gameState = saved;
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);  // Hibernation-compatible!
      // ... register client
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('Not a WebSocket', { status: 426 });
  }

  // Called by CF runtime when a WebSocket message arrives
  // Even if DO was hibernated, this wakes it up
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const envelope = JSON.parse(message as string);
    await this.handleMessage(envelope);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.handleDisconnect(ws);
  }

  // Optional: scheduled alarm for periodic tasks
  async alarm(): Promise<void> {
    this.checkTimeouts();
    this.persistState();
  }
}
```

### 4.4 Broadcast Patterns

```
Broadcast Strategy:
━━━━━━━━━━━━━━━━━━

┌──────────────────────────────────────────────────────────┐
│  Pattern 1: Full State Sync (reconnection, join)         │
│                                                          │
│  broadcast({                                            │
│    type: 'state_sync',                                  │
│    payload: this.gameState,  // Complete state           │
│    version: this.version                                │
│  });                                                    │
│                                                          │
│  → Sent to: ALL connected clients                       │
│  → When: player joins, reconnects, or full refresh       │
├──────────────────────────────────────────────────────────┤
│  Pattern 2: Delta Patch (normal gameplay)                │
│                                                          │
│  broadcast({                                            │
│    type: 'state_delta',                                 │
│    payload: {                                           │
│      phase: 'guessing',                                 │
│      currentCard: { id: 42, title: "Bohemian..." }     │
│    },                                                   │
│    version: this.version                                │
│  });                                                    │
│                                                          │
│  → Sent to: ALL connected clients                       │
│  → When: phase changes, card drawn, score updated       │
├──────────────────────────────────────────────────────────┤
│  Pattern 3: Targeted Message (error, ack)                │
│                                                          │
│  ws.send(JSON.stringify({                               │
│    type: 'error',                                       │
│    payload: { code: 'DECK_EMPTY', message: '...' }     │
│  }));                                                   │
│                                                          │
│  → Sent to: SPECIFIC client only                        │
│  → When: command validation fails, permission error     │
├──────────────────────────────────────────────────────────┤
│  Pattern 4: Timer Broadcast (guessing phase)             │
│                                                          │
│  broadcast({                                            │
│    type: 'timer_sync',                                  │
│    payload: { remainingMs: 25000 }                      │
│  });                                                    │
│                                                          │
│  → Sent to: ALL connected clients                       │
│  → When: every 1s during guessing phase                 │
└──────────────────────────────────────────────────────────┘
```

```typescript
// Broadcast implementation
private broadcast(message: MessageEnvelope, excludePlayerId?: string): void {
  const data = JSON.stringify(message);
  this.clients.forEach((client, playerId) => {
    if (playerId === excludePlayerId) return;
    try {
      client.ws.send(data);
    } catch {
      // Dead connection — clean up
      this.clients.delete(playerId);
    }
  });
}
```

---

## 5. Multiplayer Conflict Resolution

### 5.1 Architecture: Optimistic Local + Server Authority

SongGuesser uses a **single-authority optimistic** model — similar to CRDTs in spirit but simpler, since game state is strictly sequential:

```
Conflict Resolution Model:
━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌─────────────┐         ┌─────────────────┐
  │   Client     │         │  MatchRoom DO   │
  │  (Optimistic)│         │  (Authoritative) │
  └──────┬──────┘         └────────┬────────┘
         │                         │
         │  1. Player clicks       │
         │     "Draw Card"         │
         │                         │
         │  2. Client applies      │
         │     LOCAL OPTIMISTIC    │
         │     state change:       │
         │     phase → 'guessing'  │
         │     (UI updates         │
         │     immediately)        │
         │                         │
         │  3. Send command ──────►│
         │     { drawCard }        │
         │                         │
         │              4. Server validates:
         │                 - Is it this player's turn?
         │                 - Is phase 'drawing'?
         │                 - Deck not empty?
         │                         │
         │         ┌───────┴───────┐
         │         │               │
         │    ┌────▼────┐    ┌────▼────┐
         │    │ ACCEPTED │    │ REJECTED│
         │    └────┬────┘    └────┬────┘
         │         │              │
         │  5a. Server      5b. Server sends
         │  broadcasts      error + rollback
         │  state_delta     client to previous
         │  to ALL          confirmed state
         │         │              │
         │  ◄──────┘              │
         │  Client merges          │
         │  server delta           │
         │  (overrides local)      │
         │                         │
```

### 5.2 Conflict Scenarios & Resolution

```
┌────────────────────────────────────────────────────────────────────┐
│ SCENARIO 1: Two players submit guesses simultaneously             │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Player A and Player B both click "Submit" at the same time.      │
│                                                                    │
│  Resolution:                                                       │
│  - Both commands arrive at server                                  │
│  - Server processes them SEQUENTIALLY (single-threaded DO)        │
│  - First command accepted, second also accepted (both valid)       │
│  - Each player's score is updated independently                    │
│  - Final state broadcast reflects both submissions                 │
│                                                                    │
│  No conflict — parallel submissions are expected and handled.      │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ SCENARIO 2: Player tries to draw when it's not their turn         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Player B (not active) clicks "Draw Card".                        │
│                                                                    │
│  Resolution:                                                       │
│  - Command arrives: { action: 'drawCard', playerId: 'B' }        │
│  - Server checks: currentPlayerIndex → Player A's turn             │
│  - Server rejects: { accepted: false, errorCode: 'NOT_YOUR_TURN'}│
│  - Client receives error, shows toast notification                 │
│  - No state change occurs                                         │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ SCENARIO 3: Client has stale state, sends invalid guess            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Client thinks phase is 'guessing' but server has moved to        │
│  'scoring' (due to network delay).                                │
│                                                                    │
│  Resolution:                                                       │
│  - Command arrives: { action: 'submitGuess', guessedYear: 1985 } │
│  - Server checks: currentCard is null (scoring phase)             │
│  - Server rejects: { accepted: false, errorCode: 'NO_ACTIVE_CARD'}│
│  - Server also sends full state_sync to resync client             │
│  - Client replaces local state with server state                   │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ SCENARIO 4: Duplicate command (network retry)                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Client sends submitGuess, network timeout, retries automatically.│
│                                                                    │
│  Resolution:                                                       │
│  - Server receives first command, processes it                    │
│  - Server receives duplicate (same commandId)                     │
│  - Server detects: player already submitted this turn              │
│  - Server rejects duplicate, sends ack with current version        │
│  - Client discards stale command from pendingCommands              │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.3 Version-Based Ordering

```typescript
// ── Version tracking for ordering guarantees ──
class VersionedState {
  private version: number = 0;
  private state: MatchState | null = null;

  // Every mutation increments version
  mutate(updater: (state: MatchState) => void): ResponseEnvelope {
    updater(this.state);
    this.version++;
    this.state.version = this.version;
    return {
      type: 'state_delta',
      payload: this.computeDelta(),
      version: this.version,
    };
  }

  // Client can reject stale updates
  applyUpdate(update: ResponseEnvelope): boolean {
    if (update.version < this.serverVersion) {
      // Stale — ignore
      return false;
    }
    this.serverVersion = update.version;
    this.merge(update.payload);
    return true;
  }
}
```

### 5.4 Rollback Strategy

```
When server REJECTS a client command:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Client State Before:          Client State After Rollback:
  ┌───────────────────┐        ┌───────────────────┐
  │ phase: 'guessing' │   ──►  │ phase: 'drawing'  │  (server's truth)
  │ currentCard: {...} │        │ currentCard: null  │
  │ localOptimistic:  │        │ localOptimistic: {}│  (cleared)
  │   { phase: ... }  │        │                    │
  └───────────────────┘        └───────────────────┘

  Rollback triggers:
  1. Server sends error response to command
  2. Server sends state_sync with different version
  3. Client detects version gap > 1 (missed updates)
```

---

## 6. Durable Object Lifecycle & Failover Strategy

### 6.1 DO Lifecycle States

```
Durable Object Lifecycle:
━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌──────────────┐
  │  UNINITIALIZED│  No match room exists yet
  └──────┬───────┘
         │ First client creates lobby
         │ (HTTP request → DO instantiation)
         ▼
  ┌──────────────┐
  │   ACTIVE      │  Normal operation
  │  (Hibernation │  - WebSocket connections alive
  │   capable)    │  - Processing commands
  │               │  - Periodic KV snapshots
  └──────┬───────┘
         │
         │ All clients disconnect
         │ No activity for N minutes
         ▼
  ┌──────────────┐
  │  HIBERNATED   │  DO goes idle, CF hibernates it
  │  (In storage) │  - State persisted to DO storage
  │               │  - WebSocket connections preserved
  │               │  - No CPU/billing costs
  └──────┬───────┘
         │
         │ Client reconnects (WebSocket wakes DO)
         │ OR scheduled alarm fires
         ▼
  ┌──────────────┐
  │   ACTIVE      │  DO wakes up
  │  (Restored)   │  - Loads state from storage
  │               │  - Resumes operations
  │               │  - Re-syncs with clients
  └──────┬───────┘
         │
         │ All players leave
         │ OR match finished + grace period
         │ OR storage TTL expires
         ▼
  ┌──────────────┐
  │   DESTROYED   │  DO is garbage collected
  │  (Cleaned up) │  - State lost (unless in KV)
  │               │  - Room ID becomes available
  └──────────────┘
```

### 6.2 Failover Scenarios

```
┌──────────────────────────────────────────────────────────────────┐
│ FAILOVER 1: Player disconnects mid-turn                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Active player (turn holder) loses connection.                  │
│                                                                  │
│  Strategy:                                                       │
│  ┌─ T+0s ─────── DO detects disconnect                          │
│  │  - Mark player as "disconnected" in state                    │
│  │  - Start 60-second reconnection timer                        │
│  │  - Do NOT advance turn yet                                    │
│  │                                                               │
│  ├─ T+30s ────── Notify remaining players:                      │
│  │  "Player X disconnected. Waiting for reconnection..."        │
│  │                                                               │
│  ├─ T+60s ────── Reconnection timeout:                          │
│  │  Option A: Skip disconnected player's turn                   │
│  │            - Advance to next player                           │
│  │            - Disconnected player gets 0 points this turn      │
│  │  Option B: Pause match (host can resume or end)              │
│  │            - Show "Match Paused" to all                       │
│  │                                                               │
│  ├─ T+∞ ──────── If player reconnects:                          │
│  │  - Send full state_sync                                      │
│  │  - Resume from current position                              │
│  │  - Player's missed turns = 0 points                          │
│  │                                                               │
│  └───────────────────────────────────────────────────────────────│
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ FAILOVER 2: Durable Object crash/restart                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  CF infrastructure restarts the DO unexpectedly.                 │
│                                                                  │
│  Strategy:                                                       │
│  ┌─ On restart ──────────────────────────────────────────────┐  │
│  │  1. Constructor runs: load state from DO storage          │  │
│  │  2. If DO storage has state → resume match                │  │
│  │  3. If DO storage empty → check KV snapshots              │  │
│  │  4. If KV has snapshot → restore from KV                  │  │
│  │  5. If nothing → match is lost, notify clients            │  │
│  │                                                           │  │
│  │  WebSocket connections auto-reconnect to new DO instance  │  │
│  │  Clients receive state_sync on reconnect                   │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│ FAILOVER 3: All clients disconnect simultaneously                │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Network partition, or all players close browser.               │
│                                                                  │
│  Strategy:                                                       │
│  ┌─ Grace Period: 5 minutes ─────────────────────────────────┐  │
│  │  - DO stays alive (hibernation-aware)                      │  │
│  │  - State preserved in DO storage                           │  │
│  │  - Any client can rejoin and resume                        │  │
│  │                                                           │  │
│  ├─ After 5 minutes:                                         │  │
│  │  - DO hibernates (saves to storage)                        │  │
│  │  - State persisted in KV snapshot as backup                │  │
│  │                                                           │  │
│  ├─ After 2 hours:                                           │  │
│  │  - KV snapshot expires                                     │  │
│  │  - DO storage still valid (until explicit cleanup)         │  │
│  │                                                           │  │
│  └─ Match can be resumed as long as DO or KV snapshot exists  │  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3 State Persistence Strategy

```typescript
// ── Multi-layer persistence ──
class PersistenceManager {
  // Layer 1: DO In-Memory (fastest)
  // → Primary game state, mutated on every command
  // → Zero latency, lost on DO destruction

  // Layer 2: DO Storage (fast, durable)
  // → Written on every state mutation (synchronous)
  // → Survives DO hibernation and restarts
  // → Limited to ~128KB per key

  async persistToStorage(state: MatchState): Promise<void> {
    await this.env.ORAGE.put('gameState', state);
    await this.env.STORAGE.put('gameVersion', this.version);
  }

  // Layer 3: Cloudflare KV (eventually consistent, larger)
  // → Written async after mutations (non-blocking)
  // → Survives DO destruction
  // → 60s eventual consistency
  // → Used for cross-region recovery

  async persistToKV(state: MatchState): Promise<void> {
    // Fire and forget — don't block game logic
    this.env.KV.put(
      `match:${state.lobbyId}:snapshot`,
      JSON.stringify({ state, version: this.version, timestamp: Date.now() }),
      { expirationTtl: 7200 }  // 2 hours
    ).catch(() => {});  // Intentionally unawaited
  }
}
```

### 6.4 Reconnection Protocol

```
Client Reconnection Flow:
━━━━━━━━━━━━━━━━━━━━━━━━━

  Client                              Server (DO)
    │                                     │
    │  WebSocket closed                   │
    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ►  │
    │                                     │  Mark player disconnected
    │                                     │  Start grace timer
    │                                     │
    │  Client detects close               │
    │  (code: 1006 = abnormal)            │
    │                                     │
    │  Exponential backoff retry:         │
    │  ┌─────────────────────┐            │
    │  │ Attempt 1: 1s wait  │            │
    │  │ Attempt 2: 2s wait  │            │
    │  │ Attempt 3: 4s wait  │            │
    │  │ Attempt 4: 8s wait  │            │
    │  │ Attempt 5: 16s wait │            │
    │  │ Max: 5 attempts     │            │
    │  └─────────────────────┘            │
    │                                     │
    │  New WebSocket connection           │
    │  ?playerId=xxx&lobbyId=yyy          │
    │  ──────────────────────────────── ► │
    │                                     │  Recognizes existing player
    │                                     │  Clears disconnect timer
    │                                     │
    │  ◄────────────────────────────────  │
    │  { type: 'state_sync',             │
    │    payload: FULL current state,     │
    │    version: N }                     │
    │                                     │
    │  Client replaces local state        │
    │  Resumes UI from server state       │
    │                                     │
```

---

## 7. Data Flow Diagrams

### 7.1 Complete Game Flow (Happy Path)

```
4-Player, 3-Round Game:
━━━━━━━━━━━━━━━━━━━━━━

  Round 1                              Round 2
  ┌────────────────────┐              ┌────────────────────┐
  │ P1 draws card      │              │ P1 draws card      │
  │ → "Hotel California"│             │ → "Stairway to..."  │
  │                    │              │                    │
  │ P1 guesses: 1976   │              │ P1 guesses: 1971   │
  │ P2 guesses: 1977   │              │ P2 guesses: 1972   │
  │ P3 guesses: 1975   │              │ P3 guesses: 1970   │
  │ P4 guesses: 1978   │              │ P4 guesses: 1969   │
  │                    │              │                    │
  │ Scores: +5,+3,+5,+1│              │ Scores: +3,+1,+5,+5│
  │                    │              │                    │
  │ P2 draws card      │              │ P2 draws card      │
  │ → "Imagine"        │              │ → "Yesterday"      │
  │ ...                │              │ ...                │
  └────────────────────┘              └────────────────────┘
                                                    │
                                              Round 3
                                      ┌────────────────────┐
                                      │ ...final turns...  │
                                      │                    │
                                      │ phase → 'finished' │
                                      │                    │
                                      │ Final Scores:      │
                                      │ P1: 42 pts 🥇      │
                                      │ P3: 38 pts 🥈      │
                                      │ P2: 35 pts 🥉      │
                                      │ P4: 29 pts         │
                                      └────────────────────┘
```

### 7.2 Message Sequence Diagram

```
   Player A         Player B          MatchRoom DO         KV Store
      │                 │                   │                   │
      │  createLobby    │                   │                   │
      │────────────────►│                   │                   │
      │                 │  createLobby      │                   │
      │                 │──────────────────►│                   │
      │                 │                   │ Initialize state  │
      │                 │                   │──── async ──────►│
      │                 │                   │                   │
      │  state_sync     │  state_sync       │ Snapshot save     │
      │◄────────────────│◄──────────────────│                   │
      │                 │                   │                   │
      │  joinLobby      │                   │                   │
      │  (from B's link)│                   │                   │
      │                 │                   │◄──────────────────│
      │                 │                   │                   │
      │  player_joined  │                   │ Add player B      │
      │◄────────────────│◄──────────────────│                   │
      │                 │                   │                   │
      │  startMatch     │                   │                   │
      │────────────────►│                   │                   │
      │  (host only)    │                   │                   │
      │                 │                   │                   │
      │                 │                   │ Shuffle deck      │
      │                 │                   │ Set phase=drawing │
      │                 │                   │ Async persist ───►│
      │                 │                   │                   │
      │  state_delta    │  state_delta      │                   │
      │◄────────────────│◄──────────────────│                   │
      │                 │                   │                   │
      │  drawCard       │                   │                   │
      │────────────────►│                   │                   │
      │                 │                   │ Pop card from deck│
      │                 │                   │ phase = guessing  │
      │                 │                   │                   │
      │  state_delta    │  state_delta      │                   │
      │  {currentCard}  │  {currentCard}    │                   │
      │◄────────────────│◄──────────────────│                   │
      │                 │                   │                   │
      │  submitGuess    │  submitGuess      │                   │
      │  (1976)         │  (1977)           │                   │
      │────────────────►│◄──────────────────│                   │
      │                 │                   │                   │
      │                 │                   │ Calculate scores  │
      │                 │                   │ Advance turn      │
      │                 │                   │                   │
      │  state_delta    │  state_delta      │                   │
      │  {scores+turn}  │  {scores+turn}    │                   │
      │◄────────────────│◄──────────────────│                   │
```

---

## 8. Edge Cases & Failure Modes

### 8.1 Edge Case Matrix

| Scenario | Detection | Resolution | Client UX |
|----------|-----------|------------|-----------|
| **Player disconnects during turn** | WebSocket close event | 60s grace period, then skip turn | Toast: "Player X disconnected. Waiting..." |
| **All players disconnect** | Client count = 0 | 5min grace → hibernation → KV snapshot | Auto-rejoin on reconnect |
| **Deck exhausted** | `deck.pop()` returns undefined | End match early, show final scores | "All songs played! Final results..." |
| **Duplicate submission** | Same playerId + same turn | Reject second, ack first | Silent (no error shown) |
| **Stale version update** | `update.version < currentVersion` | Discard stale, request full sync | Brief loading spinner |
| **DO eviction** | CF infrastructure event | Restore from DO storage + KV | Brief reconnecting overlay |
| **Concurrent lobby modifications** | Two hosts try to start | Only first command accepted | "Match already started" |
| **Invalid year guess** | Year < 1900 or > current + 1 | Reject with validation error | Inline error on slider |
| **Network partition (split-brain)** | Version desync detected | Force full state_sync to all | Automatic, no user action |
| **Score overflow** | Theoretical only | Number.MAX_SAFE_INTEGER check | "Score limit reached" |

### 8.2 Error Handling Protocol

```typescript
// ── Structured error responses ──
interface ErrorResponse {
  type: 'error';
  payload: {
    code: ErrorCode;
    message: string;         // Human-readable
    details?: unknown;       // Debug info (dev only)
    suggestedAction?: string;
  };
  version: number;           // Current server version
  commandId?: string;        // Which command failed
}

type ErrorCode =
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE'
  | 'DECK_EMPTY'
  | 'PLAYER_NOT_FOUND'
  | 'DUPLICATE_SUBMISSION'
  | 'LOBBY_FULL'
  | 'LOBBY_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'MATCH_IN_PROGRESS'
  | 'INVALID_PAYLOAD'
  | 'RATE_LIMITED';

// Client-side error display strategy
function handleError(error: ErrorResponse): void {
  switch (error.payload.code) {
    case 'NOT_YOUR_TURN':
      showToast('Wait for your turn!', 'info');
      break;
    case 'DECK_EMPTY':
      showToast('No more songs!', 'warning');
      break;
    case 'INVALID_PHASE':
      // Silently re-sync — likely a timing issue
      requestFullSync();
      break;
    default:
      showToast(error.payload.message, 'error');
  }
}
```

### 8.3 Rate Limiting

```
Per-Client Command Rate Limits:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  createLobby:   1 per 10 seconds
  joinLobby:     1 per 5 seconds
  startMatch:    1 per 5 seconds
  drawCard:      1 per 2 seconds
  submitGuess:   1 per 1 second
  endMatch:      1 per 5 seconds

  Implementation: Token bucket in DO memory
  On violation: { errorCode: 'RATE_LIMITED', retryAfterMs: N }
```

---

## Summary

| Concern | Approach | Key Technology |
|---------|----------|---------------|
| **State Authority** | Single server (MatchRoom DO) | Durable Objects |
| **Client Sync** | Optimistic local + server delta broadcast | WebSocket Hibernation |
| **Conflict Resolution** | Command validation + version ordering | Monotonic version counter |
| **Persistence** | 3-layer: Memory → DO Storage → KV | Cloudflare KV + DO Storage |
| **Failover** | Grace periods + snapshot recovery | Hibernation API + KV snapshots |
| **Turn Management** | State machine in DO | Sequential command processing |
| **Timer Enforcement** | Server-side countdown | DO alarm + setTimeout |

---

*Document version: 1.0*  
*Last updated: 2026-03-20*  
*Architecture: SongGuesser v2 — Cloudflare Workers + Durable Objects*
