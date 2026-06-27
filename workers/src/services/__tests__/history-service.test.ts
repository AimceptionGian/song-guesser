import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryService } from '../history-service';

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new HistoryService();
  });

  describe('getAvailableProviders', () => {
    it('should return spotify-history provider', () => {
      const providers = service.getAvailableProviders();
      expect(providers).toContain('spotify-history');
    });
  });

  describe('hasHistory / getHistory', () => {
    it('should return false for player with no history', () => {
      expect(service.hasHistory('unknown')).toBe(false);
    });

    it('should return true after import', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Song', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      expect(service.hasHistory('player-1')).toBe(true);
    });
  });

  describe('importTracks', () => {
    it('should store imported tracks and return them', async () => {
      const result = await service.importTracks('player-1', [
        { id: 't1', title: 'Test Song', artist: 'Test Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);

      expect(result.playerId).toBe('player-1');
      expect(result.tracks).toHaveLength(1);
      expect(result.tracks[0].source).toBe('upload');

      // Should be retrievable via getHistory
      const cached = service.getHistory('player-1');
      expect(cached).not.toBeUndefined();
      expect(cached!.tracks).toHaveLength(1);
    });
  });

  describe('syncFromSpotify', () => {
    it('should return null when Spotify API fails', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await service.syncFromSpotify('player-1', 'bad-token');
      expect(result).toBeNull();
      expect(service.hasHistory('player-1')).toBe(false);
    });

    it('should cache history after successful sync', async () => {
      const mockResponse = {
        items: [
          {
            track: {
              id: 't1',
              name: 'Song',
              artists: [{ id: 'a1', name: 'Artist' }],
              album: { name: 'Album' },
            },
            played_at: '2024-01-01T00:00:00.000Z',
          },
        ],
        next: null,
        cursors: { after: '2024-01-01T00:00:00.000Z' },
        limit: 50,
      };

      // Need at least 10 tracks to pass the threshold
      const manyItems = Array.from({ length: 10 }, (_, i) => ({
        track: {
          id: `t${i}`,
          name: `Song ${i}`,
          artists: [{ id: `a${i}`, name: `Artist ${i}` }],
          album: { name: `Album ${i}` },
        },
        played_at: `2024-01-01T00:0${i}:00.000Z`,
      }));

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ items: manyItems, limit: 50 }), { status: 200 }),
      );

      const result = await service.syncFromSpotify('player-1', 'valid-token');
      expect(result).not.toBeNull();
      expect(result!.tracks).toHaveLength(10);
      expect(service.hasHistory('player-1')).toBe(true);
    });
  });

  describe('getUniqueArtists', () => {
    it('should return empty array for unknown players', () => {
      const artists = service.getUniqueArtists(['unknown']);
      expect(artists).toHaveLength(0);
    });

    it('should collect unique artists from multiple players', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Song A', artist: 'Artist X', playedAt: '2024-01-01T00:00:00.000Z' },
        { id: 't2', title: 'Song B', artist: 'Artist Y', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      await service.importTracks('player-2', [
        { id: 't3', title: 'Song C', artist: 'Artist X', playedAt: '2024-01-01T00:00:00.000Z' },
        { id: 't4', title: 'Song D', artist: 'Artist Z', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);

      const artists = service.getUniqueArtists(['player-1', 'player-2']);
      expect(artists).toHaveLength(3);
      expect(artists).toContain('Artist X');
      expect(artists).toContain('Artist Y');
      expect(artists).toContain('Artist Z');
    });

    it('should handle multi-artist strings', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Collab', artist: 'Artist A, Artist B', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);

      const artists = service.getUniqueArtists(['player-1']);
      expect(artists).toHaveLength(2);
      expect(artists).toContain('Artist A');
      expect(artists).toContain('Artist B');
    });
  });

  describe('getUniqueTrackIds', () => {
    it('should collect unique track IDs across players', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Song', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      await service.importTracks('player-2', [
        { id: 't1', title: 'Song', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
        { id: 't2', title: 'Song 2', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);

      const ids = service.getUniqueTrackIds(['player-1', 'player-2']);
      expect(ids).toHaveLength(2);
      expect(ids).toContain('t1');
      expect(ids).toContain('t2');
    });
  });

  describe('clearHistory / clearLobbyHistory', () => {
    it('should clear history for a single player', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Song', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      expect(service.hasHistory('player-1')).toBe(true);

      service.clearHistory('player-1');
      expect(service.hasHistory('player-1')).toBe(false);
    });

    it('should clear history for multiple players', async () => {
      await service.importTracks('player-1', [
        { id: 't1', title: 'Song', artist: 'Artist', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);
      await service.importTracks('player-2', [
        { id: 't2', title: 'Song 2', artist: 'Artist 2', playedAt: '2024-01-01T00:00:00.000Z' },
      ]);

      service.clearLobbyHistory(['player-1', 'player-2']);
      expect(service.hasHistory('player-1')).toBe(false);
      expect(service.hasHistory('player-2')).toBe(false);
    });
  });
});
