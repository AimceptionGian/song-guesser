import { DeezerCatalogProvider } from '../adapters/deezer-catalog-provider';
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

/** How many candidates a search may return before we give up on the card. */
const SEARCH_LIMIT = 3;

/**
 * Resolve a fresh, playable preview (and cover) for a card.
 * Returns null when nothing playable was found — the caller should then skip
 * the card and draw the next one rather than handing the players silence.
 */
export async function resolvePlayableCard(card: Card): Promise<Card | null> {
  // Cards sourced from Deezer carry the exact track id: go straight to it so
  // we get the same recording the deck was built from.
  if (card.id.startsWith('deezer-')) {
    try {
      const track = await deezer.getTrack(card.id);
      if (track?.previewUrl) {
        return { ...card, previewUrl: track.previewUrl, coverUrl: track.coverUrl ?? card.coverUrl };
      }
    } catch {
      // fall through to the search below
    }
  }

  const query = card.previewQuery || `${card.artist} ${card.title}`;
  try {
    const matches = await deezer.searchTracks(query, SEARCH_LIMIT);
    const hit = matches.find((m) => m.previewUrl);
    if (hit?.previewUrl) {
      return { ...card, previewUrl: hit.previewUrl, coverUrl: hit.coverUrl ?? card.coverUrl };
    }
  } catch {
    // treated as unplayable
  }

  return null;
}
