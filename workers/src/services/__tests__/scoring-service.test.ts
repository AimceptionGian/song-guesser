import { calculateFullScore } from '../scoring-service';
import type { GuessSubmission } from '../../types';

const CORRECT_ARTIST = 'The Beatles';
const CORRECT_TITLE = 'Hey Jude';
const CORRECT_YEAR = 1968;

function makeSubmission(overrides: Partial<GuessSubmission> = {}): GuessSubmission {
  return {
    playerId: 'player-1',
    cardId: 'card-1',
    guessedArtist: CORRECT_ARTIST,
    guessedTitle: CORRECT_TITLE,
    guessedYear: CORRECT_YEAR,
    ...overrides,
  };
}

describe('calculateFullScore', () => {
  it('should return max points for a perfectly correct guess', () => {
    const result = calculateFullScore(makeSubmission(), CORRECT_ARTIST, CORRECT_TITLE, CORRECT_YEAR);

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(true);
    expect(result.yearDiff).toBe(0);
    expect(result.breakdown.artistPoints).toBe(150);
    expect(result.breakdown.titlePoints).toBe(150);
    expect(result.breakdown.yearPoints).toBe(200);
    expect(result.points).toBe(500);
  });

  it('should return zero points for a completely wrong guess', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: 'Some Wrong Band',
        guessedTitle: 'Wrong Song',
        guessedYear: 1900,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(false);
    expect(result.titleCorrect).toBe(false);
    expect(result.yearDiff).toBe(68);
    expect(result.breakdown.artistPoints).toBe(0);
    expect(result.breakdown.titlePoints).toBe(0);
    expect(result.breakdown.yearPoints).toBe(0);
    expect(result.points).toBe(0);
  });

  it('should apply year penalty correctly', () => {
    // 10 years off → 200 - 10*5 = 150 year points
    const result = calculateFullScore(
      makeSubmission({ guessedYear: 1978 }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.yearDiff).toBe(10);
    expect(result.breakdown.yearPoints).toBe(150);
    expect(result.points).toBe(150 + 150 + 150); // artist + title + year
  });

  it('should floor year points at 0 for extremely wrong years', () => {
    // 50 years off → 200 - 50*5 = -50 → clamped to 0
    const result = calculateFullScore(
      makeSubmission({ guessedYear: 2018 }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.breakdown.yearPoints).toBe(0);
  });

  it('should handle case-insensitive artist matching', () => {
    const result = calculateFullScore(
      makeSubmission({ guessedArtist: 'the beatles' }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
  });

  it('should handle case-insensitive title matching', () => {
    const result = calculateFullScore(
      makeSubmission({ guessedTitle: 'hey jude' }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.titleCorrect).toBe(true);
  });

  it('should handle whitespace around guesses', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: '  The Beatles  ',
        guessedTitle: '  Hey Jude  ',
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(true);
  });

  it('should award only artist points when only artist is correct', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: CORRECT_ARTIST,
        guessedTitle: 'Wrong Title',
        guessedYear: CORRECT_YEAR,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(false);
    expect(result.breakdown.artistPoints).toBe(150);
    expect(result.breakdown.titlePoints).toBe(0);
    expect(result.breakdown.yearPoints).toBe(200);
    expect(result.points).toBe(350);
  });

  it('should award only title points when only title is correct', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: 'Wrong Artist',
        guessedTitle: CORRECT_TITLE,
        guessedYear: CORRECT_YEAR,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(false);
    expect(result.titleCorrect).toBe(true);
    expect(result.breakdown.artistPoints).toBe(0);
    expect(result.breakdown.titlePoints).toBe(150);
    expect(result.breakdown.yearPoints).toBe(200);
    expect(result.points).toBe(350);
  });
});