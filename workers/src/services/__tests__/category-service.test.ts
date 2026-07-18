import {
  getAvailableCategories,
  validateCategoryEligibility,
  getCategoryDescription,
  buildCategoryPool,
  getCategoryAvailability,
  MIN_CATEGORY_POOL,
} from '../category-service';
import type { HistoryTrack } from '../../adapters/history-provider';

function makeTrack(id: string, overrides: Partial<HistoryTrack> = {}): HistoryTrack {
  return {
    id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    playedAt: new Date().toISOString(),
    source: 'spotify',
    year: 2000,
    ...overrides,
  };
}

/** n distinct tracks with ids prefix-0 … prefix-(n-1) */
function makeTracks(n: number, prefix = 't', overrides: Partial<HistoryTrack> = {}): HistoryTrack[] {
  return Array.from({ length: n }, (_, i) => makeTrack(`${prefix}-${i}`, overrides));
}

describe('category-service', () => {
  describe('getAvailableCategories', () => {
    it('should return all categories when history access is available', () => {
      const categories = getAvailableCategories(true);
      expect(categories).toHaveLength(4);
      expect(categories.map((c) => c.name)).toEqual([
        'random_hits',
        'heard_by_any',
        'well_known',
        'heard_by_all',
      ]);
    });

    it('should filter out history-dependent categories when no history access', () => {
      const categories = getAvailableCategories(false);
      expect(categories).toHaveLength(1);
      expect(categories[0].name).toBe('random_hits');
    });
  });

  describe('buildCategoryPool', () => {
    it('heard_by_any: union of all players, deduped', () => {
      const shared = makeTrack('shared');
      const pool = buildCategoryPool('heard_by_any', {
        p1: [shared, makeTrack('a')],
        p2: [shared, makeTrack('b')],
      }, ['p1', 'p2']);

      expect(pool.map((t) => t.id).sort()).toEqual(['a', 'b', 'shared']);
    });

    it('well_known: only top tracks', () => {
      const pool = buildCategoryPool('well_known', {
        p1: [makeTrack('top1', { isTop: true }), makeTrack('recent1')],
        p2: [makeTrack('top2', { isTop: true })],
      }, ['p1', 'p2']);

      expect(pool.map((t) => t.id).sort()).toEqual(['top1', 'top2']);
    });

    it('heard_by_all: only tracks present in every player history', () => {
      const pool = buildCategoryPool('heard_by_all', {
        p1: [makeTrack('both'), makeTrack('only1')],
        p2: [makeTrack('both'), makeTrack('only2')],
      }, ['p1', 'p2']);

      expect(pool.map((t) => t.id)).toEqual(['both']);
    });

    it('heard_by_all: empty when any lobby player has no history', () => {
      const pool = buildCategoryPool('heard_by_all', {
        p1: [makeTrack('a')],
      }, ['p1', 'p2']);

      expect(pool).toEqual([]);
    });

    it('returns empty for non-history categories and empty histories', () => {
      expect(buildCategoryPool('random_hits', { p1: [makeTrack('a')] }, ['p1'])).toEqual([]);
      expect(buildCategoryPool('heard_by_any', {}, ['p1'])).toEqual([]);
    });
  });

  describe('getCategoryAvailability', () => {
    it('random_hits is always eligible', () => {
      const avail = getCategoryAvailability({}, ['p1', 'p2']);
      expect(avail.random_hits.eligible).toBe(true);
    });

    it('history categories are ineligible without any synced player', () => {
      const avail = getCategoryAvailability({}, ['p1', 'p2']);
      expect(avail.heard_by_any.eligible).toBe(false);
      expect(avail.well_known.eligible).toBe(false);
      expect(avail.heard_by_all.eligible).toBe(false);
    });

    it('heard_by_any becomes eligible with a large enough pool', () => {
      const avail = getCategoryAvailability({
        p1: makeTracks(MIN_CATEGORY_POOL),
      }, ['p1', 'p2']);

      expect(avail.heard_by_any.eligible).toBe(true);
      expect(avail.heard_by_any.totalSongs).toBe(MIN_CATEGORY_POOL);
    });

    it('heard_by_any stays ineligible below the minimum pool', () => {
      const avail = getCategoryAvailability({
        p1: makeTracks(MIN_CATEGORY_POOL - 1),
      }, ['p1']);

      expect(avail.heard_by_any.eligible).toBe(false);
      expect(avail.heard_by_any.reason).toContain('Zu wenige Songs');
    });

    it('heard_by_all requires every lobby player to have synced', () => {
      const avail = getCategoryAvailability({
        p1: makeTracks(MIN_CATEGORY_POOL),
      }, ['p1', 'p2']);

      expect(avail.heard_by_all.eligible).toBe(false);
      expect(avail.heard_by_all.reason).toContain('Alle Spieler');
    });

    it('well_known counts only top tracks', () => {
      const avail = getCategoryAvailability({
        p1: [...makeTracks(MIN_CATEGORY_POOL, 'top', { isTop: true }), ...makeTracks(5, 'recent')],
      }, ['p1']);

      expect(avail.well_known.eligible).toBe(true);
      expect(avail.well_known.totalSongs).toBe(MIN_CATEGORY_POOL);
    });
  });

  describe('validateCategoryEligibility', () => {
    it('should return eligible for valid category', async () => {
      const result = await validateCategoryEligibility('random_hits', ['p1', 'p2'], false);
      expect(result.eligible).toBe(true);
      expect(result.category).toBe('random_hits');
      expect(result.totalSongs).toBeGreaterThan(0);
    });

    it('should return not eligible for unknown category', async () => {
      const result = await validateCategoryEligibility('nonexistent', ['p1'], true);
      expect(result.eligible).toBe(false);
      expect(result.totalSongs).toBe(0);
    });
  });

  describe('getCategoryDescription', () => {
    it('should return description for known category', () => {
      const desc = getCategoryDescription('random_hits');
      expect(desc).toContain('Chart-Hits');
    });

    it('should return fallback for unknown category', () => {
      const desc = getCategoryDescription('unknown');
      expect(desc).toBe('Unknown category');
    });
  });
});
