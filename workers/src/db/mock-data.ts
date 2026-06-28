import type { Card } from '../types';

/**
 * Shared mock data used across backend services.
 */
export const MOCK_TRACKS: Card[] = [
  { id: 'm1', title: 'Bohemian Rhapsody', artist: 'Queen', year: 1975, genre: 'Rock', emoji: '🎸', previewUrl: 'https://cdns-preview-3.dzcdn.net/stream/c-3e1b7040113062f1da6b393432a9fd0e-2.mp3', gradient: 'linear-gradient(135deg, #3a1a1a, #1a0e0e)' },
  { id: 'm2', title: 'Billie Jean', artist: 'Michael Jackson', year: 1982, genre: 'Pop', emoji: '🕺', previewUrl: 'https://cdns-preview-2.dzcdn.net/stream/c-2b50c32b4aa257576a2aca2209a02a04-3.mp3', gradient: 'linear-gradient(135deg, #1a2a3a, #0d151f)' },
  { id: 'm3', title: 'Smells Like Teen Spirit', artist: 'Nirvana', year: 1991, genre: 'Grunge', emoji: '🤘', previewUrl: 'https://cdns-preview-8.dzcdn.net/stream/c-83db73a0090b67bbd79f4845543b3e6e-3.mp3', gradient: 'linear-gradient(135deg, #2a3a1a, #1a2a0d)' },
  { id: 'm4', title: 'Rolling in the Deep', artist: 'Adele', year: 2010, genre: 'Soul', emoji: '🎤', previewUrl: 'https://cdns-preview-6.dzcdn.net/stream/c-6041b793350865cb98e98a2b9bae1edc-4.mp3', gradient: 'linear-gradient(135deg, #3a1a2a, #1f0d15)' },
  { id: 'm5', title: 'Shape of You', artist: 'Ed Sheeran', year: 2017, genre: 'Pop', emoji: '🎶', previewUrl: 'https://cdns-preview-4.dzcdn.net/stream/c-49ca5adc39683f26d8d3984db49f63b3-4.mp3', gradient: 'linear-gradient(135deg, #2a2a1a, #1a1a0d)' },
  { id: 'm6', title: 'Hotel California', artist: 'Eagles', year: 1976, genre: 'Rock', emoji: '🏨', previewUrl: 'https://cdns-preview-3.dzcdn.net/stream/c-32e53a7b4da9b4abd547e2cdb3ca0161-4.mp3', gradient: 'linear-gradient(135deg, #1a2a1a, #0d1a0d)' },
  { id: 'm7', title: 'Thriller', artist: 'Michael Jackson', year: 1983, genre: 'Pop', emoji: '🧟', previewUrl: 'https://cdns-preview-5.dzcdn.net/stream/c-5a47b1c53f326484587f7fe4478f0a16-3.mp3', gradient: 'linear-gradient(135deg, #2a1a2a, #150d15)' },
  { id: 'm8', title: 'Like a Rolling Stone', artist: 'Bob Dylan', year: 1965, genre: 'Folk', emoji: '🎵', previewUrl: 'https://cdns-preview-4.dzcdn.net/stream/c-47445b9950522cc6ac6c01f9dfeb2b43-3.mp3', gradient: 'linear-gradient(135deg, #1a1a2a, #0d0d1a)' },
  { id: 'm9', title: 'Stairway to Heaven', artist: 'Led Zeppelin', year: 1971, genre: 'Rock', emoji: '🎸', previewUrl: 'https://cdns-preview-4.dzcdn.net/stream/c-4336cac89de45d6ef59feb47e7d9a390-4.mp3', gradient: 'linear-gradient(135deg, #2a1a0d, #1a0d08)' },
  { id: 'm10', title: 'Imagine', artist: 'John Lennon', year: 1971, genre: 'Pop', emoji: '☮️', previewUrl: 'https://cdns-preview-3.dzcdn.net/stream/c-3fe256b33029059b3a0cb91ece0e2095-3.mp3', gradient: 'linear-gradient(135deg, #1a2a2a, #0d1a1a)' },
  { id: 'm11', title: 'Purple Rain', artist: 'Prince', year: 1984, genre: 'Pop', emoji: '💜', previewUrl: 'https://cdns-preview-5.dzcdn.net/stream/c-58443f3131a2a2ad1dac6d9a857af9eb-3.mp3', gradient: 'linear-gradient(135deg, #2a0d2a, #1a081a)' },
  { id: 'm12', title: 'Wonderwall', artist: 'Oasis', year: 1995, genre: 'Britpop', emoji: '🎸', previewUrl: 'https://cdns-preview-1.dzcdn.net/stream/c-1f4f826f891e81a7f7b4d5c2a17f67e1-4.mp3', gradient: 'linear-gradient(135deg, #2a2a0d, #1a1a08)' },
  { id: 'm13', title: 'Get Lucky', artist: 'Daft Punk', year: 2013, genre: 'Funk', emoji: '🕺', previewUrl: 'https://cdns-preview-2.dzcdn.net/stream/c-2886aef7c9b374cf4a0bcd241750b42c-4.mp3', gradient: 'linear-gradient(135deg, #0d2a2a, #081a1a)' },
  { id: 'm14', title: 'Lose Yourself', artist: 'Eminem', year: 2002, genre: 'Hip-Hop', emoji: '🎤', previewUrl: 'https://cdns-preview-3.dzcdn.net/stream/c-3d0db3f2edc5ab5d52c9c757f1b814fa-3.mp3', gradient: 'linear-gradient(135deg, #1a1a0d, #0d0d08)' },
  { id: 'm15', title: 'Hallelujah', artist: 'Jeff Buckley', year: 1994, genre: 'Rock', emoji: '✨', previewUrl: 'https://cdns-preview-9.dzcdn.net/stream/c-9b6b39233812e34a5bbcfcdb9a8e1d0d-3.mp3', gradient: 'linear-gradient(135deg, #0d1a2a, #080d1a)' },
];

export function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}