import type { Card } from '../types';

/**
 * Provider-agnostic interface for music catalog lookups.
 * All provider-specific logic lives behind implementations of this interface.
 */
export interface CatalogProvider {
  name: string;
  searchTracks(query: string, limit?: number): Promise<CatalogTrack[]>;
  getTrack(id: string): Promise<CatalogTrack | null>;
  getPreviewUrl(trackId: string): Promise<string | null>;
  getChartTracks(limit?: number): Promise<CatalogTrack[]>;
}

export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  year: number;
  genre: string;
  previewUrl: string | null;
  coverUrl: string | null;
}

/**
 * Convert a catalog track to a game Card.
 */
export function trackToCard(track: CatalogTrack): Card {
  const emojiMap: Record<string, string> = {
    Rock: '🎸', Pop: '🎤', HipHop: '🎧', Jazz: '🎷',
    Classical: '🎻', Electronic: '🎹', RAndB: '🎵', Country: '🤠',
    Folk: '🎶', Soul: '🎙️', Funk: '🕺', Reggae: '🌴',
    Blues: '🎸', Metal: '🤘', Indie: '🎸', Punk: '⚡',
    Latin: '💃', Alternative: '🎸',
  };

  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    year: track.year,
    genre: track.genre,
    emoji: emojiMap[track.genre] || '🎵',
    previewUrl: track.previewUrl ?? undefined,
    coverUrl: track.coverUrl ?? undefined,
    gradient: `linear-gradient(135deg, #1e1c2e, #13121f)`,
  };
}