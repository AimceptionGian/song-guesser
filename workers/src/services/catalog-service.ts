import type { CatalogProvider, CatalogTrack } from '../adapters/catalog-provider';
import { MockCatalogProvider } from '../adapters/mock-catalog-provider';
import { DeezerCatalogProvider } from '../adapters/deezer-catalog-provider';
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

    this.providers.set(mock.name, mock);
    this.providers.set(deezer.name, deezer);

    // Register Jamendo if client ID is configured
    if (env?.JAMENDO_CLIENT_ID) {
      const jamendo = new JamendoCatalogProvider(env.JAMENDO_CLIENT_ID);
      this.providers.set(jamendo.name, jamendo);
      console.log(`[CatalogService] Jamendo provider registered`);
    }

    // Deezer is primary when available; Mock serves as fallback
    this.primaryProviderName = 'deezer';
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
   * Search across the primary provider. Falls back to mock if Deezer fails.
   */
  async searchTracks(query: string, limit = 25): Promise<CatalogTrack[]> {
    try {
      const primary = this.getPrimaryProvider();
      const results = await primary.searchTracks(query, limit);
      if (results.length > 0) return results;
    } catch (err) {
      console.warn(`[CatalogService] Primary provider failed:`, err);
    }

    // Fallback to mock
    console.warn(`[CatalogService] Falling back to mock provider`);
    return this.getMockProvider().searchTracks(query, limit);
  }

  /**
   * Get a single track, trying providers in order.
   */
  async getTrack(id: string): Promise<CatalogTrack | null> {
    // If it's a mock ID, go directly to mock
    if (id.startsWith('m')) {
      return this.getMockProvider().getTrack(id);
    }

    try {
      const result = await this.getPrimaryProvider().getTrack(id);
      if (result) return result;
    } catch {
      // fall through to mock
    }

    return this.getMockProvider().getTrack(id);
  }

  /**
   * Get preview URL for a track.
   */
  async getPreviewUrl(trackId: string): Promise<string | null> {
    return this.getPrimaryProvider().getPreviewUrl(trackId);
  }
}

// Singleton instance for the worker
export const catalogService = new CatalogService();