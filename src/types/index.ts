export interface Song {
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

export interface Player {
  id: string;
  name: string;
  score: number;
  avatar: string;
  hand: Song[];
  placedCards: PlacedCard[];
}

export interface PlacedCard {
  song: Song;
  placedYear: number;
  isCorrect: boolean;
}

export interface GameState {
  gameCode: string;
  players: Player[];
  currentPlayerIndex: number;
  currentCard: Song | null;
  currentRound: number;
  totalRounds: number;
  phase: GamePhase;
  timelineRange: { min: number; max: number };
  /** What the active player is currently typing (spectator view). */
  liveInput?: LiveInput | null;
  /** Audio playback state controlled by the active player. */
  playback?: PlaybackState | null;
  /** Set while phase is 'round_result': the reveal everyone should see. */
  lastResult?: RoundReveal | null;
  /** Match rules chosen in the lobby. */
  settings?: MatchSettings;
  /** Epoch ms (server clock) when the active player's answer time ends. */
  turnDeadline?: number | null;
  /** Set while phase is 'buzzer'. */
  buzzer?: BuzzerState | null;
  /** Set while phase is 'reveal_vote' (speak mode). */
  voting?: VoteState | null;
  /** Server clock at response time — for drift-free countdowns. */
  serverNow?: number;
}

export type GuessMode = 'type' | 'speak';

export interface MatchSettings {
  guessMode: GuessMode;
  answerTimeSec: number;
  buzzerEnabled: boolean;
}

export interface BuzzerState {
  openUntil: number;
  winnerId: string | null;
  winnerName: string | null;
  answerDeadline: number | null;
}

export interface VoteState {
  deadline: number;
  voterIds: string[];
  votes: Record<string, { artistOk: boolean; titleOk: boolean }>;
}

export interface StealResult {
  playerId: string;
  playerName: string;
  guess: string;
  field: 'artist' | 'title' | null;
  points: number;
}

export interface LiveInput {
  playerId: string;
  artist: string;
  title: string;
  year: number;
}

export interface PlaybackState {
  playing: boolean;
  positionSec: number;
  updatedAt: number;
}

export interface RoundReveal {
  playerId: string;
  playerName: string;
  card: Song;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearExact: boolean;
  timelineCorrect: boolean;
  yearDiff: number;
  points: number;
  timedOut?: boolean;
  steal?: StealResult | null;
}

export interface RoundResult {
  song: Song;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearDiff: number;
  yearExact: boolean;
  timelineCorrect: boolean;
  points: number;
}

export type GamePhase =
  | 'lobby'
  | 'playing'
  | 'guessing'
  | 'submitting'
  | 'result'
  | 'final';

export interface LobbySettings {
  maxPlayers: number;
  totalRounds: number;
  maxPoints: number;
  yearRange: number;
}