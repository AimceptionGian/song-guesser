import type { CatalogProvider, CatalogTrack } from './catalog-provider';

// ─── Types ───

interface JamendoTrack {
  id: string;
  name: string;
  duration: number;
  artist_name: string;
  artist_id: string;
  album_name: string;
  album_id: string;
  releasedate: string;
  genre: string;
  audiodownload: string;
  audiodownload_allowed: boolean;
  image: string;
}

interface JamendoResponse<T> {
  headers: {
    status: string;
    code: number;
    error_message?: string;
  };
  results: T[];
}

// ─── Helpers ───

const GENRE_MAP: Record<string, string> = {
  rock: 'Rock',
  pop: 'Pop',
  'hip-hop': 'HipHop',
  hiphop: 'HipHop',
  jazz: 'Jazz',
  classical: 'Classical',
  electronic: 'Electronic',
  'r&b': 'RAndB',
  country: 'Country',
  folk: 'Folk',
  soul: 'Soul',
  funk: 'Funk',
  reggae: 'Reggae',
  blues: 'Blues',
  metal: 'Metal',
  indie: 'Indie',
  punk: 'Punk',
  latin: 'Latin',
  alternative: 'Alternative',
  ambient: 'Electronic',
  dance: 'Electronic',
  acoustic: 'Folk',
};

function mapGenre(jamendoGenre: string): string {
  const key = jamendoGenre.toLowerCase().trim();
  return GENRE_MAP[key] || jamendoGenre || 'Pop';
}

function extractYear(releaseDate: string): number {
  if (!releaseDate) return 2000;
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return isNaN(year) ? 2000 : year;
}

function jamendoToCatalogTrack(track: JamendoTrack): CatalogTrack {
  return {
    id: `jamendo-${track.id}`,
    title: track.name,
    artist: track.artist_name,
    album: track.album_name,
    year: extractYear(track.releasedate),
    genre: mapGenre(track.genre),
    previewUrl: track.audiodownload_allowed ? track.audiodownload : null,
    coverUrl: track.image || null,
  };
}

// ─── Jamendo Catalog Provider ───

export class JamendoCatalogProvider implements CatalogProvider {
  name = 'jamendo';

  private baseUrl = 'https://api.jamendo.com/v3.0';
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  /**
   * Search tracks via Jamendo API.
   * Returns normalized CatalogTrack[] with 30s preview URLs.
   */
  async searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    const encoded = encodeURIComponent(query);
    const url = `${this.baseUrl}/tracks/?client_id=${this.clientId}&format=json&limit=${Math.min(limit, 50)}&search=${encoded}&include=musicinfo&audioformat=mp32`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.warn(`[JamendoCatalogProvider] search failed: ${res.status}`);
        return [];
      }

      const body = (await res.json()) as JamendoResponse<JamendoTrack>;

      if (!body.results || body.results.length === 0) return [];

      return body.results.map(jamendoToCatalogTrack);
    } catch (err) {
      console.warn(`[JamendoCatalogProvider] search error:`, err);
      return [];
    }
  }

  /**
   * Get a single track by ID.
   * The ID should be passed WITHOUT the 'jamendo-' prefix.
   */
  async getTrack(id: string): Promise<CatalogTrack | null> {
    const jamendoId = id.replace(/^jamendo-/, '');
    const url = `${this.baseUrl}/tracks/?client_id=${this.clientId}&format=json&id=${jamendoId}&include=musicinfo&audioformat=mp32`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;

      const body = (await res.json()) as JamendoResponse<JamendoTrack>;
      if (!body.results || body.results.length === 0) return null;

      return jamendoToCatalogTrack(body.results[0]);
    } catch (err) {
      console.warn(`[JamendoCatalogProvider] getTrack error:`, err);
      return null;
    }
  }

  /**
   * Get the 30s preview URL for a track.
   * Jamendo returns the download URL directly in track data.
   */
  async getPreviewUrl(trackId: string): Promise<string | null> {
    const track = await this.getTrack(trackId);
    return track?.previewUrl ?? null;
  }
}