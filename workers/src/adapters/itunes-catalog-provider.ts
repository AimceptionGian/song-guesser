import type { CatalogProvider, CatalogTrack } from './catalog-provider';

// ─── Types ───

interface ITunesSearchResult {
  resultCount: number;
  results: ITunesTrack[];
}

interface ITunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName: string;
  releaseDate: string;
  previewUrl: string;
  artworkUrl100: string;
  primaryGenreName: string;
}

function extractYear(releaseDate: string): number {
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return isNaN(year) ? 2000 : year;
}

function itunesToCatalogTrack(track: ITunesTrack): CatalogTrack {
  return {
    id: `itunes-${track.trackId}`,
    title: track.trackName,
    artist: track.artistName,
    album: track.collectionName,
    year: extractYear(track.releaseDate),
    genre: track.primaryGenreName || 'Pop',
    previewUrl: track.previewUrl || null,
    coverUrl: track.artworkUrl100 || null,
  };
}

// ─── iTunes Catalog Provider ───

export class ITunesCatalogProvider implements CatalogProvider {
  name = 'itunes';

  private baseUrl = 'https://itunes.apple.com/search';

  /**
   * Search tracks via iTunes Search API.
   * Returns normalized CatalogTrack[] with original release years and 30s preview URLs.
   */
  async searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    const encoded = encodeURIComponent(query);
    const url = `${this.baseUrl}?term=${encoded}&limit=${Math.min(limit, 50)}&entity=song`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        console.warn(`[ITunesCatalogProvider] search failed: ${res.status}`);
        return [];
      }

      const body = (await res.json()) as ITunesSearchResult;

      if (!body.results || body.results.length === 0) return [];

      return body.results.map(itunesToCatalogTrack);
    } catch (err) {
      console.warn(`[ITunesCatalogProvider] search error:`, err);
      return [];
    }
  }

  /**
   * Get a single track by ID.
   */
  async getTrack(id: string): Promise<CatalogTrack | null> {
    const itunesId = id.replace(/^itunes-/, '');
    const url = `${this.baseUrl}?id=${itunesId}&entity=song`;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) return null;

      const body = (await res.json()) as ITunesSearchResult;
      if (!body.results || body.results.length === 0) return null;

      return itunesToCatalogTrack(body.results[0]);
    } catch (err) {
      console.warn(`[ITunesCatalogProvider] getTrack error:`, err);
      return null;
    }
  }

  /**
   * Get preview URL for a track.
   */
  async getPreviewUrl(trackId: string): Promise<string | null> {
    const track = await this.getTrack(trackId);
    return track?.previewUrl ?? null;
  }

  /**
   * Get chart/top tracks by searching popular terms.
   * iTunes doesn't have a chart endpoint, so we search for recent popular hits.
   */
  async getChartTracks(limit = 10): Promise<CatalogTrack[]> {
    // Search for popular genres to get chart-like results
    const queries = ['pop', 'rock', 'hip hop', 'electronic', 'rnb'];
    const allTracks: CatalogTrack[] = [];

    for (const q of queries) {
      if (allTracks.length >= limit) break;
      try {
        const url = `${this.baseUrl}?term=${q}&limit=${Math.min(limit, 20)}&entity=song`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.ok) {
          const body = (await res.json()) as ITunesSearchResult;
          if (body.results) {
            for (const track of body.results) {
              const ct = itunesToCatalogTrack(track);
              if (!allTracks.some((t) => t.id === ct.id)) {
                allTracks.push(ct);
                if (allTracks.length >= limit) break;
              }
            }
          }
        } else {
          console.warn(`[ITunesCatalogProvider] getChartTracks query "${q}" failed: ${res.status}`);
        }
      } catch (err) {
        console.warn(`[ITunesCatalogProvider] getChartTracks query "${q}" error:`, err);
      }
    }

    return allTracks.slice(0, limit);
  }
}