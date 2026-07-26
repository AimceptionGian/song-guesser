import { catalogService } from './catalog-service';
import { enrichTrackYears } from './spotify-year-service';
import { buildCategoryPool, getCategoryDefinition, MIN_CATEGORY_POOL, DEFAULT_CATEGORY } from './category-service';
import { DurableObjectHistoryStore } from '../db/repositories/durable-object-repository';
import { DECADE_HITS, DECADES } from '../db/decade-hits';
import type { DecadeHit } from '../db/decade-hits';
import type { CatalogTrack } from '../adapters/catalog-provider';
import type { Card, Lobby } from '../types';
import type { Env } from '../env';

// A deck must outlast the whole match: one card per player per round. Cards
// whose preview can't be resolved at draw time are skipped, so the deck
// carries spares on top of the exact requirement.
const DECK_HEADROOM = 8;
const MIN_DECK_SIZE = 20;

// Fallback when the deck is built without a known player count / round count.
const DEFAULT_DECK_SIZE = 30;

// "Random Hits" blend: a handful of current chart tracks (freshness) plus
// curated decade classics (variety) — see buildRandomHitsDeck. Chart tracks
// are the only part that costs subrequests (chart fetch + one Spotify year
// lookup each), so their share stays small and fixed; curated cards are free.
const RECENT_CHART_COUNT = 6;

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
 * songs.
 *
 * Costs no subrequests at all — preview and cover are resolved when the card
 * is drawn (see preview-service), which is also the only point where a fresh,
 * non-expired preview URL can be obtained.
 *
 * Cards are drawn round-robin across the decades so every decade is
 * represented even when the target count is small.
 */
export function buildCuratedDecadeCards(targetCount: number): Card[] {
  const perDecade = shuffle(DECADES).map((decade) => shuffle(DECADE_HITS[decade]));
  const cards: Card[] = [];

  for (let i = 0; cards.length < targetCount; i++) {
    const roundPicks = perDecade.map((hits) => hits[i]).filter((h): h is DecadeHit => !!h);
    if (roundPicks.length === 0) break; // every decade exhausted

    for (const hit of roundPicks) {
      if (cards.length >= targetCount) break;
      cards.push({
        id: `decade-${hit.year}-${slugify(hit.artist)}-${slugify(hit.title)}`,
        title: hit.title,
        artist: hit.artist,
        year: hit.year,
        genre: 'Pop',
        emoji: '🎵',
        gradient: CARD_GRADIENT,
      });
    }
  }

  return cards;
}

function dedupeKey(card: Card): string {
  return `${card.artist}|${card.title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
}

/**
 * Merge two card lists, dropping duplicate title+artist pairs. `preferred`
 * wins on conflict — used to keep the curated (verified) year when a
 * classic also happens to be on the current chart (e.g. after a resurgence)
 * instead of whatever year the chart provider reports for it.
 */
export function mergeDeduped(preferred: Card[], other: Card[]): Card[] {
  const seen = new Set<string>();
  const merged: Card[] = [];
  for (const card of [...preferred, ...other]) {
    const key = dedupeKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(card);
  }
  return merged;
}

/**
 * "Random Hits" deck: a blend of current chart hits and curated classics
 * spanning every decade from the 1960s to the 2010s, so the category isn't
 * dominated by whatever happens to be on the charts right now.
 */
export async function buildRandomHitsDeck(env: Env, deckSize = DEFAULT_DECK_SIZE): Promise<Card[] | undefined> {
  const recent = await fetchRecentChartCards(env, Math.min(RECENT_CHART_COUNT, deckSize));
  // Curated cards are free to build, so over-provision and let them fill
  // whatever the chart didn't deliver: a failing chart provider then costs
  // variety, never deck size.
  const curated = buildCuratedDecadeCards(deckSize);
  const merged = mergeDeduped(curated, recent);

  // Chart cards go in first so trimming to deckSize can't drop the handful of
  // recent hits; the final shuffle spreads them through the deck again.
  const isCurated = (c: Card) => c.id.startsWith('decade-');
  const ordered = [...merged.filter((c) => !isCurated(c)), ...merged.filter(isCurated)];

  const combined = shuffle(ordered.slice(0, deckSize));
  return combined.length > 0 ? combined : undefined;
}

/**
 * History-based deck: pool from the players' synced Spotify histories
 * (release years come with the history data). Previews are resolved per card
 * at draw time, so building this deck costs no lookups — tracks Deezer can't
 * match are skipped when they come up. Returns undefined when the pool is too
 * small, so the caller can fall back to the random-hits deck.
 */
export async function buildHistoryDeck(
  env: Env,
  lobby: Lobby,
  category: string,
  deckSize = DEFAULT_DECK_SIZE
): Promise<Card[] | undefined> {
  const histories = await new DurableObjectHistoryStore(env).getHistories(lobby.id);
  const pool = buildCategoryPool(category, histories, lobby.players.map((p) => p.id));

  if (pool.length < MIN_CATEGORY_POOL) {
    console.warn(`[buildHistoryDeck] pool too small for "${category}" (${pool.length}/${MIN_CATEGORY_POOL})`);
    return undefined;
  }

  return shuffle(pool).slice(0, deckSize).map((t): Card => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    year: t.year ?? 2000,
    genre: 'Pop',
    emoji: '🎵',
    gradient: CARD_GRADIENT,
    // History artist strings can list several artists — search with the first
    previewQuery: `${t.artist.split(',')[0].trim()} ${t.title}`,
  }));
}

/**
 * How many cards a match needs: one per player per round, plus spares for
 * cards whose preview can't be resolved when they're drawn.
 */
export function deckSizeFor(lobby: Lobby): number {
  const draws = Math.max(1, lobby.players.length) * Math.max(1, lobby.settings.totalRounds);
  return Math.max(MIN_DECK_SIZE, draws + DECK_HEADROOM);
}

/**
 * Build the match deck for the lobby's selected category.
 * History categories fall back to the random-hits deck when their pool is
 * too small, so a match can always start.
 */
export async function buildDeck(env: Env, lobby: Lobby): Promise<Card[] | undefined> {
  const category = lobby.category ?? DEFAULT_CATEGORY;
  const def = getCategoryDefinition(category);
  const size = deckSizeFor(lobby);

  if (def?.requiresHistory) {
    const deck = await buildHistoryDeck(env, lobby, category, size);
    if (deck) return deck;
    console.warn(`[buildDeck] falling back to random-hits deck for category "${category}"`);
  }

  return buildRandomHitsDeck(env, size);
}
