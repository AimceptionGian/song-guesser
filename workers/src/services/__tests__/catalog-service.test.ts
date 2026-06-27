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
    expect(providers).toContain('deezer');
    expect(providers).toContain('mock-catalog');
    expect(providers).toHaveLength(2);
  });

  it('should return mock provider directly', () => {
    const mock = service.getMockProvider();
    expect(mock.name).toBe('mock-catalog');
  });

  it('should return primary provider by default', () => {
    const primary = service.getPrimaryProvider();
    expect(primary.name).toBe('deezer');
  });

  it('should get named provider', () => {
    const mock = service.getProvider('mock-catalog');
    expect(mock.name).toBe('mock-catalog');
  });

  it('should fall back to mock when Deezer search returns empty', async () => {
    // Make Deezer return empty
    vi.spyOn(service.getPrimaryProvider(), 'searchTracks').mockResolvedValueOnce([]);
    // Mock should have data
    const mockSpy = vi.spyOn(service.getMockProvider(), 'searchTracks').mockResolvedValueOnce([
      { id: 'm1', title: 'Mock Song', artist: 'Mock Artist', album: 'Mock Album', year: 2000, genre: 'Pop', previewUrl: null, coverUrl: null },
    ]);

    const results = await service.searchTracks('anything');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
    expect(mockSpy).toHaveBeenCalledOnce();
  });

  it('should fall back to mock when Deezer throws', async () => {
    vi.spyOn(service.getPrimaryProvider(), 'searchTracks').mockRejectedValueOnce(new Error('API down'));
    const mockSpy = vi.spyOn(service.getMockProvider(), 'searchTracks').mockResolvedValueOnce([
      { id: 'm1', title: 'Mock Song', artist: 'Mock Artist', album: 'Mock Album', year: 2000, genre: 'Pop', previewUrl: null, coverUrl: null },
    ]);

    const results = await service.searchTracks('anything');
    expect(results).toHaveLength(1);
    expect(mockSpy).toHaveBeenCalledOnce();
  });

  it('should route mock IDs directly to mock provider', async () => {
    const deezerSpy = vi.spyOn(service.getPrimaryProvider(), 'getTrack');

    const track = await service.getTrack('m1');
    expect(track).not.toBeNull();
    expect(track!.id).toBe('m1');
    expect(deezerSpy).not.toHaveBeenCalled();
  });
});