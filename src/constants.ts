// ─── Game Constants ───

export const MIN_YEAR = 1960;
export const MAX_YEAR = 2024;
export const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020] as const;

// Scoring
export const POINTS_ARTIST = 150;
export const POINTS_TITLE = 150;
export const POINTS_YEAR_MAX = 200;
export const YEAR_PENALTY_PER_YEAR = 5;

// Game defaults
export const DEFAULT_ROUNDS = 5;
export const DEFAULT_MAX_PLAYERS = 4;
export const DEFAULT_MAX_POINTS = 1000;

// Timeline
export const TIMELINE_RANGE = { min: MIN_YEAR, max: MAX_YEAR };
