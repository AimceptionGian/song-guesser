import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JamendoCatalogProvider } from '../jamendo-catalog-provider';

const mockTrack = {
  id: '123456',
  name: 'Get Lucky',
  duration: 369,
  artist_name: 'Daft Punk',
  artist_id: '789',
  album_name: 'Random Access Memories',
  album_id: '456',
  releasedate: '2013-05-17',
  genre: 'Funk',
  audiodownload: 'https://mp3d.jamendo.com/download/123456.mp3',
  audiodownload_allowed: true,
  image: 'https://img.jamendo.com/albums/456/covers/medium.jpg',
};

const mockSearchPayload = {
  headers: { status: 'success', code: 0 },
  results: [
    mockTrack,
    {
      id: '789012',
      name: 'Around the World',
      duration: 420,
      artist_name: 'Daft Punk',
      artist_id: '789',
      album_name: 'Discovery',
      album_id: '789',
      releasedate: '2001-03-12',
      genre: 'Electronic',
      audiodownload: 'https://mp3d.jamendo.com/download/789012.mp3',
      audiodownload_allowed: true,
      image: 'https://img.jamendo.com/albums/789/covers/medium.jpg',
    },
  ],
};

describe('JamendoCatalogProvider', () => {
  let provider: JamendoCatalogProvider;

  beforeEach(() => {
    provider = new JamendoCatalogProvider('test-client-id');
    vi.restoreAllMocks();
  });

  describe('searchTracks', () => {
    it('should return normalized tracks from Jamendo search', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSearchPayload), { status: 200 })
      );

      const results = await provider.searchTracks('Daft Punk');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('jamendo-123456');
      expect(results[0].title).toBe('Get Lucky');
      expect(results[0].artist).toBe('Daft Punk');
      expect(results[0].album).toBe('Random Access Memories');
      expect(results[0].year).toBe(2013);
      expect(results[0].genre).toBe('Funk');
      expect(results[0].previewUrl).toBe('https://mp3d.jamendo.com/download/123456.mp3');
      expect(results[0].coverUrl).toBe('https://img.jamendo.com/albums/456/covers/medium.jpg');
    });

    it('should handle empty search results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ headers: { status: 'success', code: 0 }, results: [] }), { status: 200 })
      );

      const results = await provider.searchTracks('xxxxxxxxxx');
      expect(results).toHaveLength(0);
    });

    it('should handle API errors gracefully', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 503 })
      );

      const results = await provider.searchTracks('test');
      expect(results).toEqual([]);
    });

    it('should handle network failures', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const results = await provider.searchTracks('test');
      expect(results).toEqual([]);
    });
  });

  describe('getTrack', () => {
    it('should return a single track', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          headers: { status: 'success', code: 0 },
          results: [mockTrack],
        }), { status: 200 })
      );

      const track = await provider.getTrack('jamendo-123456');

      expect(track).not.toBeNull();
      expect(track!.title).toBe('Get Lucky');
      expect(track!.artist).toBe('Daft Punk');
      expect(track!.previewUrl).toBe('https://mp3d.jamendo.com/download/123456.mp3');
    });

    it('should strip "jamendo-" prefix before calling API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          headers: { status: 'success', code: 0 },
          results: [mockTrack],
        }), { status: 200 })
      );

      await provider.getTrack('123456');

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('&id=123456');
    });

    it('should return null for non-existent track', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ headers: { status: 'success', code: 0 }, results: [] }), { status: 200 })
      );

      const track = await provider.getTrack('999999999');
      expect(track).toBeNull();
    });
  });

  describe('getPreviewUrl', () => {
    it('should return preview URL from track data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          headers: { status: 'success', code: 0 },
          results: [mockTrack],
        }), { status: 200 })
      );

      const url = await provider.getPreviewUrl('jamendo-123456');
      expect(url).toBe('https://mp3d.jamendo.com/download/123456.mp3');
    });

    it('should return null if track has no preview', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({
          headers: { status: 'success', code: 0 },
          results: [{
            ...mockTrack,
            audiodownload_allowed: false,
            audiodownload: '',
          }],
        }), { status: 200 })
      );

      const url = await provider.getPreviewUrl('jamendo-123456');
      expect(url).toBeNull();
    });
  });

  describe('genre mapping', () => {
    it('should map various Jamendo genres to normalized values', async () => {
      const testCases = [
        { input: 'Rock', expected: 'Rock' },
        { input: 'Hip-Hop', expected: 'HipHop' },
        { input: 'Electronic', expected: 'Electronic' },
        { input: 'R&B', expected: 'RAndB' },
        { input: 'UnknownGenre', expected: 'UnknownGenre' },
        { input: '', expected: 'Pop' },
      ];

      for (const { input, expected } of testCases) {
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({
            headers: { status: 'success', code: 0 },
            results: [{ ...mockTrack, genre: input }],
          }), { status: 200 })
        );

        const [track] = await provider.searchTracks('test');
        expect(track.genre).toBe(expected);
        vi.restoreAllMocks();
      }
    });
  });
});