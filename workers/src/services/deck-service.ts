import { catalogService } from './catalog-service';
import { enrichTrackYears } from './spotify-year-service';
import { buildCategoryPool, getCategoryDefinition, MIN_CATEGORY_POOL, DEFAULT_CATEGORY } from './category-service';
import { DurableObjectHistoryStore } from '../db/repositories/durable-object-repository';
import { DECADE_HITS, DECADES } from '../db/decade-hits';
import type { CatalogTrack } from '../adapters/catalog-provider';
import type { Card, Lobby } from '../types';
import type { Env } from '../env';

// Deck size: big enough for the default game length (4 players × 5 rounds =
// 20 draws) with headroom, small enough that chart fetch + Spotify year
// lookups stay well under the Worker's per-invocation subrequest cap.
const DECK_SIZE = 30;

// History decks are smaller: every track needs its own Deezer preview
// lookup (one subrequest each), and that budget is capped per invocation.
const HISTORY_DECK_SIZE = 20;

// "Random Hits" blend: a handful of current chart tracks (freshness) plus
// curated decade classics (variety) — see buildRandomHitsDeck. Every
// curated lookup and Spotify year lookup costs one subrequest, so the split
// and the attempt cap are both sized to stay well under the Worker's
// per-invocation subrequest budget.
const RECENT_CHART_COUNT = 6;
const CURATED_TARGET = DECK_SIZE - RECENT_CHART_COUNT;
const CURATED_PER_DECADE = 5;
const CURATED_MAX_ATTEMPTS = 32;

const CARD_GRADIENT = 'linear-gradient(135deg, #1e1c2e, #13121f)';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardFromCatalogTrack(t: CatalogTrack): Card {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    year: t.year,
    genre: t.genre,
    emoji: '🎵',
    previewUrl: t.previewUrl ?? undefined,
    coverUrl: t.coverUrl ?? undefined,
    gradient: CARD_GRADIENT,
  };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Recent chart tracks: from the catalog chain (itunes→deezer→mock), release
 * years corrected via Spotify. Fetches more chart entries than needed and
 * samples randomly so results vary between games. Sampling happens BEFORE
 * year enrichment — each enriched track costs a Spotify subrequest.
 */
export async function fetchRecentChartCards(env: Env, count: number): Promise<Card[]> {
  let tracks: CatalogTrack[];
  try {
    tracks = await catalogService.getChartTracks(50);
  } catch {
    tracks = [];
  }
  if (tracks.length === 0) return [];

  tracks = shuffle(tracks).slice(0, count);

  try {
    tracks = await enrichTrackYears(tracks, env);
  } catch (err) {
    console.warn('[fetchRecentChartCards] year enrichment failed, keeping provider years:', err);
  }

  return tracks.map(cardFromCatalogTrack);
}

/**
 * Curated decade-spanning classics (1960s–2010s): the year is hardcoded
 * ground truth (see decade-hits.ts) rather than sourced from a provider,
 * since Deezer/iTunes often report compilation/remaster dates for older
 * songs. Only the preview URL and cover art come from Deezer, one lookup
 * per candidate, capped so a run of misses can't exhaust the subrequest
 * budget.
 */
export async function buildCuratedDecadeCards(targetCount: number): Promise<Card[]> {
  const deezer = catalogService.getProvider('deezer');
  const cards: Card[] = [];
  let attempts = 0;

  for (const decade of shuffle(DECADES)) {
    if (cards.length >= targetCount || attempts >= CURATED_MAX_ATTEMPTS) break;
    let addedForDecade = 0;

    for (const hit of shuffle(DECADE_HITS[decade])) {
      if (addedForDecade >= CURATED_PER_DECADE || cards.length >= targetCount || attempts >= CURATED_MAX_ATTEMPTS) break;
      attempts++;
      try {
        const matches = await deezer.searchTracks(`${hit.artist} ${hit.title}`, 3);
        const withPreview = matches.find((m) => m.previewUrl);
        if (!withPreview) continue;
        cards.push({
          id: `decade-${hit.year}-${slugify(hit.artist)}-${slugify(hit.title)}`,
          title: hit.title,
          artist: hit.artist,
          year: hit.year,
          genre: 'Pop',
          emoji: '🎵',
          previewUrl: withPreview.previewUrl ?? undefined,
          coverUrl: withPreview.coverUrl ?? undefined,
          gradient: CARD_GRADIENT,
        });
        addedForDecade++;
      } catch {
        // try the next candidate
      }
    }
  }
  return cards;
}

/**
 * "Random Hits" deck: a blend of current chart hits and curated classics
 * spanning every decade from the 1960s to the 2010s, so the category isn't
 * dominated by whatever happens to be on the charts right now.
 */
export async function buildRandomHitsDeck(env: Env): Promise<Card[] | undefined> {
  const [recent, curated] = await Promise.all([
    fetchRecentChartCards(env, RECENT_CHART_COUNT),
    buildCuratedDecadeCards(CURATED_TARGET),
  ]);
  const combined = shuffle([...recent, ...curated]);
  return combined.length > 0 ? combined : undefined;
}

/**
 * History-based deck: pool from the players' synced Spotify histories
 * (release years come with the history data), previews looked up on Deezer.
 * Tracks without a findable preview are dropped — a guessing game without
 * audio is pointless. Returns undefined when the pool is too small, so the
 * caller can fall back to the random-hits deck.
 */
export async function buildHistoryDeck(env: Env, lobby: Lobby, category: string): Promise<Card[] | undefined> {
  const histories = await new DurableObjectHistoryStore(env).getHistories(lobby.id);
  const pool = buildCategoryPool(category, histories, lobby.players.map((p) => p.id));

  if (pool.length < MIN_CATEGORY_POOL) {
    console.warn(`[buildHistoryDeck] pool too small for "${category}" (${pool.length}/${MIN_CATEGORY_POOL})`);
    return undefined;
  }

  const deezer = catalogService.getProvider('deezer');
  const picked = shuffle(pool).slice(0, HISTORY_DECK_SIZE);

  const cards = await Promise.all(
    picked.map(async (t): Promise<Card | null> => {
      // History artist strings can list several artists — search with the first
      const primaryArtist = t.artist.split(',')[0].trim();
      let previewUrl: string | undefined;
      let coverUrl: string | undefined;
      try {
        const matches = await deezer.searchTracks(`${primaryArtist} ${t.title}`, 1);
        if (matches[0]?.previewUrl) {
          previewUrl = matches[0].previewUrl;
          coverUrl = matches[0].coverUrl ?? undefined;
        }
      } catch {
        // no preview — track gets dropped below
      }
      if (!previewUrl) return null;

      return {
        id: t.id,
        title: t.title,
        artist: t.artist,
        year: t.year ?? 2000,
        genre: 'Pop',
        emoji: '🎵',
        previewUrl,
        coverUrl,
        gradient: CARD_GRADIENT,
      };
    })
  );

  const deck = cards.filter((c): c is Card => c !== null);
  if (deck.length < MIN_CATEGORY_POOL) {
    console.warn(`[buildHistoryDeck] only ${deck.length} tracks with previews for "${category}"`);
    return undefined;
  }
  return deck;
}

/**
 * Build the match deck for the lobby's selected category.
 * History categories fall back to the random-hits deck when their pool is
 * too small, so a match can always start.
 */
export async function buildDeck(env: Env, lobby: Lobby): Promise<Card[] | undefined> {
  const category = lobby.category ?? DEFAULT_CATEGORY;
  const def = getCategoryDefinition(category);

  if (def?.requiresHistory) {
    const deck = await buildHistoryDeck(env, lobby, category);
    if (deck) return deck;
    console.warn(`[buildDeck] falling back to random-hits deck for category "${category}"`);
  }

  return buildRandomHitsDeck(env);
}
