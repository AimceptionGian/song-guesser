import type { GuessSubmission, ScoreResult, ScoreBreakdown } from '../types';

const POINTS_ARTIST = 150;
const POINTS_TITLE = 150;
const POINTS_YEAR_MAX = 200;
const YEAR_PENALTY_PER_YEAR = 5;

export function calculateFullScore(
  submission: GuessSubmission,
  correctArtist: string,
  correctTitle: string,
  correctYear: number
): ScoreResult {
  const artistCorrect = submission.guessedArtist.trim().toLowerCase() === correctArtist.trim().toLowerCase();
  const titleCorrect = submission.guessedTitle.trim().toLowerCase() === correctTitle.trim().toLowerCase();

  const yearDiff = Math.abs(submission.guessedYear - correctYear);
  const artistPoints = artistCorrect ? POINTS_ARTIST : 0;
  const titlePoints = titleCorrect ? POINTS_TITLE : 0;
  const yearPoints = Math.max(0, POINTS_YEAR_MAX - yearDiff * YEAR_PENALTY_PER_YEAR);

  return {
    points: artistPoints + titlePoints + yearPoints,
    artistCorrect,
    titleCorrect,
    yearDiff,
    breakdown: { artistPoints, titlePoints, yearPoints },
  };
}