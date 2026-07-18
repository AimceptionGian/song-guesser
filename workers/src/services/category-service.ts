import type { CategoryEligibility } from '../types';
import type { HistoryTrack } from '../adapters/history-provider';

export interface CategoryDefinition {
  name: string;
  label: string;
  description: string;
  emoji: string;
  requiresHistory: boolean;
}

/** Minimum pool size for a history category to be playable. */
export const MIN_CATEGORY_POOL = 10;

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

  switch (category) {
    case 'heard_by_any': {
      // Union across all players, deduped by track id
      const byId = new Map<string, HistoryTrack>();
      for (const tracks of playerLists) {
        for (const t of tracks) {
          if (!byId.has(t.id)) byId.set(t.id, t);
        }
      }
      return Array.from(byId.values());
    }
    case 'well_known': {
      // Union of top tracks only
      const byId = new Map<string, HistoryTrack>();
      for (const tracks of playerLists) {
        for (const t of tracks) {
          if (t.isTop && !byId.has(t.id)) byId.set(t.id, t);
        }
      }
      return Array.from(byId.values());
    }
    case 'heard_by_all': {
      // Intersection: every lobby player must have the track in their history.
      // Players who haven't synced make the intersection empty by definition.
      if (allPlayerIds.some((pid) => !histories[pid]?.length)) return [];
      const [first, ...rest] = allPlayerIds.map((pid) => histories[pid]);
      const restIds = rest.map((tracks) => new Set(tracks.map((t) => t.id)));
      return first.filter((t) => restIds.every((ids) => ids.has(t.id)));
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
    result[def.name] = pool.length >= MIN_CATEGORY_POOL
      ? { eligible: true, totalSongs: pool.length }
      : { eligible: false, totalSongs: pool.length, reason: `Zu wenige Songs (${pool.length}/${MIN_CATEGORY_POOL})` };
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
