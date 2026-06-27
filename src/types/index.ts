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
}

export interface RoundResult {
  song: Song;
  guessedArtist: string;
  guessedTitle: string;
  guessedYear: number;
  artistCorrect: boolean;
  titleCorrect: boolean;
  yearDiff: number;
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