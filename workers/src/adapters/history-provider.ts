// ─── Player History Provider Interface ───
// Abstracts how we retrieve a player's listening history.
// Supports Spotify OAuth sync and manual upload/import as data sources.

export interface HistoryTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  playedAt: string; // ISO 8601 timestamp
  source: 'spotify' | 'upload';
  /** Original release year from the provider's album metadata, if known. */
  year?: number;
  /** True when the track is one of the player's top tracks (well known),
   *  not just something they played once. */
  isTop?: boolean;
}

export interface PlayerHistory {
  playerId: string;
  tracks: HistoryTrack[];
  syncedAt: number; // epoch ms
  source: 'spotify' | 'upload';
}

export interface HistoryProvider {
  name: string;
  /**
   * Fetch listening history for a player.
   * If an accessToken is provided (for OAuth-based providers), use it.
   */
  fetchHistory(playerId: string, accessToken?: string): Promise<PlayerHistory | null>;
  /**
   * Push uploaded tracks into the player's history.
   * Used for the manual-upload fallback path.
   */
  importTracks(playerId: string, tracks: Omit<HistoryTrack, 'source'>[]): Promise<PlayerHistory>;
}