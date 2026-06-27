import { Song, Player, LobbySettings, GameState } from '../types';

export const MOCK_SONGS: Song[] = [
  { id: '1', title: 'Bohemian Rhapsody', artist: 'Queen', year: 1975, genre: 'Rock', emoji: '🎸', gradient: 'linear-gradient(135deg, #3a1a1a, #1a0e0e)' },
  { id: '2', title: 'Billie Jean', artist: 'Michael Jackson', year: 1982, genre: 'Pop', emoji: '🕺', gradient: 'linear-gradient(135deg, #1a2a3a, #0d151f)' },
  { id: '3', title: 'Smells Like Teen Spirit', artist: 'Nirvana', year: 1991, genre: 'Grunge', emoji: '🤘', gradient: 'linear-gradient(135deg, #2a3a1a, #1a2a0d)' },
  { id: '4', title: 'Rolling in the Deep', artist: 'Adele', year: 2010, genre: 'Soul', emoji: '🎤', gradient: 'linear-gradient(135deg, #3a1a2a, #1f0d15)' },
  { id: '5', title: 'Shape of You', artist: 'Ed Sheeran', year: 2017, genre: 'Pop', emoji: '🎶', gradient: 'linear-gradient(135deg, #2a2a1a, #1a1a0d)' },
  { id: '6', title: 'Hotel California', artist: 'Eagles', year: 1976, genre: 'Rock', emoji: '🏨', gradient: 'linear-gradient(135deg, #1a2a1a, #0d1a0d)' },
  { id: '7', title: 'Thriller', artist: 'Michael Jackson', year: 1983, genre: 'Pop', emoji: '🧟', gradient: 'linear-gradient(135deg, #2a1a2a, #150d15)' },
  { id: '8', title: 'Like a Rolling Stone', artist: 'Bob Dylan', year: 1965, genre: 'Folk', emoji: '🎵', gradient: 'linear-gradient(135deg, #1a1a2a, #0d0d1a)' },
  { id: '9', title: 'Stairway to Heaven', artist: 'Led Zeppelin', year: 1971, genre: 'Rock', emoji: '🎸', gradient: 'linear-gradient(135deg, #2a1a0d, #1a0d08)' },
  { id: '10', title: 'Imagine', artist: 'John Lennon', year: 1971, genre: 'Pop', emoji: '☮️', gradient: 'linear-gradient(135deg, #1a2a2a, #0d1a1a)' },
  { id: '11', title: 'Purple Rain', artist: 'Prince', year: 1984, genre: 'Pop', emoji: '💜', gradient: 'linear-gradient(135deg, #2a0d2a, #1a081a)' },
  { id: '12', title: 'Wonderwall', artist: 'Oasis', year: 1995, genre: 'Britpop', emoji: '🎸', gradient: 'linear-gradient(135deg, #2a2a0d, #1a1a08)' },
  { id: '13', title: 'Get Lucky', artist: 'Daft Punk', year: 2013, genre: 'Funk', emoji: '🕺', gradient: 'linear-gradient(135deg, #0d2a2a, #081a1a)' },
  { id: '14', title: 'Lose Yourself', artist: 'Eminem', year: 2002, genre: 'Hip-Hop', emoji: '🎤', gradient: 'linear-gradient(135deg, #1a1a0d, #0d0d08)' },
  { id: '15', title: 'Hallelujah', artist: 'Jeff Buckley', year: 1994, genre: 'Rock', emoji: '✨', gradient: 'linear-gradient(135deg, #0d1a2a, #080d1a)' },
];

export const MOCK_PLAYERS: Player[] = [
  { id: 'p1', name: 'Alex', score: 0, avatar: '🎵', hand: [], placedCards: [] },
  { id: 'p2', name: 'Jordan', score: 0, avatar: '🎸', hand: [], placedCards: [] },
  { id: 'p3', name: 'Sam', score: 0, avatar: '🎤', hand: [], placedCards: [] },
];

export const MOCK_LOBBY_SETTINGS: LobbySettings = {
  maxPlayers: 4,
  totalRounds: 5,
  maxPoints: 1000,
  yearRange: 60,
};

export const MOCK_GAME_STATE: GameState = {
  gameCode: 'ABCD',
  players: MOCK_PLAYERS,
  currentPlayerIndex: 0,
  currentCard: null,
  currentRound: 1,
  totalRounds: 5,
  phase: 'lobby',
  timelineRange: { min: 1960, max: 2024 },
};

export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const MIN_YEAR = 1960;
export const MAX_YEAR = 2024;