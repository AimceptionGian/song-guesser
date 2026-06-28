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
}

export type MatchPhase =
  | 'waiting_to_start'
  | 'drawing'
  | 'guessing'
  | 'evaluating'
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