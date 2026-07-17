import type { CatalogTrack } from '../adapters/catalog-provider';
import type { Env } from '../env';

// ─── Types ───

interface SpotifyTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface SpotifySearchTrack {
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    album_type: string; // 'album' | 'single' | 'compilation'
    release_date: string; // 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
  };
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifySearchTrack[] };
}

// ─── Token handling (client credentials, cached per isolate) ───

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(env: Env): Promise<string | null> {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;

  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.value;
  }

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!res.ok) {
      console.warn(`[SpotifyYear] token request failed: ${res.status}`);
      return null;
    }

    const body = (await res.json()) as SpotifyTokenResponse;
    // Refresh a minute before actual expiry
    cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return cachedToken.value;
  } catch (err) {
    console.warn('[SpotifyYear] token request error:', err);
    return null;
  }
}

// ─── Year lookup ───

/** Strip parentheticals and feat./with suffixes that break exact search. */
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s*-\s*(feat|with|ft)\.?\s.*$/i, '')
    .replace(/"/g, '')
    .trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function artistMatches(searched: string, candidates: Array<{ name: string }>): boolean {
  const target = normalize(searched);
  if (!target) return false;
  return candidates.some((c) => {
    const n = normalize(c.name);
    return n.includes(target) || target.includes(n);
  });
}

function extractYear(releaseDate: string): number | null {
  const year = parseInt(releaseDate.slice(0, 4), 10);
  return !isNaN(year) && year >= 1900 && year <= 2030 ? year : null;
}

// Per-isolate cache: the same chart tracks recur across game starts
const YEAR_CACHE = new Map<string, number | null>();

/**
 * Find the ORIGINAL release year of a song: search Spotify for the track and
 * take the earliest year across matching non-compilation releases.
 * Returns null when unknown, so callers can keep the provider's year.
 */
export async function getOriginalYear(artist: string, title: string, token: string): Promise<number | null> {
  const cacheKey = `${normalize(artist)}|${normalize(title)}`;
  if (YEAR_CACHE.has(cacheKey)) return YEAR_CACHE.get(cacheKey)!;

  const cleaned = cleanTitle(title);
  const query = encodeURIComponent(`track:"${cleaned}" artist:"${artist.replace(/"/g, '')}"`);
  const url = `https://api.spotify.com/v1/search?type=track&limit=20&q=${query}`;

  let year: number | null = null;
  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const body = (await res.json()) as SpotifySearchResponse;
      const items = body.tracks?.items ?? [];
      const years = items
        .filter((t) => t.album.album_type !== 'compilation')
        .filter((t) => artistMatches(artist, t.artists))
        .map((t) => extractYear(t.album.release_date))
        .filter((y): y is number => y !== null);
      if (years.length > 0) year = Math.min(...years);
    } else {
      console.warn(`[SpotifyYear] search failed for "${artist} – ${title}": ${res.status}`);
      // Don't cache transient failures (429/5xx)
      if (res.status === 429 || res.status >= 500) return null;
    }
  } catch (err) {
    console.warn(`[SpotifyYear] search error for "${artist} – ${title}":`, err);
    return null;
  }

  YEAR_CACHE.set(cacheKey, year);
  return year;
}

/**
 * Enrich catalog tracks with original release years from Spotify.
 * No credentials or lookup failure → track keeps its provider year.
 */
export async function enrichTrackYears(tracks: CatalogTrack[], env: Env): Promise<CatalogTrack[]> {
  const token = await getAppToken(env);
  if (!token) {
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
      console.warn('[SpotifyYear] No Spotify credentials configured — keeping provider years');
    }
    return tracks;
  }

  const result: CatalogTrack[] = [];
  const BATCH_SIZE = 10;
  for (let i = 0; i < tracks.length; i += BATCH_SIZE) {
    const batch = tracks.slice(i, i + BATCH_SIZE);
    const enriched = await Promise.all(
      batch.map(async (track) => {
        const year = await getOriginalYear(track.artist, track.title, token);
        return year !== null ? { ...track, year } : track;
      })
    );
    result.push(...enriched);
  }
  return result;
}

/** Test-only: reset module-level caches. */
export function __resetSpotifyYearCaches(): void {
  cachedToken = null;
  YEAR_CACHE.clear();
}
