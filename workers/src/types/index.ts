// ─── Envelopes ───

export interface CommandEnvelope {
  commandType: CommandType;
  actorId: string;
  lobbyId: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  clientTimestamp: number;
}

export interface ResponseEnvelope {
  accepted: boolean;
  newVersion: number;
  stateDelta: Partial<MatchState>;
  errorCode?: string;
}

export type CommandType =
  | 'start_match'
  | 'draw_card'
  | 'submit_guess'
  | 'place_card'
  | 'resolve_turn'
  | 'buzz'
  | 'buzzer_answer'
  | 'snippet_guess'
  | 'vote_reveal'
  | 'end_match';

// ─── Lobby ───

export interface Lobby {
  id: string;
  code: string;
  hostId: string;
  players: PlayerProfile[];
  state: LobbyState;
  settings: LobbySettings;
  category: string | null;
  createdAt: number;
}

export type LobbyState = 'waiting' | 'starting' | 'in_game' | 'finished';

export interface LobbySettings {
  maxPlayers: number;
  totalRounds: number;
  maxPoints: number;
  timelineOnlyScoring: boolean;
  yearRange: { min: number; max: number };
  /** Which game is played — see GameMode. */
  gameMode: GameMode;
  /** Timeline mode: how artist/title answers are given — typed (auto-graded) or spoken aloud (graded by the other players' votes). */
  guessMode: GuessMode;
  /** Timeline mode: answer time limit in seconds for the active player; 0 = no limit. */
  answerTimeSec: number;
}

/**
 * - timeline: turn-based — the active player names artist/title and places the year on their timeline
 * - buzzer:   everyone listens; first to buzz names artist AND title for 1 point, a miss hands the buzzer to the others
 * - snippet:  everyone guesses from ever longer snippets (0.1s → 15s); the shorter the snippet, the more points
 */
export type GameMode = 'timeline' | 'buzzer' | 'snippet';

export type GuessMode = 'type' | 'speak';

/** The subset of lobby settings the match state machine needs. */
export interface MatchSettings {
  gameMode: GameMode;
  guessMode: GuessMode;
  answerTimeSec: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  avatar: string;
  joinedAt: number;
}

// ─── Match / Game State ───

export interface MatchState {
  lobbyId: string;
  version: number;
  phase: MatchPhase;
  players: MatchPlayer[];
  currentPlayerIndex: number;
  currentRound: number;
  totalRounds: number;
  currentCard: Card | null;
  deck: Card[];
  turnOrder: string[];
  startedAt: number;
  settings: MatchSettings;
  /** Epoch ms when the active player's answer time ends; null = no limit. */
  turnDeadline?: number | null;
  /** Set while phase is 'buzzer' (buzzer mode): who may buzz and until when. */
  buzzer?: BuzzerState | null;
  /** Set while phase is 'snippet' (snippet mode): the current stage and guesses. */
  snippet?: SnippetState | null;
  /** Set while phase is 'reveal_vote' (speak mode): the running vote. */
  voting?: VoteState | null;
  /** Set while phase is 'round_result': the reveal everyone should see. */
  lastResult?: RoundReveal | null;
  /** cardKeys of every card dealt so far, so a deck refill never repeats one. */
  drawnKeys?: string[];
}

/** Buzzer mode: one song, everyone may buzz until someone names it. */
export interface BuzzerState {
  /** Epoch ms until which players may buzz; null while someone is answering. */
  openUntil: number | null;
  /** Buzz time left, frozen while the buzz winner answers. */
  remainingMs: number;
  winnerId: string | null;
  winnerName: string | null;
  /** Epoch ms until which the buzz winner may answer. */
  answerDeadline: number | null;
  /** Players who already missed this song and may not buzz again. */
  lockedOut: string[];
  /** Every answer given on this song, in order. */
  attempts: BuzzAttempt[];
}

export interface BuzzAttempt {
  playerId: string;
  playerName: string;
  artist: string;
  title: string;
  artistCorrect: boolean;
  titleCorrect: boolean;
}

/** Snippet mode: everyone guesses from ever longer snippets of the song. */
export interface SnippetState {
  /** Index into SNIPPET_STAGES_SEC. */
  stage: number;
  /** Snippet length per stage, in seconds. */
  stages: number[];
  /** Epoch ms when the current stage closes even if not everyone guessed. */
  deadline: number;
  /** Players who already guessed in the current stage (or passed). */
  guessed: string[];
  /** Players who named artist AND title, with the stage and points. */
  solved: Record<string, { stage: number; points: number }>;
  /** Per player: what their latest guess got right, so they can build on it. */
  feedback: Record<string, { artist: string; title: string; artistCorrect: boolean; titleCorrect: boolean }>;
}

/** Speak mode: the other players decide whether artist/title were said correctly. */
export interface VoteState {
  /** Epoch ms when voting closes even if not everyone voted. */
  deadline: number;
  /** Player ids eligible to vote (everyone except the guesser). */
  voterIds: string[];
  votes: Record<string, { artistOk: boolean; titleOk: boolean }>;
}

/** Result of a guess, revealed to all players until the guesser continues. */
export interface RoundReveal {
  playerId: string;
  playerName: string;
  card: Card;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearExact: boolean;
  timelineCorrect: boolean;
  yearDiff: number;
  points: number;
  /** True when the guess was auto-submitted because the answer time ran out. */
  timedOut?: boolean;
  /** Which game produced this reveal; absent = timeline. */
  mode?: GameMode;
  /** Buzzer mode: who named the song (if anyone) and every attempt. */
  buzz?: { winnerId: string | null; winnerName: string | null; attempts: BuzzAttempt[] } | null;
  /** Snippet mode: how every player did on this song. */
  snippetResults?: SnippetPlayerResult[] | null;
}

export interface SnippetPlayerResult {
  playerId: string;
  playerName: string;
  /** Snippet length (seconds) at which they named the song; null = never. */
  solvedAtSec: number | null;
  points: number;
  lastArtist: string;
  lastTitle: string;
}

/** Transient playback state, controlled by the active player. */
export interface PlaybackState {
  playing: boolean;
  positionSec: number;
  updatedAt: number; // server epoch ms when this snapshot was taken
}

/**
 * Transient "what the active player is typing" snapshot, broadcast so
 * spectators can follow along. Not persisted with match state.
 */
export interface LiveInput {
  playerId: string;
  artist: string;
  title: string;
  year: number;
}

export type MatchPhase =
  | 'waiting_to_start'
  | 'drawing'
  | 'guessing'
  | 'evaluating'
  | 'buzzer'
  | 'snippet'
  | 'reveal_vote'
  | 'round_result'
  | 'finished';

export interface MatchPlayer {
  id: string;
  name: string;
  avatar: string;
  score: number;
  hand: Card[];
  placedCards: PlacedCard[];
}

export interface Card {
  id: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  emoji: string;
  /** Resolved at draw time, not at deck-build time — see preview-service. */
  previewUrl?: string;
  coverUrl?: string;
  gradient: string;
  /**
   * Search terms used to resolve the preview when the card is drawn.
   * Set where `${artist} ${title}` is a poor query (e.g. history tracks
   * whose artist field lists several artists). Defaults to artist + title.
   */
  previewQuery?: string;
}

export interface PlacedCard {
  card: Card;
  placedYear: number;
  isCorrect: boolean;
}

// ─── Scoring ───

export interface GuessSubmission {
  playerId: string;
  cardId: string;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
}

export interface ScoreResult {
  points: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearDiff: number;
  yearExact: boolean;
  timelineCorrect: boolean;
  breakdown: ScoreBreakdown;
}

export interface ScoreBreakdown {
  artistPoints: number;
  titlePoints: number;
  yearPoints: number;
  timelinePoints: number;
}

// ─── Category ───

export interface CategoryResult {
  name: string;
  eligible: boolean;
  songCount: number;
  reason?: string;
}

export interface CategoryEligibility {
  category: string;
  eligible: boolean;
  totalSongs: number;
  minSongsPerPlayer: number;
}

// ─── API DTOs ───

export interface CreateLobbyRequest {
  hostName: string;
  hostAvatar: string;
  settings: Partial<LobbySettings>;
  category?: string;
}

export interface CreateLobbyResponse {
  lobbyId: string;
  code: string;
  token: string;
  hostId: string;
}

export interface JoinLobbyRequest {
  playerName: string;
  playerAvatar: string;
}

export interface JoinLobbyResponse {
  playerId: string;
  token: string;
}

export interface WebSocketMessage {
  type: string;
  payload: unknown;
  timestamp: number;
}

// ─── Session ───

export interface PlayerSession {
  playerId: string;
  lobbyId: string;
  name: string;
  createdAt: number;
}