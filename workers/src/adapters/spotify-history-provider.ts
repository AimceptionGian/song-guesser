import type { HistoryProvider, PlayerHistory, HistoryTrack } from './history-provider';

// ─── Types ───

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ id: string; name: string }>;
  album: { name: string; release_date?: string };
}

interface SpotifyPlayHistoryItem {
  track: SpotifyTrack;
  played_at: string;
}

interface SpotifyRecentlyPlayedResponse {
  items: SpotifyPlayHistoryItem[];
  next?: string;
  cursors?: { after: string };
  limit: number;
}

interface SpotifyTopTrackResponse {
  items: SpotifyTrack[];
  next?: string;
  limit: number;
}

// ─── Constants ───

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

// ─── Helpers ───

function extractYear(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return !isNaN(year) && year >= 1900 && year <= 2030 ? year : undefined;
}

function spotifyTrackToHistoryTrack(
  item: SpotifyPlayHistoryItem,
  source: 'spotify',
): HistoryTrack {
  return {
    id: `spotify-${item.track.id}`,
    title: item.track.name,
    artist: item.track.artists.map((a) => a.name).join(', '),
    album: item.track.album.name,
    playedAt: item.played_at,
    source,
    year: extractYear(item.track.album.release_date),
  };
}

/**
 * Parse a Spotify API error response and extract meaning.
 */
function parseSpotifyError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error?.message) return parsed.error.message;
  } catch { /* ignore */ }
  return `Spotify API error: ${status}`;
}

// ─── Provider ───

export class SpotifyHistoryProvider implements HistoryProvider {
  name = 'spotify-history';

  /**
   * Fetch a player's listening history from Spotify: the union of
   * recently-played (heard at least once) and top tracks (well known,
   * flagged `isTop`). Both feed the history-based game categories —
   * top tracks are Spotify's closest available proxy for "heard often",
   * since the Web API exposes no play counts.
   * Requires the `user-read-recently-played` and `user-top-read` scopes.
   */
  async fetchHistory(playerId: string, accessToken?: string): Promise<PlayerHistory | null> {
    if (!accessToken) {
      console.warn(`[SpotifyHistory] No access token for player ${playerId}`);
      return null;
    }

    try {
      const [recentTracks, topTracks] = await Promise.all([
        this.fetchRecentlyPlayed(accessToken).catch((err) => {
          console.warn(`[SpotifyHistory] recently-played failed for ${playerId}:`, err);
          return [] as HistoryTrack[];
        }),
        this.fetchTopTracks(accessToken).catch((err) => {
          console.warn(`[SpotifyHistory] top-tracks failed for ${playerId}:`, err);
          return [] as HistoryTrack[];
        }),
      ]);

      // Merge: top tracks win on conflict so the isTop flag is preserved
      const byId = new Map<string, HistoryTrack>();
      for (const t of recentTracks) byId.set(t.id, t);
      for (const t of topTracks) byId.set(t.id, t);

      if (byId.size === 0) {
        console.warn(`[SpotifyHistory] No tracks found for player ${playerId}`);
        return null;
      }

      return {
        playerId,
        tracks: Array.from(byId.values()),
        syncedAt: Date.now(),
        source: 'spotify',
      };
    } catch (err) {
      console.error(`[SpotifyHistory] fetchHistory failed for ${playerId}:`, err);
      return null;
    }
  }

  /**
   * Import uploaded tracks as player history.
   */
  async importTracks(
    playerId: string,
    tracks: Omit<HistoryTrack, 'source'>[],
  ): Promise<PlayerHistory> {
    return {
      playerId,
      tracks: tracks.map((t) => ({ ...t, source: 'upload' as const })),
      syncedAt: Date.now(),
      source: 'upload',
    };
  }

  // ─── Private: Spotify API calls ───

  private async fetchFromSpotify<T>(accessToken: string, path: string): Promise<T | null> {
    const url = `${SPOTIFY_API_BASE}${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      const msg = parseSpotifyError(res.status, body);
      throw new Error(msg);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Fetch recently-played tracks. Returns up to 50 tracks from the last 24h.
   */
  private async fetchRecentlyPlayed(accessToken: string): Promise<HistoryTrack[]> {
    const data = await this.fetchFromSpotify<SpotifyRecentlyPlayedResponse>(
      accessToken,
      '/me/player/recently-played?limit=50',
    );
    if (!data?.items?.length) return [];
    return data.items.map((item) => spotifyTrackToHistoryTrack(item, 'spotify'));
  }

  /**
   * Fetch user's top tracks (medium-term). Returns up to 50 tracks.
   */
  private async fetchTopTracks(accessToken: string): Promise<HistoryTrack[]> {
    const data = await this.fetchFromSpotify<SpotifyTopTrackResponse>(
      accessToken,
      '/me/top/tracks?limit=50&time_range=medium_term',
    );
    if (!data?.items?.length) return [];

    // Top tracks don't have a `played_at` field; approximate with current date
    const now = new Date().toISOString();
    return data.items.map((track) => ({
      id: `spotify-${track.id}`,
      title: track.name,
      artist: track.artists.map((a) => a.name).join(', '),
      album: track.album.name,
      playedAt: now,
      source: 'spotify' as const,
      year: extractYear(track.album.release_date),
      isTop: true,
    }));
  }
}