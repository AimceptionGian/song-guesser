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
    release_date: string;
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
  const year = extractYear(track.album.release_date);

  return {
    id: `deezer-${track.id}`,
    title: track.title,
    artist: track.artist.name,
    album: track.album.title,
    year,
    genre: 'Pop', // Deezer track search doesn't include genre; defaulted
    previewUrl: track.preview || null,
    coverUrl: track.album.cover_medium || track.album.cover_big || null,
  };
}

// ─── Deezer Catalog Provider ───

export class DeezerCatalogProvider implements CatalogProvider {
  name = 'deezer';

  private baseUrl = 'https://api.deezer.com';

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

      const body = (await res.json()) as DeezerSearchResult;

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
   * Useful for seeding the "hits" category.
   */
  async getChartTracks(limit = 10): Promise<CatalogTrack[]> {
    const url = `${this.baseUrl}/chart/0/tracks?limit=${Math.min(limit, 50)}`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return [];

      const body = (await res.json()) as DeezerSearchResult;
      if (!body.data) return [];

      return body.data.map(deezerToCatalogTrack);
    } catch (err) {
      console.warn(`[DeezerCatalogProvider] getChartTracks error:`, err);
      return [];
    }
  }
}