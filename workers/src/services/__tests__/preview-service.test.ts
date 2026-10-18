import { resolvePlayableCard, PreviewUnavailableError } from '../preview-service';
import { DeezerCatalogProvider, DeezerUnavailableError } from '../../adapters/deezer-catalog-provider';
import { ITunesCatalogProvider } from '../../adapters/itunes-catalog-provider';
import type { CatalogTrack } from '../../adapters/catalog-provider';
import type { Card } from '../../types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'decade-1985-a-ha-take-on-me', title: 'Take On Me', artist: 'a-ha',
    year: 1985, genre: 'Pop', emoji: '🎵', gradient: 'x',
    ...overrides,
  };
}

function makeTrack(overrides: Partial<CatalogTrack> = {}): CatalogTrack {
  return {
    id: 'deezer-1', title: 'Take On Me', artist: 'a-ha', album: 'Hunting High and Low',
    year: 1985, genre: 'Pop', previewUrl: 'https://cdn/fresh.mp3', coverUrl: 'https://cdn/cover.jpg',
    ...overrides,
  };
}

describe('preview-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The iTunes fallback must never hit the network in tests
    vi.spyOn(ITunesCatalogProvider.prototype, 'searchTracks').mockResolvedValue([]);
  });

  it('resolves a fresh preview and cover for a curated card', async () => {
    vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow').mockResolvedValue([makeTrack()]);

    const resolved = await resolvePlayableCard(makeCard());

    expect(resolved).not.toBeNull();
    expect(resolved!.previewUrl).toBe('https://cdn/fresh.mp3');
    expect(resolved!.coverUrl).toBe('https://cdn/cover.jpg');
    // The curated ground-truth metadata must survive the lookup
    expect(resolved!.year).toBe(1985);
    expect(resolved!.title).toBe('Take On Me');
  });

  it('uses previewQuery when the card provides one', async () => {
    const searchTracks = vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow')
      .mockResolvedValue([makeTrack()]);

    await resolvePlayableCard(makeCard({ previewQuery: 'Artist One Song 3' }));

    expect(searchTracks).toHaveBeenCalledWith('Artist One Song 3', expect.any(Number));
  });

  it('goes straight to the track endpoint for Deezer-sourced cards', async () => {
    const getTrack = vi.spyOn(DeezerCatalogProvider.prototype, 'getTrackOrThrow').mockResolvedValue(makeTrack());
    const searchTracks = vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow');

    const resolved = await resolvePlayableCard(makeCard({ id: 'deezer-4321' }));

    expect(getTrack).toHaveBeenCalledWith('deezer-4321');
    expect(searchTracks).not.toHaveBeenCalled();
    expect(resolved!.previewUrl).toBe('https://cdn/fresh.mp3');
  });

  it('falls back to a search when the track endpoint has no preview', async () => {
    vi.spyOn(DeezerCatalogProvider.prototype, 'getTrackOrThrow').mockResolvedValue(makeTrack({ previewUrl: null }));
    vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow').mockResolvedValue([makeTrack()]);

    const resolved = await resolvePlayableCard(makeCard({ id: 'deezer-4321' }));
    expect(resolved!.previewUrl).toBe('https://cdn/fresh.mp3');
  });

  it('returns null when nothing playable is found, so the caller can skip the card', async () => {
    vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow').mockResolvedValue([makeTrack({ previewUrl: null })]);
    expect(await resolvePlayableCard(makeCard())).toBeNull();
  });

  it('retries when Deezer rate-limits, then resolves', async () => {
    vi.useFakeTimers();
    try {
      const search = vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow')
        .mockRejectedValueOnce(new DeezerUnavailableError('Quota limit exceeded'))
        .mockResolvedValueOnce([makeTrack()]);

      const pending = resolvePlayableCard(makeCard());
      await vi.runAllTimersAsync();

      expect((await pending)!.previewUrl).toBe('https://cdn/fresh.mp3');
      expect(search).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to iTunes when Deezer stays unavailable', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow')
        .mockRejectedValue(new DeezerUnavailableError('Quota limit exceeded'));
      vi.spyOn(ITunesCatalogProvider.prototype, 'searchTracks')
        .mockResolvedValue([makeTrack({ id: 'itunes-9', previewUrl: 'https://apple/preview.m4a' })]);

      const pending = resolvePlayableCard(makeCard());
      await vi.runAllTimersAsync();

      expect((await pending)!.previewUrl).toBe('https://apple/preview.m4a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to iTunes when Deezer has no preview for the song', async () => {
    vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow').mockResolvedValue([]);
    vi.spyOn(ITunesCatalogProvider.prototype, 'searchTracks')
      .mockResolvedValue([makeTrack({ id: 'itunes-9', previewUrl: 'https://apple/preview.m4a' })]);

    expect((await resolvePlayableCard(makeCard()))!.previewUrl).toBe('https://apple/preview.m4a');
  });

  it('throws PreviewUnavailableError — not null — when no source can answer', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(DeezerCatalogProvider.prototype, 'searchTracksOrThrow')
        .mockRejectedValue(new DeezerUnavailableError('Quota limit exceeded'));

      const pending = resolvePlayableCard(makeCard());
      const assertion = expect(pending).rejects.toBeInstanceOf(PreviewUnavailableError);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
