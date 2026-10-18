import { catalogService } from './catalog-service';
import { enrichTrackYears } from './spotify-year-service';
import { buildCategoryPool, getCategoryDefinition, minPoolFor, DEFAULT_CATEGORY } from './category-service';
import { songKey } from './song-key';
import type { HistoryTrack } from '../adapters/history-provider';
import { DurableObjectHistoryStore, DurableObjectRecentPickStore } from '../db/repositories/durable-object-repository';
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

/**
 * Identity of a song across sources: the same track reached via the chart,
 * the curated list or a player's Spotify history must collapse to one key,
 * otherwise neither the dedupe nor the repeat protection catches it.
 */
export function trackKey(artist: string, title: string): string {
  return `${artist}|${title}`.toLowerCase().replace(/[^a-z0-9|]+/g, '');
}

/**
 * Recently played songs, oldest first, as a rank lookup.
 * Songs absent from the list rank ahead of every remembered one.
 */
export type Recency = ReadonlyMap<string, number>;

const NO_RECENCY: Recency = new Map();

function toRecency(keys: string[]): Recency {
  return new Map(keys.map((key, i) => [key, i]));
}

/**
 * Shuffle, then float the songs the group hasn't heard recently to the
 * front; remembered ones follow least-recently-played first. This is a
 * ranking, never a filter — a saturated memory degrades to "rotate through
 * the oldest ones again" instead of starving the deck.
 */
export function orderByFreshness<T>(items: T[], keyOf: (item: T) => string, recency: Recency): T[] {
  const shuffled = shuffle(items);
  if (recency.size === 0) return shuffled;
  return shuffled
    .map((item, i) => ({ item, rank: recency.get(keyOf(item)) ?? -1, i }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.item);
}

/**
 * Reorder so the same artist never sits back-to-back: with a deep pool,
 * two Queen songs in consecutive turns read as "wieder dasselbe" even
 * though they're different tracks. Greedy single pass — an artist that
 * simply dominates the deck can still end up adjacent, which is fine.
 */
export function spreadArtists(cards: Card[]): Card[] {
  const out = [...cards];
  for (let i = 1; i < out.length; i++) {
    if (out[i].artist !== out[i - 1].artist) continue;
    const swap = out.findIndex(
      (c, j) => j > i && c.artist !== out[i - 1].artist && c.artist !== (out[i + 1]?.artist ?? null)
    );
    if (swap !== -1) [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
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
 *
 * The chart itself barely moves from day to day, so sampling alone would
 * still surface the same handful of songs every match; `recency` biases the
 * sample towards entries the group hasn't had yet.
 */
export async function fetchRecentChartCards(env: Env, count: number, recency: Recency = NO_RECENCY): Promise<Card[]> {
  let tracks: CatalogTrack[];
  try {
    tracks = await catalogService.getChartTracks(50);
  } catch {
    tracks = [];
  }
  if (tracks.length === 0) return [];

  tracks = orderByFreshness(tracks, (t) => trackKey(t.artist, t.title), recency).slice(0, count);

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
 * represented even when the target count is small. Ranking by `recency`
 * happens per decade, so repeat protection never costs decade balance.
 */
export function buildCuratedDecadeCards(targetCount: number, recency: Recency = NO_RECENCY): Card[] {
  const perDecade = shuffle(DECADES).map((decade) =>
    orderByFreshness(DECADE_HITS[decade], (hit) => trackKey(hit.artist, hit.title), recency)
  );
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
  return trackKey(card.artist, card.title);
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
 * spanning every decade from the 1960s to the 2020s, so the category isn't
 * dominated by whatever happens to be on the charts right now.
 */
export async function buildRandomHitsDeck(
  env: Env,
  deckSize = DEFAULT_DECK_SIZE,
  recency: Recency = NO_RECENCY
): Promise<Card[] | undefined> {
  const recent = await fetchRecentChartCards(env, Math.min(RECENT_CHART_COUNT, deckSize), recency);
  // Curated cards are free to build, so over-provision and let them fill
  // whatever the chart didn't deliver: a failing chart provider then costs
  // variety, never deck size.
  const curated = buildCuratedDecadeCards(deckSize, recency);
  const merged = mergeDeduped(curated, recent);

  // Chart cards go in first so trimming to deckSize can't drop the handful of
  // recent hits. Both halves already arrive freshest-first, so the trim drops
  // the songs the group heard most recently; the final shuffle spreads the
  // chart cards through the deck again.
  const isCurated = (c: Card) => c.id.startsWith('decade-');
  const ordered = [...merged.filter((c) => !isCurated(c)), ...merged.filter(isCurated)];

  const combined = spreadArtists(shuffle(ordered.slice(0, deckSize)));
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
  deckSize = DEFAULT_DECK_SIZE,
  recency: Recency = NO_RECENCY
): Promise<Card[] | undefined> {
  const histories = await new DurableObjectHistoryStore(env).getHistories(lobby.id);
  const playerIds = lobby.players.map((p) => p.id);
  const pool = buildCategoryPool(category, histories, playerIds);
  const minPool = minPoolFor(category);

  if (pool.length < minPool) {
    console.warn(`[buildHistoryDeck] pool too small for "${category}" (${pool.length}/${minPool})`);
    return undefined;
  }

  // A player's top tracks are a short list by definition, so this pool
  // repeats even harder than the curated one without the recency ranking.
  const rank = (tracks: HistoryTrack[]) =>
    orderByFreshness(tracks, (t) => trackKey(t.artist, t.title), recency);
  const picked = rank(pool).slice(0, deckSize);
  const cards = spreadArtists(shuffle(picked.map(cardFromHistoryTrack)));

  // The intersection behind "Alle kennen ihn" is usually smaller than a
  // match needs. Topping it up with songs at least one player knows keeps
  // the deck personal; the shared songs sit at the end of the array, which
  // is the end the match draws from, so they all come up first.
  if (category === 'heard_by_all' && picked.length < deckSize) {
    const taken = new Set(picked.map((t) => songKey(t.artist, t.title)));
    const extra = rank(
      buildCategoryPool('heard_by_any', histories, playerIds)
        .filter((t) => !taken.has(songKey(t.artist, t.title)))
    ).slice(0, deckSize - picked.length);
    return [...spreadArtists(shuffle(extra.map(cardFromHistoryTrack))), ...cards];
  }

  return cards;
}

function cardFromHistoryTrack(t: HistoryTrack): Card {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    year: t.year ?? 2000,
    genre: 'Pop',
    emoji: '🎵',
    gradient: CARD_GRADIENT,
    // History artist strings can list several artists — search with the first
    previewQuery: `${t.artist.split(',')[0].trim()} ${t.title}`,
  };
}

/** Normalised song identity of a card, as used for dedupe and repeat protection. */
export function cardKey(card: Card): string {
  return dedupeKey(card);
}

/**
 * Spare cards for a match whose deck ran dry mid-game (a small history pool,
 * or a run of songs without a playable preview). Curated classics only:
 * they need no lookups, so the draw that triggers the refill stays fast.
 * `exclude` holds the cardKeys the match has already dealt.
 */
export function buildRefillCards(count: number, exclude: ReadonlySet<string>): Card[] {
  const fresh = buildCuratedDecadeCards(Number.MAX_SAFE_INTEGER)
    .filter((c) => !exclude.has(dedupeKey(c)));
  return spreadArtists(shuffle(fresh).slice(0, count));
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
 *
 * This is also the single place where cross-match repeat protection is
 * applied: the songs of the previous decks are read in as a ranking, and the
 * deck that comes out is written back. Both sides are best-effort — a
 * registry hiccup must degrade to "same songs as before", never to a match
 * that won't start.
 */
export async function buildDeck(env: Env, lobby: Lobby): Promise<Card[] | undefined> {
  const category = lobby.category ?? DEFAULT_CATEGORY;
  const def = getCategoryDefinition(category);
  const size = deckSizeFor(lobby);
  const store = new DurableObjectRecentPickStore(env);

  let recency: Recency = NO_RECENCY;
  try {
    recency = toRecency(await store.getRecentKeys());
  } catch (err) {
    console.warn('[buildDeck] recent-picks lookup failed, building without repeat protection:', err);
  }

  let deck: Card[] | undefined;
  if (def?.requiresHistory) {
    try {
      deck = await buildHistoryDeck(env, lobby, category, size, recency);
    } catch (err) {
      console.warn(`[buildDeck] history deck failed for "${category}":`, err);
    }
    if (!deck) console.warn(`[buildDeck] falling back to random-hits deck for category "${category}"`);
  }

  if (deck && deck.length < size) {
    // A history pool smaller than the match used to make the deck run dry
    // and end the match early. Top it up with curated classics, placed at
    // the front so they are only drawn once the category's songs are used.
    const have = new Set(deck.map(dedupeKey));
    const filler = buildCuratedDecadeCards(size, recency)
      .filter((c) => !have.has(dedupeKey(c)))
      .slice(0, size - deck.length);
    deck = [...spreadArtists(shuffle(filler)), ...deck];
  }

  deck ??= await buildRandomHitsDeck(env, size, recency);

  if (deck?.length) {
    try {
      // The whole deck is recorded, not just the cards that end up being
      // drawn: that keeps this to one write per match instead of a registry
      // round trip on every draw, and the pool is deep enough to afford it.
      await store.rememberKeys(deck.map(dedupeKey));
    } catch (err) {
      console.warn('[buildDeck] could not record the deck for repeat protection:', err);
    }
  }

  return deck;
}
