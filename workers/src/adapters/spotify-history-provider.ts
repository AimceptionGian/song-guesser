import type { HistoryProvider, PlayerHistory, HistoryTrack } from './history-provider';
import { songKey } from '../services/song-key';

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

interface SpotifySavedTrackResponse {
  items: Array<{ added_at: string; track: SpotifyTrack | null }>;
  total: number;
  limit: number;
}

// ─── Constants ───

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

const PAGE_SIZE = 50;

// The top-items endpoint serves at most ~100 entries per time range; two
// pages cover it. All three ranges together are what makes "Alle kennen
// ihn" workable: medium_term alone is ~50 songs per player, and the
// intersection of two such lists is usually empty.
const TOP_TIME_RANGES = ['short_term', 'medium_term', 'long_term'] as const;
const TOP_PAGE_OFFSETS = [0, 49];

// Liked songs: a deliberate "heard it at least once" signal and by far the
// largest source. Capped so a sync stays a handful of subrequests.
const MAX_SAVED_TRACKS = 300;

// The merged history is stored as one LobbyRegistry DO value (128 KiB
// limit) and cached in the browser, so it stays bounded.
export const MAX_HISTORY_TRACKS = 500;

// ─── Helpers ───

function extractYear(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return !isNaN(year) && year >= 1900 && year <= 2030 ? year : undefined;
}

function toHistoryTrack(track: SpotifyTrack, playedAt: string, isTop: boolean): HistoryTrack {
  return {
    id: `spotify-${track.id}`,
    title: track.name,
    artist: track.artists.map((a) => a.name).join(', '),
    playedAt,
    source: 'spotify',
    year: extractYear(track.album.release_date),
    ...(isTop ? { isTop: true } : {}),
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

/**
 * Merge track lists into one entry per song. Spotify hands out a separate
 * id for every release of a recording (single, album, remaster, regional
 * relink), so merging by id would keep duplicates — and, worse, make the
 * same song look like two different ones when histories are intersected.
 * Earlier lists win on conflict; `isTop` sticks once any list sets it.
 */
export function mergeHistoryTracks(...lists: HistoryTrack[][]): HistoryTrack[] {
  const byKey = new Map<string, HistoryTrack>();
  for (const list of lists) {
    for (const t of list) {
      const key = songKey(t.artist, t.title);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, t);
      } else if (t.isTop && !existing.isTop) {
        byKey.set(key, { ...existing, isTop: true });
      }
    }
  }
  return Array.from(byKey.values());
}

// ─── Provider ───

export class SpotifyHistoryProvider implements HistoryProvider {
  name = 'spotify-history';

  /**
   * Fetch a player's listening history from Spotify: the union of top
   * tracks across all time ranges (well known, flagged `isTop`), recently
   * played tracks and liked songs. Top tracks are Spotify's closest
   * available proxy for "heard often", since the Web API exposes no play
   * counts.
   * Requires the `user-top-read`, `user-read-recently-played` and
   * `user-library-read` scopes; a source whose scope is missing (a token
   * from before the scope was added) just contributes nothing.
   */
  async fetchHistory(playerId: string, accessToken?: string): Promise<PlayerHistory | null> {
    if (!accessToken) {
      console.warn(`[SpotifyHistory] No access token for player ${playerId}`);
      return null;
    }

    const safely = (label: string, p: Promise<HistoryTrack[]>) =>
      p.catch((err) => {
        console.warn(`[SpotifyHistory] ${label} failed for ${playerId}:`, err);
        return [] as HistoryTrack[];
      });

    try {
      const [recentTracks, topTracks, savedTracks] = await Promise.all([
        safely('recently-played', this.fetchRecentlyPlayed(accessToken)),
        safely('top-tracks', this.fetchTopTracks(accessToken)),
        safely('saved-tracks', this.fetchSavedTracks(accessToken)),
      ]);

      // Top tracks first: they are what the well_known category is built
      // from, so they must survive the size cap.
      const tracks = mergeHistoryTracks(topTracks, recentTracks, savedTracks).slice(0, MAX_HISTORY_TRACKS);

      if (tracks.length === 0) {
        console.warn(`[SpotifyHistory] No tracks found for player ${playerId}`);
        return null;
      }

      return {
        playerId,
        tracks,
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
      `/me/player/recently-played?limit=${PAGE_SIZE}`,
    );
    if (!data?.items?.length) return [];
    return data.items.map((item) => toHistoryTrack(item.track, item.played_at, false));
  }

  /**
   * Fetch the user's top tracks for every time range. A failing page only
   * drops that page; the call fails as a whole only when all pages do.
   */
  private async fetchTopTracks(accessToken: string): Promise<HistoryTrack[]> {
    const requests = TOP_TIME_RANGES.flatMap((range) =>
      TOP_PAGE_OFFSETS.map((offset) =>
        this.fetchFromSpotify<SpotifyTopTrackResponse>(
          accessToken,
          `/me/top/tracks?limit=${PAGE_SIZE}&offset=${offset}&time_range=${range}`,
        )
      )
    );
    const pages = await Promise.allSettled(requests);
    if (pages.every((p) => p.status === 'rejected')) {
      throw (pages[0] as PromiseRejectedResult).reason;
    }

    // Top tracks don't have a `played_at` field; approximate with current date
    const now = new Date().toISOString();
    return pages.flatMap((p) =>
      p.status === 'fulfilled' && p.value?.items
        ? p.value.items.map((track) => toHistoryTrack(track, now, true))
        : []
    );
  }

  /**
   * Fetch the user's liked songs (most recently liked first), up to
   * MAX_SAVED_TRACKS. The first page tells how many there are; the rest
   * is fetched in parallel.
   */
  private async fetchSavedTracks(accessToken: string): Promise<HistoryTrack[]> {
    const fetchPage = (offset: number) =>
      this.fetchFromSpotify<SpotifySavedTrackResponse>(
        accessToken,
        `/me/tracks?limit=${PAGE_SIZE}&offset=${offset}`,
      );

    const first = await fetchPage(0);
    if (!first?.items?.length) return [];

    const total = Math.min(first.total ?? first.items.length, MAX_SAVED_TRACKS);
    const offsets: number[] = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
    const rest = await Promise.allSettled(offsets.map(fetchPage));

    const items = [
      ...first.items,
      ...rest.flatMap((p) => (p.status === 'fulfilled' && p.value?.items ? p.value.items : [])),
    ];
    return items
      .filter((item): item is { added_at: string; track: SpotifyTrack } => !!item.track?.id)
      .map((item) => toHistoryTrack(item.track, item.added_at, false));
  }
}
