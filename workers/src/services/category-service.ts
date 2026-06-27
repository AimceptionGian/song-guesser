import type { CategoryEligibility } from '../types';

interface CategoryDefinition {
  name: string;
  description: string;
  requiresHistory: boolean;
}

const AVAILABLE_CATEGORIES: CategoryDefinition[] = [
  { name: 'hits', description: 'Greatest Hits — Chart-Erfolge aus allen Jahrzehnten', requiresHistory: false },
  { name: 'well_known', description: 'All-Time Classics — Songs die jeder kennt', requiresHistory: false },
  { name: 'heard_by_all', description: 'Jeder kennt sie — Songs die alle Spieler schon einmal gehört haben', requiresHistory: true },
  { name: 'personal_favorites', description: 'Persönliche Favoriten — basierend auf Hörgewohnheiten', requiresHistory: true },
];

export function getAvailableCategories(hasHistoryAccess: boolean): CategoryDefinition[] {
  if (hasHistoryAccess) return AVAILABLE_CATEGORIES;
  return AVAILABLE_CATEGORIES.filter((c) => !c.requiresHistory);
}

export async function validateCategoryEligibility(
  category: string,
  _playerIds: string[],
  _hasHistoryAccess: boolean
): Promise<CategoryEligibility> {
  const def = AVAILABLE_CATEGORIES.find((c) => c.name === category);
  if (!def) {
    return { category, eligible: false, totalSongs: 0, minSongsPerPlayer: 0 };
  }

  // Mock: always eligible with enough songs for v1 prototype
  return {
    category: def.name,
    eligible: true,
    totalSongs: 50,
    minSongsPerPlayer: 10,
  };
}

export function getCategoryDescription(name: string): string {
  const def = AVAILABLE_CATEGORIES.find((c) => c.name === name);
  return def?.description ?? 'Unknown category';
}