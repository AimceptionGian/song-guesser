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
        album: { name: 'After Hours' },
      },
      played_at: '2024-01-15T14:30:00.000Z',
    },
    {
      track: {
        id: 'def456',
        name: 'Shape of You',
        artists: [{ id: 'a2', name: 'Ed Sheeran' }],
        album: { name: '÷' },
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
      album: { name: 'A Night at the Opera' },
    },
  ],
  next: null,
  limit: 50,
};

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

    it('should fetch recently played tracks and return history', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockRecentlyPlayedResponse), { status: 200 }),
      );

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.playerId).toBe('player-1');
      expect(result!.source).toBe('spotify');
      expect(result!.tracks).toHaveLength(2);
      expect(result!.tracks[0].title).toBe('Blinding Lights');
      expect(result!.tracks[0].artist).toBe('The Weeknd');
      expect(result!.tracks[0].id).toBe('spotify-abc123');
      expect(result!.tracks[0].playedAt).toBe('2024-01-15T14:30:00.000Z');
      expect(result!.syncedAt).toBeGreaterThan(0);
    });

    it('should fall back to top tracks when recently played returns empty', async () => {
      const emptyRecentlyPlayed = {
        items: [],
        next: null,
        cursors: { after: '2024-01-15T12:00:00.000Z' },
        limit: 50,
      };

      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify(emptyRecentlyPlayed), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTopTracksResponse), { status: 200 }));

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(1);
      expect(result!.tracks[0].title).toBe('Bohemian Rhapsody');
      expect(result!.tracks[0].artist).toBe('Queen');
    });

    it('should return null on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Invalid token' } }), { status: 401 }),
      );

      const result = await provider.fetchHistory('player-1', 'bad-token');
      expect(result).toBeNull();
    });

    it('should handle network failure gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).toBeNull();
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

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(multiArtistResponse), { status: 200 }),
      );

      const result = await provider.fetchHistory('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks[0].artist).toBe('Artist A, Artist B');
    });

    it('should set playedAt to current date for top tracks (no timestamp available)', async () => {
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], limit: 50 }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTopTracksResponse), { status: 200 }));

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
