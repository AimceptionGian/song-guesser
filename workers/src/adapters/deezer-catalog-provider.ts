import type { CatalogProvider, CatalogTrack } from './catalog-provider';

// ─── Types ───

interface DeezerSearchResult {
  data: DeezerTrack[];
  total: number;
  next?: string;
}

interface DeezerTrack {
  id: number;
  title: string;
  link: string;
  duration: number;
  rank: number;
  explicit_lyrics: boolean;
  preview: string;
  release_date?: string; // track-level release date (available on individual track endpoint)
  artist: {
    id: number;
    name: string;
    picture_medium: string;
  };
  album: {
    id: number;
    title: string;
    cover_medium: string;
    cover_big: string;
    release_date?: string; // album-level release date
  };
}

interface DeezerGenre {
  id: number;
  name: string;
}

interface DeezerTrackWithGenres extends DeezerTrack {
  contributors?: Array<{ id: number; name: string; role: string }>;
}

function extractYear(releaseDate?: string): number {
  if (!releaseDate) return 2000;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return isNaN(year) ? 2000 : year;
}

const GENRE_CACHE = new Map<number, string>();

async function fetchGenreName(genreId: number): Promise<string> {
  if (GENRE_CACHE.has(genreId)) return GENRE_CACHE.get(genreId)!;
  try {
    const res = await fetch(`https://api.deezer.com/genre/${genreId}`);
    if (!res.ok) return 'Unknown';
    const data = (await res.json()) as DeezerGenre;
    GENRE_CACHE.set(genreId, data.name);
    return data.name;
  } catch {
    return 'Unknown';
  }
}

async function enrichTrackWithGenre(track: DeezerTrackWithGenres): Promise<string> {
  // Try to get genre from track's contributors (where available) or fetch genre endpoint
  // Deezer's track endpoint doesn't include genre directly; we approximate via search context
  return 'Pop'; // safe fallback — will be refined with genre endpoints if needed
}

function deezerToCatalogTrack(track: DeezerTrack): CatalogTrack {
  // Try multiple sources for the year
  let year = 2000;
  const dateStr = track.release_date || track.album?.release_date;
  if (dateStr) {
    const parsed = parseInt(dateStr.slice(0, 4), 10);
    if (!isNaN(parsed) && parsed >= 1950 && parsed <= 2030) {
      year = parsed;
    }
  }

  return {
    id: `deezer-${track.id}`,
    title: track.title,
    artist: track.artist.name,
    album: track.album.title,
    year,
    genre: 'Pop',
    previewUrl: track.preview || null,
    coverUrl: track.album.cover_medium || track.album.cover_big || null,
  };
}

/**
 * Deezer refused or failed the request (quota, overload, network, 5xx) —
 * as opposed to answering "no such track". Retrying later can succeed.
 */
export class DeezerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeezerUnavailableError';
  }
}

// Deezer's "DataException: no data" — a genuine miss, not an outage.
const DEEZER_NOT_FOUND_CODE = 800;

interface DeezerErrorBody {
  error?: { type?: string; message?: string; code?: number };
}

// ─── Deezer Catalog Provider ───

export class DeezerCatalogProvider implements CatalogProvider {
  name = 'deezer';

  private baseUrl = 'https://api.deezer.com';

  /**
   * GET a Deezer API path, telling outages apart from misses. Deezer
   * reports quota violations ("Quota limit exceeded", code 4) with HTTP 200
   * and an `error` body; treating that as "nothing found" is what silently
   * burned through decks and ended matches early.
   * Returns null for a genuine miss, throws DeezerUnavailableError otherwise.
   */
  private async fetchStrict<T>(path: string): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { headers: { 'Accept': 'application/json' } });
    } catch (err) {
      throw new DeezerUnavailableError(`network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new DeezerUnavailableError(`HTTP ${res.status}`);

    let body: T & DeezerErrorBody;
    try {
      body = (await res.json()) as T & DeezerErrorBody;
    } catch {
      throw new DeezerUnavailableError('unreadable response');
    }
    if (body?.error) {
      if (body.error.code === DEEZER_NOT_FOUND_CODE) return null;
      throw new DeezerUnavailableError(body.error.message ?? `error code ${body.error.code}`);
    }
    return body;
  }

  /**
   * Search, throwing DeezerUnavailableError when Deezer can't answer
   * (see fetchStrict). [] means Deezer answered and found nothing.
   */
  async searchTracksOrThrow(query: string, limit = 25): Promise<CatalogTrack[]> {
    const body = await this.fetchStrict<DeezerSearchResult>(
      `/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 50)}`
    );
    return body?.data?.length ? body.data.map(deezerToCatalogTrack) : [];
  }

  /** Track by id, throwing DeezerUnavailableError when Deezer can't answer. */
  async getTrackOrThrow(id: string): Promise<CatalogTrack | null> {
    const track = await this.fetchStrict<DeezerTrack>(`/track/${id.replace(/^deezer-/, '')}`);
    return track?.id ? deezerToCatalogTrack(track) : null;
  }

  /**
   * Search tracks via Deezer API.
   * Returns normalized CatalogTrack[], each with a 30s preview URL.
   */
  async searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    const encoded = encodeURIComponent(query);
    const url = `${this.baseUrl}/search?q=${encoded}&limit=${Math.min(limit, 50)}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.warn(`[DeezerCatalogProvider] search failed: ${res.status} ${res.statusText}`);
        return [];
      }

      const body = (await res.json()) as DeezerSearchResult & DeezerErrorBody;

      if (body.error) {
        console.warn(`[DeezerCatalogProvider] search refused: ${body.error.message ?? body.error.code}`);
        return [];
      }
      if (!body.data || body.data.length === 0) return [];

      return body.data.map(deezerToCatalogTrack);
    } catch (err) {
      console.warn(`[DeezerCatalogProvider] search error:`, err);
      return [];
    }
  }

  /**
   * Get a single track by ID.
   * The ID should be passed WITHOUT the 'deezer-' prefix.
   */
  async getTrack(id: string): Promise<CatalogTrack | null> {
    // Strip prefix if present
    const deezerId = id.replace(/^deezer-/, '');
    const url = `${this.baseUrl}/track/${deezerId}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;

      const track = (await res.json()) as DeezerTrack;
      if (!track || !track.id) return null;

      return deezerToCatalogTrack(track);
    } catch (err) {
      console.warn(`[DeezerCatalogProvider] getTrack error:`, err);
      return null;
    }
  }

  /**
   * Get the 30s preview URL for a track.
   * Deezer includes preview in the track data, so this just returns it.
   */
  async getPreviewUrl(trackId: string): Promise<string | null> {
    const track = await this.getTrack(trackId);
    return track?.previewUrl ?? null;
  }

  /**
   * Search by artist name to get a batch of tracks from that artist.
   * Useful for category seeding (e.g., "well_known" = popular tracks).
   */
  async searchByArtist(artist: string, limit = 10): Promise<CatalogTrack[]> {
    return this.searchTracks(`artist:"${artist}"`, limit);
  }

  /**
   * Fetch Deezer chart (global top tracks).
   * Chart entries carry no reliable release_date — the caller (buildChartDeck)
   * corrects the year via Spotify, so we don't spend a subrequest per track
   * fetching Deezer's own track detail here (Workers cap subrequests per
   * invocation, and that budget is needed for the Spotify lookups instead).
   */
  async getChartTracks(limit = 10): Promise<CatalogTrack[]> {
    const url = `${this.baseUrl}/chart/0/tracks?limit=${Math.min(limit, 50)}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return [];

      const body = (await res.json()) as DeezerSearchResult;
      if (!body.data || body.data.length === 0) return [];

      return body.data.map(deezerToCatalogTrack);
    } catch (err) {
      console.warn(`[DeezerCatalogProvider] getChartTracks error:`, err);
      return [];
    }
  }
}