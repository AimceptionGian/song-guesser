import { DeezerCatalogProvider, DeezerUnavailableError } from '../adapters/deezer-catalog-provider';
import { ITunesCatalogProvider } from '../adapters/itunes-catalog-provider';
import type { CatalogTrack } from '../adapters/catalog-provider';
import type { Card } from '../types';

/**
 * Deezer signs its preview URLs with a 15-minute expiry
 * (`?hdnea=exp=<unix>~…`); afterwards the CDN answers 403. A deck built at
 * match start is played out over far longer than that, so preview URLs are
 * NOT baked into the deck — they get resolved here, at the moment a card is
 * drawn, and are therefore always fresh for the turn that follows.
 *
 * Cover art is resolved in the same lookup (it comes back with the search
 * result anyway), so a deck can be built entirely without network calls.
 */

const deezer = new DeezerCatalogProvider();
const itunes = new ITunesCatalogProvider();

/** How many candidates a search may return before we give up on the card. */
const SEARCH_LIMIT = 3;

// Deezer's quota is per IP per few seconds, and Workers share egress IPs,
// so a short back-off usually clears it.
const RETRY_DELAYS_MS = [400, 1200];

/**
 * The song could not be looked up at all — Deezer is rate-limiting or down
 * and the fallback found nothing either. Unlike a `null` result this says
 * nothing about the card itself: the caller should keep it and let the
 * player retry, instead of discarding it as unplayable.
 */
export class PreviewUnavailableError extends Error {
  constructor() {
    super('preview lookup unavailable');
    this.name = 'PreviewUnavailableError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(lookup: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await lookup();
    } catch (err) {
      if (!(err instanceof DeezerUnavailableError) || attempt >= RETRY_DELAYS_MS.length) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

function withPreview(card: Card, track: CatalogTrack): Card {
  return { ...card, previewUrl: track.previewUrl!, coverUrl: track.coverUrl ?? card.coverUrl };
}

/**
 * Resolve a fresh, playable preview (and cover) for a card.
 * - returns the card with previewUrl when something playable was found
 * - returns null when the song genuinely has no preview — the caller should
 *   skip the card and draw the next one rather than handing out silence
 * - throws PreviewUnavailableError when the lookup itself failed
 */
export async function resolvePlayableCard(card: Card): Promise<Card | null> {
  let deezerDown = false;

  // Cards sourced from Deezer carry the exact track id: go straight to it so
  // we get the same recording the deck was built from.
  if (card.id.startsWith('deezer-')) {
    try {
      const track = await withRetry(() => deezer.getTrackOrThrow(card.id));
      if (track?.previewUrl) return withPreview(card, track);
    } catch (err) {
      if (!(err instanceof DeezerUnavailableError)) throw err;
      deezerDown = true;
    }
  }

  const query = card.previewQuery || `${card.artist} ${card.title}`;
  if (!deezerDown) {
    try {
      const matches = await withRetry(() => deezer.searchTracksOrThrow(query, SEARCH_LIMIT));
      const hit = matches.find((m) => m.previewUrl);
      if (hit) return withPreview(card, hit);
    } catch (err) {
      if (!(err instanceof DeezerUnavailableError)) throw err;
      deezerDown = true;
    }
  }

  // iTunes previews don't expire, so they make a fine second source — both
  // when Deezer is down and when it simply lacks this song. Apple throttles
  // Workers' IPs too, so this is the fallback, not the primary.
  try {
    const hit = (await itunes.searchTracks(query, SEARCH_LIMIT)).find((m) => m.previewUrl);
    if (hit) return withPreview(card, hit);
  } catch {
    // treated like "found nothing"
  }

  if (deezerDown) {
    console.warn(`[preview-service] lookup unavailable for "${query}"`);
    throw new PreviewUnavailableError();
  }
  return null;
}
