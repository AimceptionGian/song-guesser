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
  /** How artist/title answers are given: typed (auto-graded) or spoken aloud (graded by the other players' votes). */
  guessMode: GuessMode;
  /** Answer time limit in seconds for the active player; 0 = no limit. */
  answerTimeSec: number;
  /** After the active player's time runs out, others may buzz to steal 1 point. Needs answerTimeSec > 0 and guessMode 'type'. */
  buzzerEnabled: boolean;
}

export type GuessMode = 'type' | 'speak';

/** The subset of lobby settings the match state machine needs. */
export interface MatchSettings {
  guessMode: GuessMode;
  answerTimeSec: number;
  buzzerEnabled: boolean;
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
  /** Set while phase is 'buzzer': who may steal and until when. */
  buzzer?: BuzzerState | null;
  /** Set while phase is 'reveal_vote' (speak mode): the running vote. */
  voting?: VoteState | null;
  /** Set while phase is 'round_result': the reveal everyone should see. */
  lastResult?: RoundReveal | null;
}

/** Buzzer window after the active player's time ran out. */
export interface BuzzerState {
  /** Epoch ms until which players may buzz. */
  openUntil: number;
  winnerId: string | null;
  winnerName: string | null;
  /** Epoch ms until which the buzzer winner may answer. */
  answerDeadline: number | null;
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
  /** Set when a buzzer player stole a point (or tried to). */
  steal?: StealResult | null;
}

/** Outcome of a buzzer steal attempt. */
export interface StealResult {
  playerId: string;
  playerName: string;
  guess: string;
  /** Which field the steal matched; null = missed. */
  field: 'artist' | 'title' | null;
  points: number;
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
  previewUrl?: string;
  coverUrl?: string;
  gradient: string;
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