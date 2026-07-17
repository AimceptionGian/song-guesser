import { CatalogService } from '../catalog-service';

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Fresh instance per test
    service = new CatalogService();
  });

  it('should return list of available providers', () => {
    const providers = service.getAvailableProviders();
    expect(providers).toContain('itunes');
    expect(providers).toContain('deezer');
    expect(providers).toContain('mock-catalog');
    expect(providers).toHaveLength(3);
  });

  it('should return mock provider directly', () => {
    const mock = service.getMockProvider();
    expect(mock.name).toBe('mock-catalog');
  });

  it('should return primary provider by default', () => {
    const primary = service.getPrimaryProvider();
    expect(primary.name).toBe('itunes');
  });

  it('should get named provider', () => {
    const mock = service.getProvider('mock-catalog');
    expect(mock.name).toBe('mock-catalog');
  });

  it('should fall back to deezer when itunes fails', async () => {
    vi.spyOn(service.getProvider('itunes'), 'searchTracks').mockRejectedValueOnce(new Error('429'));
    const deezerSpy = vi.spyOn(service.getProvider('deezer'), 'searchTracks').mockResolvedValueOnce([
      { id: 'deezer-1', title: 'Deezer Song', artist: 'Deezer Artist', album: 'Deezer Album', year: 1999, genre: 'Pop', previewUrl: 'https://example.com/p.mp3', coverUrl: null },
    ]);

    const results = await service.searchTracks('anything');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('deezer-1');
    expect(deezerSpy).toHaveBeenCalledOnce();
  });

  it('should fall back to mock when both real providers return empty', async () => {
    vi.spyOn(service.getProvider('itunes'), 'searchTracks').mockResolvedValueOnce([]);
    vi.spyOn(service.getProvider('deezer'), 'searchTracks').mockResolvedValueOnce([]);
    // Mock should have data
    const mockSpy = vi.spyOn(service.getMockProvider(), 'searchTracks').mockResolvedValueOnce([
      { id: 'm1', title: 'Mock Song', artist: 'Mock Artist', album: 'Mock Album', year: 2000, genre: 'Pop', previewUrl: null, coverUrl: null },
    ]);

    const results = await service.searchTracks('anything');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
    expect(mockSpy).toHaveBeenCalledOnce();
  });

  it('should fall back to mock when both real providers throw', async () => {
    vi.spyOn(service.getProvider('itunes'), 'searchTracks').mockRejectedValueOnce(new Error('API down'));
    vi.spyOn(service.getProvider('deezer'), 'searchTracks').mockRejectedValueOnce(new Error('API down'));
    const mockSpy = vi.spyOn(service.getMockProvider(), 'searchTracks').mockResolvedValueOnce([
      { id: 'm1', title: 'Mock Song', artist: 'Mock Artist', album: 'Mock Album', year: 2000, genre: 'Pop', previewUrl: null, coverUrl: null },
    ]);

    const results = await service.searchTracks('anything');
    expect(results).toHaveLength(1);
    expect(mockSpy).toHaveBeenCalledOnce();
  });

  it('should route deezer-prefixed IDs to the deezer provider for getTrack', async () => {
    const itunesSpy = vi.spyOn(service.getProvider('itunes'), 'getTrack');
    const deezerSpy = vi.spyOn(service.getProvider('deezer'), 'getTrack').mockResolvedValueOnce(
      { id: 'deezer-42', title: 'Deezer Song', artist: 'Deezer Artist', album: 'Deezer Album', year: 1999, genre: 'Pop', previewUrl: 'https://example.com/p.mp3', coverUrl: null },
    );

    const track = await service.getTrack('deezer-42');
    expect(track!.id).toBe('deezer-42');
    expect(deezerSpy).toHaveBeenCalledOnce();
    expect(itunesSpy).not.toHaveBeenCalled();
  });

  it('should route mock IDs directly to mock provider', async () => {
    const deezerSpy = vi.spyOn(service.getPrimaryProvider(), 'getTrack');

    const track = await service.getTrack('m1');
    expect(track).not.toBeNull();
    expect(track!.id).toBe('m1');
    expect(deezerSpy).not.toHaveBeenCalled();
  });
});