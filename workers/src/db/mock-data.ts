import type { Card } from '../types';

/**
 * Shared mock data used across backend services.
 */
export const MOCK_TRACKS: Card[] = [
  { id: 'm1', title: 'Bohemian Rhapsody', artist: 'Queen', year: 1975, genre: 'Rock', emoji: '🎸', gradient: 'linear-gradient(135deg, #3a1a1a, #1a0e0e)' },
  { id: 'm2', title: 'Billie Jean', artist: 'Michael Jackson', year: 1982, genre: 'Pop', emoji: '🕺', gradient: 'linear-gradient(135deg, #1a2a3a, #0d151f)' },
  { id: 'm3', title: 'Smells Like Teen Spirit', artist: 'Nirvana', year: 1991, genre: 'Grunge', emoji: '🤘', gradient: 'linear-gradient(135deg, #2a3a1a, #1a2a0d)' },
  { id: 'm4', title: 'Rolling in the Deep', artist: 'Adele', year: 2010, genre: 'Soul', emoji: '🎤', gradient: 'linear-gradient(135deg, #3a1a2a, #1f0d15)' },
  { id: 'm5', title: 'Shape of You', artist: 'Ed Sheeran', year: 2017, genre: 'Pop', emoji: '🎶', gradient: 'linear-gradient(135deg, #2a2a1a, #1a1a0d)' },
  { id: 'm6', title: 'Hotel California', artist: 'Eagles', year: 1976, genre: 'Rock', emoji: '🏨', gradient: 'linear-gradient(135deg, #1a2a1a, #0d1a0d)' },
  { id: 'm7', title: 'Thriller', artist: 'Michael Jackson', year: 1983, genre: 'Pop', emoji: '🧟', gradient: 'linear-gradient(135deg, #2a1a2a, #150d15)' },
  { id: 'm8', title: 'Like a Rolling Stone', artist: 'Bob Dylan', year: 1965, genre: 'Folk', emoji: '🎵', gradient: 'linear-gradient(135deg, #1a1a2a, #0d0d1a)' },
  { id: 'm9', title: 'Stairway to Heaven', artist: 'Led Zeppelin', year: 1971, genre: 'Rock', emoji: '🎸', gradient: 'linear-gradient(135deg, #2a1a0d, #1a0d08)' },
  { id: 'm10', title: 'Imagine', artist: 'John Lennon', year: 1971, genre: 'Pop', emoji: '☮️', gradient: 'linear-gradient(135deg, #1a2a2a, #0d1a1a)' },
  { id: 'm11', title: 'Purple Rain', artist: 'Prince', year: 1984, genre: 'Pop', emoji: '💜', gradient: 'linear-gradient(135deg, #2a0d2a, #1a081a)' },
  { id: 'm12', title: 'Wonderwall', artist: 'Oasis', year: 1995, genre: 'Britpop', emoji: '🎸', gradient: 'linear-gradient(135deg, #2a2a0d, #1a1a08)' },
  { id: 'm13', title: 'Get Lucky', artist: 'Daft Punk', year: 2013, genre: 'Funk', emoji: '🕺', gradient: 'linear-gradient(135deg, #0d2a2a, #081a1a)' },
  { id: 'm14', title: 'Lose Yourself', artist: 'Eminem', year: 2002, genre: 'Hip-Hop', emoji: '🎤', gradient: 'linear-gradient(135deg, #1a1a0d, #0d0d08)' },
  { id: 'm15', title: 'Hallelujah', artist: 'Jeff Buckley', year: 1994, genre: 'Rock', emoji: '✨', gradient: 'linear-gradient(135deg, #0d1a2a, #080d1a)' },
];

export function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}