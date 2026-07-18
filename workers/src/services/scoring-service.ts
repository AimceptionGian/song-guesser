import type { GuessSubmission, ScoreResult } from '../types';

/**
 * Calculate which "bucket" a year falls into relative to sorted existing years.
 * Returns 0 if before the first, 1 if between first and second, etc.
 * Returns the index of the bucket.
 */
function getTimelineBucket(year: number, sortedYears: number[]): number {
  for (let i = 0; i < sortedYears.length; i++) {
    if (year < sortedYears[i]) return i;
  }
  return sortedYears.length;
}

// ─── Fuzzy answer matching ───
// Party-game-friendly: typos, missing accents, "&" vs "and", parentheticals
// like "(Remastered)"/"feat. X", and partial artist credit should all count.

/** Lowercase, strip diacritics/parentheticals/feat-suffixes/punctuation. */
function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s*-\s*(feat|with|ft)\.?\s.*$/i, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * True when the guess is "close enough" to the target:
 * exact after normalization, a substantial substring (≥4 chars),
 * or within ~25% edit distance.
 */
export function isCloseMatch(guess: string, target: string): boolean {
  const g = normalizeAnswer(guess);
  const t = normalizeAnswer(target);
  if (!g || !t) return false;
  if (g === t) return true;
  if (g.length >= 4 && t.includes(g)) return true;
  const dist = levenshtein(g, t);
  return dist <= Math.max(1, Math.floor(Math.max(g.length, t.length) * 0.25));
}

/**
 * Artist match: multi-artist credits ("A, B") count when the guess
 * matches the full credit or any single listed artist.
 */
export function isArtistMatch(guess: string, correctArtist: string): boolean {
  if (isCloseMatch(guess, correctArtist)) return true;
  return correctArtist
    .split(',')
    .map((a) => a.trim())
    .some((a) => a && isCloseMatch(guess, a));
}

/**
 * New 4×1 scoring system:
 * - 1 point: Artist correct
 * - 1 point: Title correct
 * - 1 point: Exact year correct
 * - 1 point: Correct timeline placement relative to player's existing cards
 *
 * existingYears: the actual years of all cards the player already placed
 *   (they all stay visible on the timeline, so they all anchor the buckets).
 * Total: 0–4 points per guess.
 */
export function calculateFullScore(
  submission: GuessSubmission,
  correctArtist: string,
  correctTitle: string,
  correctYear: number,
  existingYears: number[] = []
): ScoreResult {
  const artistCorrect = isArtistMatch(submission.guessedArtist, correctArtist);
  const titleCorrect = isCloseMatch(submission.guessedTitle, correctTitle);
  const yearExact = submission.guessedYear === correctYear;

  // Timeline placement: is guessedYear in the correct bucket?
  // An empty timeline has only one bucket, so the first card is always correct.
  let timelineCorrect = true;
  if (existingYears.length > 0) {
    const sortedExisting = [...existingYears].sort((a, b) => a - b);
    const correctBucket = getTimelineBucket(correctYear, sortedExisting);
    const guessedBucket = getTimelineBucket(submission.guessedYear, sortedExisting);
    timelineCorrect = correctBucket === guessedBucket;
  }

  const artistPoints = artistCorrect ? 1 : 0;
  const titlePoints = titleCorrect ? 1 : 0;
  const yearPoints = yearExact ? 1 : 0;
  const timelinePoints = timelineCorrect ? 1 : 0;

  return {
    points: artistPoints + titlePoints + yearPoints + timelinePoints,
    artistCorrect,
    titleCorrect,
    yearDiff: Math.abs(submission.guessedYear - correctYear),
    yearExact,
    timelineCorrect,
    breakdown: { artistPoints, titlePoints, yearPoints, timelinePoints },
  };
}