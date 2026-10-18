import type { CategoryEligibility } from '../types';
import type { HistoryTrack } from '../adapters/history-provider';
import { songKey } from './song-key';

export interface CategoryDefinition {
  name: string;
  label: string;
  description: string;
  emoji: string;
  requiresHistory: boolean;
}

/** Minimum pool size for a history category to be playable. */
export const MIN_CATEGORY_POOL = 10;

/**
 * heard_by_all is an intersection and naturally much smaller than the other
 * pools. Its deck is topped up from the songs at least one player knows
 * (see deck-service), so a handful of shared songs is enough to play it.
 */
export const MIN_SHARED_POOL = 5;

export function minPoolFor(category: string): number {
  return category === 'heard_by_all' ? MIN_SHARED_POOL : MIN_CATEGORY_POOL;
}

export const DEFAULT_CATEGORY = 'random_hits';

const AVAILABLE_CATEGORIES: CategoryDefinition[] = [
  {
    name: 'random_hits',
    label: 'Random Hits',
    description: 'Charts + Klassiker aus allen Jahrzehnten — für alle spielbar',
    emoji: '🎲',
    requiresHistory: false,
  },
  {
    name: 'heard_by_any',
    label: 'Einer kennt ihn',
    description: 'Songs aus der Spotify-History von mindestens einem Spieler',
    emoji: '🙋',
    requiresHistory: true,
  },
  {
    name: 'well_known',
    label: 'Eure Top-Songs',
    description: 'Die Spotify-Top-Tracks der Spieler — Songs, die ihr oft hört',
    emoji: '❤️',
    requiresHistory: true,
  },
  {
    name: 'heard_by_all',
    label: 'Alle kennen ihn',
    description: 'Nur Songs, die in der Spotify-History von allen Spielern vorkommen',
    emoji: '👥',
    requiresHistory: true,
  },
];

export function getAvailableCategories(hasHistoryAccess: boolean): CategoryDefinition[] {
  if (hasHistoryAccess) return AVAILABLE_CATEGORIES;
  return AVAILABLE_CATEGORIES.filter((c) => !c.requiresHistory);
}

export function getCategoryDefinition(name: string): CategoryDefinition | undefined {
  return AVAILABLE_CATEGORIES.find((c) => c.name === name);
}

export function getCategoryDescription(name: string): string {
  return getCategoryDefinition(name)?.description ?? 'Unknown category';
}

/**
 * Build the candidate song pool for a history-based category.
 * `histories` maps playerId → that player's synced tracks;
 * `allPlayerIds` is everyone in the lobby (relevant for heard_by_all).
 * Returns [] for unknown or non-history categories.
 */
export function buildCategoryPool(
  category: string,
  histories: Record<string, HistoryTrack[]>,
  allPlayerIds: string[]
): HistoryTrack[] {
  const playerLists = Object.values(histories);
  if (playerLists.length === 0) return [];

  // Songs are matched by songKey, not by Spotify id: the same recording has
  // a different id per release, so id matching double-counts songs in the
  // unions and — fatally for heard_by_all — misses most real overlaps.
  const keyOf = (t: HistoryTrack) => songKey(t.artist, t.title);
  const union = (lists: HistoryTrack[][], include: (t: HistoryTrack) => boolean) => {
    const byKey = new Map<string, HistoryTrack>();
    for (const tracks of lists) {
      for (const t of tracks) {
        const key = keyOf(t);
        if (include(t) && !byKey.has(key)) byKey.set(key, t);
      }
    }
    return Array.from(byKey.values());
  };

  switch (category) {
    case 'heard_by_any':
      return union(playerLists, () => true);
    case 'well_known':
      // Union of top tracks only
      return union(playerLists, (t) => !!t.isTop);
    case 'heard_by_all': {
      // Intersection: every lobby player must have the song in their history.
      // Players who haven't synced make the intersection empty by definition.
      if (allPlayerIds.some((pid) => !histories[pid]?.length)) return [];
      const [first, ...rest] = allPlayerIds.map((pid) => histories[pid]);
      const restKeys = rest.map((tracks) => new Set(tracks.map(keyOf)));
      return union([first], (t) => restKeys.every((keys) => keys.has(keyOf(t))));
    }
    default:
      return [];
  }
}

export interface CategoryAvailability {
  eligible: boolean;
  totalSongs: number;
  reason?: string;
}

/**
 * Compute availability for every category given the lobby's current
 * players and synced histories. Drives the lobby UI's category grid.
 */
export function getCategoryAvailability(
  histories: Record<string, HistoryTrack[]>,
  allPlayerIds: string[]
): Record<string, CategoryAvailability> {
  const result: Record<string, CategoryAvailability> = {};
  const syncedCount = allPlayerIds.filter((pid) => histories[pid]?.length).length;

  for (const def of AVAILABLE_CATEGORIES) {
    if (!def.requiresHistory) {
      result[def.name] = { eligible: true, totalSongs: 0 };
      continue;
    }
    if (syncedCount === 0) {
      result[def.name] = { eligible: false, totalSongs: 0, reason: 'Kein Spieler hat Spotify verbunden' };
      continue;
    }
    if (def.name === 'heard_by_all' && syncedCount < allPlayerIds.length) {
      result[def.name] = { eligible: false, totalSongs: 0, reason: 'Alle Spieler müssen Spotify verbinden' };
      continue;
    }
    const pool = buildCategoryPool(def.name, histories, allPlayerIds);
    const min = minPoolFor(def.name);
    result[def.name] = pool.length >= min
      ? { eligible: true, totalSongs: pool.length }
      : { eligible: false, totalSongs: pool.length, reason: `Zu wenige Songs (${pool.length}/${min})` };
  }

  return result;
}

export async function validateCategoryEligibility(
  category: string,
  _playerIds: string[],
  _hasHistoryAccess: boolean
): Promise<CategoryEligibility> {
  const def = getCategoryDefinition(category);
  if (!def) {
    return { category, eligible: false, totalSongs: 0, minSongsPerPlayer: 0 };
  }

  return {
    category: def.name,
    eligible: true,
    totalSongs: 50,
    minSongsPerPlayer: 10,
  };
}
