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

describe('calculateFullScore — 4×1 point system', () => {
  it('should award 4 points for a perfectly correct guess (no existing cards)', () => {
    const result = calculateFullScore(makeSubmission(), CORRECT_ARTIST, CORRECT_TITLE, CORRECT_YEAR, []);

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(true);
    expect(result.yearExact).toBe(true);
    expect(result.timelineCorrect).toBe(true);
    expect(result.yearDiff).toBe(0);
    expect(result.breakdown.artistPoints).toBe(1);
    expect(result.breakdown.titlePoints).toBe(1);
    expect(result.breakdown.yearPoints).toBe(1);
    expect(result.breakdown.timelinePoints).toBe(1);
    expect(result.points).toBe(4);
  });

  it('should award 0 points for a completely wrong guess', () => {
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
    expect(result.yearExact).toBe(false);
    expect(result.timelineCorrect).toBe(false);
    expect(result.yearDiff).toBe(68);
    expect(result.breakdown.artistPoints).toBe(0);
    expect(result.breakdown.titlePoints).toBe(0);
    expect(result.breakdown.yearPoints).toBe(0);
    expect(result.breakdown.timelinePoints).toBe(0);
    expect(result.points).toBe(0);
  });

  it('should handle case-insensitive artist matching', () => {
    const result = calculateFullScore(
      makeSubmission({ guessedArtist: 'the beatles' }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.points).toBe(4); // all still correct
  });

  it('should handle case-insensitive title matching', () => {
    const result = calculateFullScore(
      makeSubmission({ guessedTitle: 'hey jude' }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.titleCorrect).toBe(true);
    expect(result.points).toBe(4);
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
    expect(result.points).toBe(4);
  });

  it('should award 1 point when only artist is correct', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: CORRECT_ARTIST,
        guessedTitle: 'Wrong Title',
        guessedYear: 1999,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(false);
    expect(result.yearExact).toBe(false);
    expect(result.timelineCorrect).toBe(false);
    expect(result.breakdown.artistPoints).toBe(1);
    expect(result.breakdown.titlePoints).toBe(0);
    expect(result.breakdown.yearPoints).toBe(0);
    expect(result.breakdown.timelinePoints).toBe(0);
    expect(result.points).toBe(1);
  });

  it('should award 2 points for artist + title but wrong year', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: CORRECT_ARTIST,
        guessedTitle: CORRECT_TITLE,
        guessedYear: 1999,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(true);
    expect(result.yearExact).toBe(false);
    expect(result.timelineCorrect).toBe(false);
    expect(result.points).toBe(2);
  });

  describe('timeline placement with existing cards', () => {
    it('should award timeline point when guessed year is in correct bucket (after 1960, before 1975)', () => {
      // Existing correct years: [1960, 1975]
      // Correct bucket for 1968: between 1960 and 1975 → bucket 1
      // Guessed 1965 → also bucket 1 → correct
      const result = calculateFullScore(
        makeSubmission({ guessedYear: 1965 }),
        CORRECT_ARTIST,
        CORRECT_TITLE,
        CORRECT_YEAR,
        [1960, 1975]
      );

      expect(result.yearExact).toBe(false);
      expect(result.timelineCorrect).toBe(true);
      expect(result.breakdown.timelinePoints).toBe(1);
      expect(result.breakdown.yearPoints).toBe(0);
      expect(result.points).toBe(2); // artist + title + timeline
    });

    it('should NOT award timeline point when guessed year is in wrong bucket', () => {
      // Existing correct years: [1960, 1975]
      // Correct bucket for 1968: between 1960 and 1975 → bucket 1
      // Guessed 1980 → bucket 2 → wrong
      const result = calculateFullScore(
        makeSubmission({ guessedYear: 1980 }),
        CORRECT_ARTIST,
        CORRECT_TITLE,
        CORRECT_YEAR,
        [1960, 1975]
      );

      expect(result.timelineCorrect).toBe(false);
      expect(result.breakdown.timelinePoints).toBe(0);
      expect(result.points).toBe(2); // only artist + title
    });

    it('should handle first existing year bucket (before all)', () => {
      // Existing correct: [1970, 1980]. Correct year 1968 → bucket 0 (before 1970)
      // Guess 1965 → bucket 0 → correct
      const result = calculateFullScore(
        makeSubmission({ guessedYear: 1965 }),
        CORRECT_ARTIST,
        CORRECT_TITLE,
        1968,
        [1970, 1980]
      );

      expect(result.timelineCorrect).toBe(true);
      expect(result.breakdown.timelinePoints).toBe(1);
      expect(result.points).toBe(4);
    });

    it('should handle last existing year bucket (after all)', () => {
      // Existing correct: [1950, 1960]. Correct year 1970 → bucket 2 (after both)
      // Guess 1980 → bucket 2 → correct
      const result = calculateFullScore(
        makeSubmission({ guessedYear: 1980 }),
        CORRECT_ARTIST,
        CORRECT_TITLE,
        1970,
        [1950, 1960]
      );

      expect(result.timelineCorrect).toBe(true);
      expect(result.breakdown.timelinePoints).toBe(1);
      expect(result.points).toBe(4);
    });
  });

  it('should award 1 point for exact year when timeline bucket already correct', () => {
    // Existing correct years: [1960, 1975]
    // Correct year 1968 → bucket 1. Guess 1968 → bucket 1 AND exact match
    const result = calculateFullScore(
      makeSubmission({ guessedYear: 1968 }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR,
      [1960, 1975]
    );

    expect(result.yearExact).toBe(true);
    expect(result.timelineCorrect).toBe(true);
    expect(result.breakdown.yearPoints).toBe(1);
    expect(result.breakdown.timelinePoints).toBe(1);
    expect(result.points).toBe(4); // all 4 points
  });
});
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