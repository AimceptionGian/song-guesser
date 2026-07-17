import { getOriginalYear, enrichTrackYears, __resetSpotifyYearCaches } from '../spotify-year-service';
import type { CatalogTrack } from '../../adapters/catalog-provider';
import type { Env } from '../../env';

function makeSearchResponse(items: Array<{ artist: string; albumType: string; releaseDate: string }>) {
  return {
    tracks: {
      items: items.map((i) => ({
        name: 'Song',
        artists: [{ name: i.artist }],
        album: { name: 'Album', album_type: i.albumType, release_date: i.releaseDate },
      })),
    },
  };
}

function mockFetchOnce(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status }) as unknown as Response
  );
}

describe('spotify-year-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetSpotifyYearCaches();
  });

  describe('getOriginalYear', () => {
    it('returns the earliest non-compilation year', async () => {
      mockFetchOnce(200, makeSearchResponse([
        { artist: 'Michael Jackson', albumType: 'compilation', releaseDate: '2009-01-01' },
        { artist: 'Michael Jackson', albumType: 'album', releaseDate: '1982-11-30' },
        { artist: 'Michael Jackson', albumType: 'album', releaseDate: '2008-02-11' },
      ]));

      const year = await getOriginalYear('Michael Jackson', 'Billie Jean', 'token');
      expect(year).toBe(1982);
    });

    it('ignores tracks from other artists', async () => {
      mockFetchOnce(200, makeSearchResponse([
        { artist: 'Some Cover Band', albumType: 'album', releaseDate: '1970-01-01' },
        { artist: 'Michael Jackson', albumType: 'album', releaseDate: '1982-11-30' },
      ]));

      const year = await getOriginalYear('Michael Jackson', 'Billie Jean', 'token');
      expect(year).toBe(1982);
    });

    it('returns null when nothing matches', async () => {
      mockFetchOnce(200, makeSearchResponse([]));
      const year = await getOriginalYear('Unknown', 'Nothing', 'token');
      expect(year).toBeNull();
    });

    it('returns null on API failure without caching it', async () => {
      mockFetchOnce(429, {});
      expect(await getOriginalYear('A', 'B', 'token')).toBeNull();

      // Second call should retry (not cached) and succeed
      mockFetchOnce(200, makeSearchResponse([{ artist: 'A', albumType: 'album', releaseDate: '1999' }]));
      expect(await getOriginalYear('A', 'B', 'token')).toBe(1999);
    });

    it('caches successful lookups', async () => {
      const spy = mockFetchOnce(200, makeSearchResponse([{ artist: 'A', albumType: 'album', releaseDate: '1999' }]));
      await getOriginalYear('A', 'B', 'token');
      await getOriginalYear('A', 'B', 'token');
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('enrichTrackYears', () => {
    const track: CatalogTrack = {
      id: 'deezer-1', title: 'Billie Jean', artist: 'Michael Jackson',
      album: 'Compilation', year: 2009, genre: 'Pop', previewUrl: 'https://x/p.mp3', coverUrl: null,
    };

    it('returns tracks unchanged when no credentials are configured', async () => {
      const result = await enrichTrackYears([track], {} as Env);
      expect(result[0].year).toBe(2009);
    });

    it('replaces the year when Spotify knows better', async () => {
      const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' } as Env;
      vi.spyOn(globalThis, 'fetch')
        // token request
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 't', token_type: 'Bearer', expires_in: 3600 }), { status: 200 }) as unknown as Response)
        // search request
        .mockResolvedValueOnce(new Response(JSON.stringify(makeSearchResponse([
          { artist: 'Michael Jackson', albumType: 'album', releaseDate: '1982-11-30' },
        ])), { status: 200 }) as unknown as Response);

      const result = await enrichTrackYears([track], env);
      expect(result[0].year).toBe(1982);
    });

    it('keeps the provider year when the lookup fails', async () => {
      const env = { SPOTIFY_CLIENT_ID: 'id', SPOTIFY_CLIENT_SECRET: 'secret' } as Env;
      vi.spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 't', token_type: 'Bearer', expires_in: 3600 }), { status: 200 }) as unknown as Response)
        .mockResolvedValueOnce(new Response('{}', { status: 500 }) as unknown as Response);

      const result = await enrichTrackYears([track], env);
      expect(result[0].year).toBe(2009);
    });
  });
});
