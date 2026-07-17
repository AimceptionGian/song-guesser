import type { CatalogProvider, CatalogTrack } from '../adapters/catalog-provider';
import { MockCatalogProvider } from '../adapters/mock-catalog-provider';
import { DeezerCatalogProvider } from '../adapters/deezer-catalog-provider';
import { ITunesCatalogProvider } from '../adapters/itunes-catalog-provider';
import { JamendoCatalogProvider } from '../adapters/jamendo-catalog-provider';
import type { Env } from '../env';

/**
 * Provider registry that manages available catalog providers.
 * Allows the API to search across providers and fall back gracefully.
 */
export class CatalogService {
  private providers: Map<string, CatalogProvider> = new Map();
  private primaryProviderName: string;

  constructor(env?: Env) {
    // Register providers
    const mock = new MockCatalogProvider();
    const deezer = new DeezerCatalogProvider();
    const itunes = new ITunesCatalogProvider();

    this.providers.set(mock.name, mock);
    this.providers.set(deezer.name, deezer);
    this.providers.set(itunes.name, itunes);

    // Register Jamendo if client ID is configured
    if (env?.JAMENDO_CLIENT_ID) {
      const jamendo = new JamendoCatalogProvider(env.JAMENDO_CLIENT_ID);
      this.providers.set(jamendo.name, jamendo);
      console.log(`[CatalogService] Jamendo provider registered`);
    }

    // iTunes is primary: it's the only provider with correct ORIGINAL release
    // years (Deezer often returns compilation/re-release dates). But iTunes
    // rate-limits Cloudflare Workers' shared egress IPs (429), so every lookup
    // falls back to Deezer (real previews, approximate years) before mock.
    this.primaryProviderName = 'itunes';
  }

  getProvider(name?: string): CatalogProvider {
    if (name && this.providers.has(name)) {
      return this.providers.get(name)!;
    }
    return this.providers.get(this.primaryProviderName)!;
  }

  getPrimaryProvider(): CatalogProvider {
    return this.getProvider(this.primaryProviderName);
  }

  getMockProvider(): CatalogProvider {
    return this.getProvider('mock-catalog');
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Run a lookup through the real-provider fallback chain:
   * primary (itunes) → deezer. Returns null if every provider
   * errors or comes back empty, so callers can fall back to mock.
   */
  private async tryRealProviders(
    label: string,
    lookup: (provider: CatalogProvider) => Promise<CatalogTrack[]>
  ): Promise<CatalogTrack[] | null> {
    const chain = [...new Set([this.primaryProviderName, 'deezer'])];
    for (const name of chain) {
      const provider = this.providers.get(name);
      if (!provider) continue;
      try {
        const results = await lookup(provider);
        if (results.length > 0) return results;
        console.warn(`[CatalogService] ${name} ${label} returned no results`);
      } catch (err) {
        console.warn(`[CatalogService] ${name} ${label} failed:`, err);
      }
    }
    console.warn(`[CatalogService] All real providers failed for ${label}, falling back to mock`);
    return null;
  }

  /**
   * Search across providers: itunes → deezer → mock.
   */
  async searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    const results = await this.tryRealProviders('search', (p) => p.searchTracks(query, limit));
    return results ?? this.getMockProvider().searchTracks(query, limit);
  }

  /**
   * Get a single track. IDs are provider-prefixed (itunes-/deezer-/m…),
   * so route directly to the owning provider, then fall back to mock.
   */
  async getTrack(id: string): Promise<CatalogTrack | null> {
    // If it's a mock ID, go directly to mock
    if (id.startsWith('m')) {
      return this.getMockProvider().getTrack(id);
    }

    const owner = id.startsWith('deezer-') ? 'deezer' : id.startsWith('itunes-') ? 'itunes' : this.primaryProviderName;
    const provider = this.providers.get(owner);
    if (provider) {
      try {
        const result = await provider.getTrack(id);
        if (result) return result;
      } catch {
        // fall through to mock
      }
    }

    return this.getMockProvider().getTrack(id);
  }

  /**
   * Get preview URL for a track.
   */
  async getPreviewUrl(trackId: string): Promise<string | null> {
    const track = await this.getTrack(trackId);
    return track?.previewUrl ?? null;
  }

  /**
   * Get chart/top tracks: itunes → deezer → mock.
   */
  async getChartTracks(limit = 25): Promise<CatalogTrack[]> {
    const results = await this.tryRealProviders('chart', (p) => p.getChartTracks(limit));
    return results ?? this.getMockProvider().getChartTracks(limit);
  }
}

// Singleton instance for the worker
export const catalogService = new CatalogService();