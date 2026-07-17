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
  const artistCorrect = submission.guessedArtist.trim().toLowerCase() === correctArtist.trim().toLowerCase();
  const titleCorrect = submission.guessedTitle.trim().toLowerCase() === correctTitle.trim().toLowerCase();
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