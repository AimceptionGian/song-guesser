// ─── History Service ───
// Manages player listening history providers.
// Provides unified access to Spotify history sync and manual upload fallback.
// History data drives the "history-dependent" categories in category-service.

import type { HistoryProvider, PlayerHistory, HistoryTrack } from '../adapters/history-provider';
import { SpotifyHistoryProvider } from '../adapters/spotify-history-provider';

export class HistoryService {
  private providers: Map<string, HistoryProvider> = new Map();
  // In-memory store: playerId -> PlayerHistory
  private historyStore: Map<string, PlayerHistory> = new Map();

  constructor() {
    const spotify = new SpotifyHistoryProvider();
    this.providers.set(spotify.name, spotify);
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a player has synced or uploaded history.
   */
  hasHistory(playerId: string): boolean {
    return this.historyStore.has(playerId);
  }

  /**
   * Get cached player history.
   */
  getHistory(playerId: string): PlayerHistory | undefined {
    return this.historyStore.get(playerId);
  }

  /**
   * Sync history from Spotify for a given player.
   * Stores the result in memory for the current session.
   */
  async syncFromSpotify(playerId: string, accessToken: string): Promise<PlayerHistory | null> {
    const provider = this.providers.get('spotify-history');
    if (!provider) return null;

    const history = await provider.fetchHistory(playerId, accessToken);
    if (history) {
      this.historyStore.set(playerId, history);
    }
    return history;
  }

  /**
   * Import manually uploaded tracks as player history.
   */
  async importTracks(
    playerId: string,
    tracks: Omit<HistoryTrack, 'source'>[],
  ): Promise<PlayerHistory> {
    const provider = this.providers.get('spotify-history') as SpotifyHistoryProvider;
    const history = await provider.importTracks(playerId, tracks);
    this.historyStore.set(playerId, history);
    return history;
  }

  /**
   * Get all unique artist names across all players' history.
   * Used by catalog-service to select tracks that players know.
   */
  getUniqueArtists(playerIds: string[]): string[] {
    const artists = new Set<string>();
    for (const pid of playerIds) {
      const h = this.historyStore.get(pid);
      if (h) {
        for (const t of h.tracks) {
          // Split multi-artist strings
          t.artist.split(',').map((a) => a.trim()).forEach((a) => {
            if (a) artists.add(a);
          });
        }
      }
    }
    return Array.from(artists);
  }

  /**
   * Get all unique track IDs across all players' history.
   */
  getUniqueTrackIds(playerIds: string[]): string[] {
    const ids = new Set<string>();
    for (const pid of playerIds) {
      const h = this.historyStore.get(pid);
      if (h) {
        for (const t of h.tracks) {
          ids.add(t.id);
        }
      }
    }
    return Array.from(ids);
  }

  /**
   * Clear history for a player (e.g. on disconnect).
   */
  clearHistory(playerId: string): void {
    this.historyStore.delete(playerId);
  }

  /**
   * Clear all history for a lobby (when match ends).
   */
  clearLobbyHistory(playerIds: string[]): void {
    for (const pid of playerIds) {
      this.historyStore.delete(pid);
    }
  }
}

// Singleton instance
export const historyService = new HistoryService();
