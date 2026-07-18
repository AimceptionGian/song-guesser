import { calculateFullScore, isCloseMatch, isArtistMatch } from '../scoring-service';
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
    // Existing card at 1950: correct year 1968 → bucket 1, guessed 1900 → bucket 0 → wrong
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: 'Some Wrong Band',
        guessedTitle: 'Wrong Song',
        guessedYear: 1900,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR,
      [1950]
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
    // Existing card at 1970: correct year 1968 → bucket 0, guessed 1999 → bucket 1 → wrong
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: CORRECT_ARTIST,
        guessedTitle: 'Wrong Title',
        guessedYear: 1999,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR,
      [1970]
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
    // Existing card at 1970: correct year 1968 → bucket 0, guessed 1999 → bucket 1 → wrong
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: CORRECT_ARTIST,
        guessedTitle: CORRECT_TITLE,
        guessedYear: 1999,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR,
      [1970]
    );

    expect(result.artistCorrect).toBe(true);
    expect(result.titleCorrect).toBe(true);
    expect(result.yearExact).toBe(false);
    expect(result.timelineCorrect).toBe(false);
    expect(result.points).toBe(2);
  });

  it('should always award the timeline point for the first card (empty timeline)', () => {
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: 'Wrong',
        guessedTitle: 'Wrong',
        guessedYear: 1900,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      CORRECT_YEAR,
      []
    );

    expect(result.yearExact).toBe(false);
    expect(result.timelineCorrect).toBe(true);
    expect(result.breakdown.timelinePoints).toBe(1);
    expect(result.points).toBe(1);
  });

  it('should judge the bucket against ALL placed cards, not just correct ones', () => {
    // Card at 1966 already on the timeline (however it was placed).
    // Correct year 1985 → after 1966; guessed 1988 → also after 1966 → point earned.
    const result = calculateFullScore(
      makeSubmission({
        guessedArtist: 'Wrong',
        guessedTitle: 'Wrong',
        guessedYear: 1988,
      }),
      CORRECT_ARTIST,
      CORRECT_TITLE,
      1985,
      [1966]
    );

    expect(result.timelineCorrect).toBe(true);
    expect(result.breakdown.timelinePoints).toBe(1);
    expect(result.points).toBe(1);
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
      expect(result.points).toBe(3); // artist + title + timeline
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
      expect(result.points).toBe(3);
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
      expect(result.points).toBe(3);
    });
  });

  describe('fuzzy matching', () => {
    it('accepts small typos', () => {
      expect(isCloseMatch('Quen', 'Queen')).toBe(true);
      expect(isCloseMatch('Bohemian Rapsody', 'Bohemian Rhapsody')).toBe(true);
      expect(isCloseMatch('Smells like teen spirit', 'Smells Like Teen Spirit')).toBe(true);
    });

    it('ignores diacritics, punctuation and & vs and', () => {
      expect(isCloseMatch('beyonce', 'Beyoncé')).toBe(true);
      expect(isCloseMatch('Guns and Roses', "Guns N' Roses")).toBe(true);
    });

    it('ignores parentheticals and feat credits in the target', () => {
      expect(isCloseMatch('Get Lucky', 'Get Lucky (Radio Edit - feat. Pharrell Williams)')).toBe(true);
      expect(isCloseMatch('Should I Stay or Should I Go', 'Should I Stay or Should I Go (Remastered)')).toBe(true);
    });

    it('accepts a substantial substring', () => {
      expect(isCloseMatch('Blinding', 'Blinding Lights')).toBe(true);
    });

    it('rejects clearly wrong answers', () => {
      expect(isCloseMatch('Nirvana', 'Queen')).toBe(false);
      expect(isCloseMatch('abc', 'Bohemian Rhapsody')).toBe(false);
      expect(isCloseMatch('', 'Queen')).toBe(false);
    });

    it('matches any single artist of a multi-artist credit', () => {
      expect(isArtistMatch('Justin Bieber', 'The Kid LAROI, Justin Bieber')).toBe(true);
      expect(isArtistMatch('kid laroi', 'The Kid LAROI, Justin Bieber')).toBe(true);
      expect(isArtistMatch('Drake', 'The Kid LAROI, Justin Bieber')).toBe(false);
    });

    it('flows through calculateFullScore', () => {
      const result = calculateFullScore(
        makeSubmission({ guessedArtist: 'the beatls', guessedTitle: 'hey jude' }),
        CORRECT_ARTIST,
        CORRECT_TITLE,
        CORRECT_YEAR,
        []
      );
      expect(result.artistCorrect).toBe(true);
      expect(result.titleCorrect).toBe(true);
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