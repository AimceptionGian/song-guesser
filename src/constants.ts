// ─── Game Constants ───

export const MIN_YEAR = 1960;
export const MAX_YEAR = 2026;
export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

// Scoring (4×1 system)
export const POINTS_ARTIST = 1;
export const POINTS_TITLE = 1;
export const POINTS_YEAR_EXACT = 1;
export const POINTS_TIMELINE = 1;

// Game defaults
export const DEFAULT_ROUNDS = 5;
export const DEFAULT_MAX_PLAYERS = 4;
export const DEFAULT_MAX_POINTS = 4;

// Timeline
export const TIMELINE_RANGE = { min: MIN_YEAR, max: MAX_YEAR };
