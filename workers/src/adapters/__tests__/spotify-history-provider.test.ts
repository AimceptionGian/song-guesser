import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpotifyHistoryProvider } from '../spotify-history-provider';
import type { HistoryTrack } from '../history-provider';

const mockRecentlyPlayedResponse = {
  items: [
    {
      track: {
        id: 'abc123',
        name: 'Blinding Lights',
        artists: [{ id: 'a1', name: 'The Weeknd' }],
        album: { name: 'After Hours', release_date: '2020-03-20' },
      },
      played_at: '2024-01-15T14:30:00.000Z',
    },
    {
      track: {
        id: 'def456',
        name: 'Shape of You',
        artists: [{ id: 'a2', name: 'Ed Sheeran' }],
        album: { name: '÷', release_date: '2017-03-03' },
      },
      played_at: '2024-01-15T14:25:00.000Z',
    },
  ],
  next: null,
  cursors: { after: '2024-01-15T14:30:00.000Z' },
  limit: 50,
};

const mockTopTracksResponse = {
  items: [
    {
      id: 'ghi789',
      name: 'Bohemian Rhapsody',
      artists: [{ id: 'a3', name: 'Queen' }],
      album: { name: 'A Night at the Opera', release_date: '1975-11-21' },
    },
  ],
  next: null,
  limit: 50,
};

const emptyListResponse = { items: [], next: null, limit: 50 };

const emptySavedResponse = { items: [], total: 0, limit: 50 };

/**
 * Route Spotify requests by URL. fetchHistory hits several endpoints in
 * parallel; the top-tracks body is served for the first medium_term page
 * only (every other range/page is empty), so counts stay easy to reason
 * about. Liked songs default to empty.
 */
function mockSpotifyResponses(
  recentBody: unknown,
  topBody: unknown,
  recentStatus = 200,
  topStatus = 200,
  savedBody: unknown = emptySavedResponse,
  savedStatus = 200,
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const respond = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status });
    if (url.includes('/me/player/recently-played')) return respond(recentBody, recentStatus);
    if (url.includes('/me/top/tracks')) {
      const isFirstMediumPage = url.includes('time_range=medium_term') && url.includes('offset=0');
      return respond(topStatus === 200 && !isFirstMediumPage ? emptyListResponse : topBody, topStatus);
    }
    if (url.includes('/me/tracks')) return respond(savedBody, savedStatus);
    throw new Error(`unexpected fetch ${url}`);
  });
}

describe('SpotifyHistoryProvider', () => {
  let provider: SpotifyHistoryProvider;

  beforeEach(() => {
    provider = new SpotifyHistoryProvider();
    vi.restoreAllMocks();
  });

  describe('fetchHistory', () => {
    it('should return null when no access token provided', async () => {
      const result = await provider.fetchHistory('player-1');
      expect(result).toBeNull();
    });

    it('should return null when token is empty', async () => {
      const result = await provider.fetchHistory('player-1', '');
      expect(result).toBeNull();
    });

    it('should fetch recently played tracks with release years', async () => {
      mockSpotifyResponses(mockRecentlyPlayedResponse, emptyListResponse);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.playerId).toBe('player-1');
      expect(result!.source).toBe('spotify');
      expect(result!.tracks).toHaveLength(2);
      expect(result!.tracks[0].title).toBe('Blinding Lights');
      expect(result!.tracks[0].artist).toBe('The Weeknd');
      expect(result!.tracks[0].id).toBe('spotify-abc123');
      expect(result!.tracks[0].playedAt).toBe('2024-01-15T14:30:00.000Z');
      expect(result!.tracks[0].year).toBe(2020);
      expect(result!.tracks[0].isTop).toBeUndefined();
      expect(result!.syncedAt).toBeGreaterThan(0);
    });

    it('should merge recently played and top tracks, flagging top tracks', async () => {
      mockSpotifyResponses(mockRecentlyPlayedResponse, mockTopTracksResponse);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(3);

      const top = result!.tracks.find((t) => t.id === 'spotify-ghi789');
      expect(top?.isTop).toBe(true);
      expect(top?.year).toBe(1975);
    });

    it('should dedupe a track that is both recently played and a top track (top wins)', async () => {
      const overlappingTop = {
        items: [
          {
            id: 'abc123',
            name: 'Blinding Lights',
            artists: [{ id: 'a1', name: 'The Weeknd' }],
            album: { name: 'After Hours', release_date: '2020-03-20' },
          },
        ],
        next: null,
        limit: 50,
      };
      mockSpotifyResponses(mockRecentlyPlayedResponse, overlappingTop);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result!.tracks).toHaveLength(2);
      expect(result!.tracks.find((t) => t.id === 'spotify-abc123')?.isTop).toBe(true);
    });

    it('should still return top tracks when recently played returns empty', async () => {
      mockSpotifyResponses(emptyListResponse, mockTopTracksResponse);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(1);
      expect(result!.tracks[0].title).toBe('Bohemian Rhapsody');
      expect(result!.tracks[0].artist).toBe('Queen');
    });

    it('should return null when every endpoint errors', async () => {
      const invalid = { error: { message: 'Invalid token' } };
      mockSpotifyResponses(invalid, invalid, 401, 401, invalid, 401);

      const result = await provider.fetchHistory('player-1', 'bad-token');
      expect(result).toBeNull();
    });

    it('should handle network failure gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).toBeNull();
    });

    it('should fetch top tracks for every time range', async () => {
      const fetchSpy = mockSpotifyResponses(emptyListResponse, mockTopTracksResponse);

      await provider.fetchHistory('player-1', 'valid-token');

      const urls = fetchSpy.mock.calls.map(([input]) => String(input));
      for (const range of ['short_term', 'medium_term', 'long_term']) {
        expect(urls.some((u) => u.includes('/me/top/tracks') && u.includes(`time_range=${range}`))).toBe(true);
      }
    });

    it('should include liked songs and page through them', async () => {
      const likedPage = (offset: number) => ({
        items: Array.from({ length: 50 }, (_, i) => ({
          added_at: '2024-02-01T00:00:00.000Z',
          track: {
            id: `liked${offset + i}`,
            name: `Liked ${offset + i}`,
            artists: [{ id: 'x', name: 'Someone' }],
            album: { name: 'A', release_date: '2010-01-01' },
          },
        })),
        total: 120,
        limit: 50,
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/me/tracks')) {
          const offset = Number(new URL(url).searchParams.get('offset'));
          return new Response(JSON.stringify(likedPage(offset)), { status: 200 });
        }
        return new Response(JSON.stringify(emptyListResponse), { status: 200 });
      });

      const result = await provider.fetchHistory('player-1', 'valid-token');
      // offsets 0, 50, 100 → 150 entries, all distinct songs
      expect(result!.tracks).toHaveLength(150);
      expect(result!.tracks.every((t) => !t.isTop)).toBe(true);
    });

    it('should still sync when liked songs are not authorised (older token)', async () => {
      mockSpotifyResponses(
        mockRecentlyPlayedResponse, emptyListResponse, 200, 200,
        { error: { message: 'Insufficient client scope' } }, 403,
      );

      const result = await provider.fetchHistory('player-1', 'old-token');
      expect(result!.tracks).toHaveLength(2);
    });

    it('should merge different releases of the same song into one entry', async () => {
      const remaster = {
        items: [{
          id: 'remaster-id',
          name: 'Blinding Lights - Radio Edit',
          artists: [{ id: 'a1', name: 'The Weeknd' }],
          album: { name: 'Single', release_date: '2019-11-29' },
        }],
        next: null,
        limit: 50,
      };
      mockSpotifyResponses(mockRecentlyPlayedResponse, remaster);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      const blinding = result!.tracks.filter((t) => t.title.startsWith('Blinding Lights'));
      expect(blinding).toHaveLength(1);
      expect(blinding[0].isTop).toBe(true);
    });

    it('should handle multi-artist tracks', async () => {
      const multiArtistResponse = {
        items: [
          {
            track: {
              id: 'multi1',
              name: 'Something',
              artists: [
                { id: 'a1', name: 'Artist A' },
                { id: 'a2', name: 'Artist B' },
              ],
              album: { name: 'Collab Album' },
            },
            played_at: '2024-01-15T10:00:00.000Z',
          },
        ],
        next: null,
        cursors: { after: '2024-01-15T10:00:00.000Z' },
        limit: 50,
      };

      mockSpotifyResponses(multiArtistResponse, emptyListResponse);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks[0].artist).toBe('Artist A, Artist B');
    });

    it('should set playedAt to current date for top tracks (no timestamp available)', async () => {
      mockSpotifyResponses(emptyListResponse, mockTopTracksResponse);

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(1);
      expect(result!.tracks[0].id).toBe('spotify-ghi789');
    });
  });

  describe('importTracks', () => {
    it('should import tracks without source property', async () => {
      const tracks: Omit<HistoryTrack, 'source'>[] = [
        {
          id: 'upload-1',
          title: 'My Song',
          artist: 'My Band',
          album: 'My Album',
          playedAt: '2024-06-01T12:00:00.000Z',
        },
      ];

      const result = await provider.importTracks('player-1', tracks);
      expect(result.playerId).toBe('player-1');
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0].title).toBe('My Song');
      expect(result.tracks[0].source).toBe('upload');
      expect(result.source).toBe('upload');
      expect(result.syncedAt).toBeGreaterThan(0);
    });

    it('should handle empty track list', async () => {
      const result = await provider.importTracks('player-1', []);
      expect(result.playerId).toBe('player-1');
      expect(result.tracks).toHaveLength(0);
    });
  });
});
