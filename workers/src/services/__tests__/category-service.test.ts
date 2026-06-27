import { getAvailableCategories, validateCategoryEligibility, getCategoryDescription } from '../category-service';

describe('category-service', () => {
  describe('getAvailableCategories', () => {
    it('should return all categories when history access is available', () => {
      const categories = getAvailableCategories(true);
      expect(categories).toHaveLength(4);
      expect(categories.map((c) => c.name)).toEqual([
        'hits',
        'well_known',
        'heard_by_all',
        'personal_favorites',
      ]);
    });

    it('should filter out history-dependent categories when no history access', () => {
      const categories = getAvailableCategories(false);
      expect(categories).toHaveLength(2);
      expect(categories.map((c) => c.name)).toEqual(['hits', 'well_known']);
    });
  });

  describe('validateCategoryEligibility', () => {
    it('should return eligible for valid category', async () => {
      const result = await validateCategoryEligibility('hits', ['p1', 'p2'], false);
      expect(result.eligible).toBe(true);
      expect(result.category).toBe('hits');
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
      const desc = getCategoryDescription('hits');
      expect(desc).toContain('Greatest Hits');
    });

    it('should return fallback for unknown category', () => {
      const desc = getCategoryDescription('unknown');
      expect(desc).toBe('Unknown category');
    });
  });
});