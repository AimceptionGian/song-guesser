import { DeezerCatalogProvider } from '../deezer-catalog-provider';

const mockTrackPayload = {
  id: 3135556,
  title: 'Billie Jean',
  link: 'https://www.deezer.com/track/3135556',
  duration: 294,
  rank: 890271,
  explicit_lyrics: false,
  preview: 'https://cdns-preview-xx.dzcdn.net/stream/c-xx.mp3',
  artist: {
    id: 13,
    name: 'Michael Jackson',
    picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/medium.jpg',
  },
  album: {
    id: 123,
    title: 'Thriller',
    cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/medium.jpg',
    cover_big: 'https://e-cdns-images.dzcdn.net/images/cover/big.jpg',
    release_date: '1982-11-29',
  },
};

const mockSearchPayload = {
  data: [
    mockTrackPayload,
    {
      id: 3135557,
      title: 'Beat It',
      preview: 'https://cdns-preview-xx.dzcdn.net/stream/c-yy.mp3',
      artist: { id: 13, name: 'Michael Jackson', picture_medium: '' },
      album: {
        title: 'Thriller',
        cover_medium: '',
        cover_big: '',
        release_date: '1982-11-29',
      },
    },
  ],
  total: 2,
};

describe('DeezerCatalogProvider', () => {
  let provider: DeezerCatalogProvider;

  beforeEach(() => {
    provider = new DeezerCatalogProvider();
    vi.restoreAllMocks();
  });

  describe('searchTracks', () => {
    it('should return normalized tracks from Deezer search', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSearchPayload), { status: 200 })
      );

      const results = await provider.searchTracks('Michael Jackson');

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('deezer-3135556');
      expect(results[0].title).toBe('Billie Jean');
      expect(results[0].artist).toBe('Michael Jackson');
      expect(results[0].album).toBe('Thriller');
      expect(results[0].year).toBe(1982);
      expect(results[0].previewUrl).toBe('https://cdns-preview-xx.dzcdn.net/stream/c-xx.mp3');
      expect(results[0].coverUrl).toBe('https://e-cdns-images.dzcdn.net/images/cover/medium.jpg');
    });

    it('should handle empty search results', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 })
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
        new Response(JSON.stringify(mockTrackPayload), { status: 200 })
      );

      const track = await provider.getTrack('deezer-3135556');

      expect(track).not.toBeNull();
      expect(track!.title).toBe('Billie Jean');
      expect(track!.artist).toBe('Michael Jackson');
      expect(track!.previewUrl).toBe('https://cdns-preview-xx.dzcdn.net/stream/c-xx.mp3');
    });

    it('should strip "deezer-" prefix before calling API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockTrackPayload), { status: 200 })
      );

      await provider.getTrack('3135556');

      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toContain('/track/3135556');
    });

    it('should return null for non-existent track', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(null, { status: 404 })
      );

      const track = await provider.getTrack('999999999');
      expect(track).toBeNull();
    });
  });

  describe('getPreviewUrl', () => {
    it('should return preview URL from track data', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockTrackPayload), { status: 200 })
      );

      const url = await provider.getPreviewUrl('deezer-3135556');
      expect(url).toBe('https://cdns-preview-xx.dzcdn.net/stream/c-xx.mp3');
    });

    it('should return null if track has no preview', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ ...mockTrackPayload, preview: '' }), { status: 200 })
      );

      const url = await provider.getPreviewUrl('deezer-3135556');
      expect(url).toBeNull();
    });
  });

  describe('getChartTracks', () => {
    it('should return normalized chart tracks', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockSearchPayload), { status: 200 })
      );

      const results = await provider.getChartTracks(2);
      expect(results).toHaveLength(2);
      expect(results[0].artist).toBe('Michael Jackson');
    });
  });
});