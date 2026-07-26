import {
  fetchRecentChartCards,
  buildCuratedDecadeCards,
  buildRandomHitsDeck,
  buildHistoryDeck,
  buildDeck,
  deckSizeFor,
  mergeDeduped,
} from '../deck-service';
import { catalogService } from '../catalog-service';
import { DECADES, DECADE_HITS } from '../../db/decade-hits';
import * as historyStore from '../../db/repositories/durable-object-repository';
import type { CatalogTrack } from '../../adapters/catalog-provider';
import type { Card, Lobby } from '../../types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1', title: 'Song', artist: 'Artist', year: 2000, genre: 'Pop',
    emoji: '🎵', gradient: 'x',
    ...overrides,
  };
}

function makeCatalogTrack(overrides: Partial<CatalogTrack> = {}): CatalogTrack {
  return {
    id: 'deezer-1', title: 'Song', artist: 'Artist', album: 'Album',
    year: 2000, genre: 'Pop', previewUrl: 'https://x/p.mp3', coverUrl: null,
    ...overrides,
  };
}

const NO_SPOTIFY_ENV = {} as any;

function makeLobby(overrides: Partial<Lobby> = {}): Lobby {
  return {
    id: 'lobby-1', code: 'ABCD', hostId: 'host-1',
    players: [{ id: 'p1', name: 'A', avatar: '🎮', joinedAt: Date.now() }],
    state: 'waiting',
    settings: { maxPlayers: 4, totalRounds: 5, maxPoints: 1000, timelineOnlyScoring: false, yearRange: { min: 1960, max: 2024 } },
    category: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('deck-service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchRecentChartCards', () => {
    it('samples down to the requested count', async () => {
      const tracks = Array.from({ length: 50 }, (_, i) => makeCatalogTrack({ id: `t${i}` }));
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValueOnce(tracks);

      const cards = await fetchRecentChartCards(NO_SPOTIFY_ENV, 6);
      expect(cards).toHaveLength(6);
      // ids are unique — no duplicate sampling
      expect(new Set(cards.map((c) => c.id)).size).toBe(6);
    });

    it('returns an empty array when the chart fetch fails', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockRejectedValueOnce(new Error('down'));
      const cards = await fetchRecentChartCards(NO_SPOTIFY_ENV, 6);
      expect(cards).toEqual([]);
    });
  });

  describe('buildCuratedDecadeCards', () => {
    it('uses the hardcoded ground-truth years', () => {
      const allYears = DECADES.flatMap((d) => DECADE_HITS[d].map((h) => h.year));
      for (const card of buildCuratedDecadeCards(12)) {
        expect(allYears).toContain(card.year);
      }
    });

    it('costs no provider lookups — previews are resolved at draw time', () => {
      const getProvider = vi.spyOn(catalogService, 'getProvider');
      const cards = buildCuratedDecadeCards(20);

      expect(cards).toHaveLength(20);
      expect(cards.every((c) => c.previewUrl === undefined)).toBe(true);
      expect(getProvider).not.toHaveBeenCalled();
    });

    it('never exceeds the requested target count', () => {
      expect(buildCuratedDecadeCards(7).length).toBeLessThanOrEqual(7);
    });

    it('spreads picks across decades instead of draining one', () => {
      // One card per decade is available before any decade gets a second one
      const cards = buildCuratedDecadeCards(DECADES.length);
      const decades = new Set(
        cards.map((c) => `${Math.floor(c.year / 10) * 10}s`)
      );
      expect(decades.size).toBe(DECADES.length);
    });

    it('stops when every curated hit is used up', () => {
      const total = DECADES.reduce((n, d) => n + DECADE_HITS[d].length, 0);
      expect(buildCuratedDecadeCards(total + 50)).toHaveLength(total);
    });
  });

  describe('mergeDeduped', () => {
    it('keeps the preferred copy when the same song appears in both lists', () => {
      const curated = [makeCard({ id: 'decade-1982', title: 'Billie Jean', artist: 'Michael Jackson', year: 1982 })];
      const recent = [makeCard({ id: 'deezer-99', title: 'Billie Jean', artist: 'Michael Jackson', year: 2009 })];

      const merged = mergeDeduped(curated, recent);
      expect(merged).toHaveLength(1);
      expect(merged[0].year).toBe(1982);
    });

    it('is case- and punctuation-insensitive when matching duplicates', () => {
      const curated = [makeCard({ title: "Sweet Child O' Mine", artist: "Guns N' Roses", year: 1987 })];
      const recent = [makeCard({ title: 'sweet child o mine', artist: 'guns n roses', year: 1987 })];

      expect(mergeDeduped(curated, recent)).toHaveLength(1);
    });

    it('keeps unrelated songs from both lists', () => {
      const curated = [makeCard({ title: 'A', artist: 'X' })];
      const recent = [makeCard({ title: 'B', artist: 'Y' })];

      expect(mergeDeduped(curated, recent)).toHaveLength(2);
    });
  });

  describe('buildRandomHitsDeck', () => {
    it('blends recent chart tracks and curated decade tracks', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => makeCatalogTrack({ id: `chart-${i}` }))
      );

      const deck = await buildRandomHitsDeck(NO_SPOTIFY_ENV);
      expect(deck).toBeDefined();
      expect(deck!.some((c) => c.id.startsWith('chart-'))).toBe(true);
      expect(deck!.some((c) => c.id.startsWith('decade-'))).toBe(true);
    });

    it('fills to the requested size even when the chart provider is down', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockRejectedValueOnce(new Error('down'));

      const deck = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 48);
      expect(deck).toHaveLength(48);
    });

    it('keeps the handful of chart cards when trimming to deck size', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => makeCatalogTrack({ id: `chart-${i}` }))
      );

      const deck = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 20);
      expect(deck).toHaveLength(20);
      expect(deck!.filter((c) => c.id.startsWith('chart-')).length).toBeGreaterThan(0);
    });
  });

  describe('buildHistoryDeck', () => {
    it('returns undefined when the pool is below the minimum', async () => {
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockResolvedValueOnce({});
      const deck = await buildHistoryDeck(NO_SPOTIFY_ENV, makeLobby(), 'heard_by_any');
      expect(deck).toBeUndefined();
    });

    it('builds without provider lookups and carries a search query per card', async () => {
      const tracks = Array.from({ length: 12 }, (_, i) => ({
        id: `spotify-${i}`, title: `Song ${i}`, artist: 'Artist One, Artist Two',
        playedAt: new Date().toISOString(), source: 'spotify' as const, year: 2000 + i,
      }));
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockResolvedValueOnce({ p1: tracks });
      const getProvider = vi.spyOn(catalogService, 'getProvider');

      const deck = await buildHistoryDeck(
        NO_SPOTIFY_ENV,
        makeLobby({ players: [{ id: 'p1', name: 'A', avatar: '', joinedAt: 0 }] }),
        'heard_by_any'
      );

      expect(deck).toBeDefined();
      expect(deck).toHaveLength(tracks.length);
      expect(getProvider).not.toHaveBeenCalled();
      // Multi-artist history strings search with the primary artist only
      expect(deck![0].previewQuery).toMatch(/^Artist One Song \d+$/);
    });
  });

  describe('deckSizeFor', () => {
    it('covers one card per player per round plus spares', () => {
      const lobby = makeLobby({
        players: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: 'A', avatar: '', joinedAt: 0 })),
        settings: { ...makeLobby().settings, totalRounds: 10 },
      });
      expect(deckSizeFor(lobby)).toBeGreaterThan(4 * 10);
    });

    it('never drops below a sensible minimum for tiny matches', () => {
      const lobby = makeLobby({ settings: { ...makeLobby().settings, totalRounds: 3 } });
      expect(deckSizeFor(lobby)).toBeGreaterThanOrEqual(20);
    });
  });

  describe('buildDeck', () => {
    it('routes to buildRandomHitsDeck for the default category', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValueOnce([makeCatalogTrack()]);
      vi.spyOn(catalogService, 'getProvider').mockReturnValue({
        name: 'deezer',
        searchTracks: vi.fn().mockResolvedValue([makeCatalogTrack({ previewUrl: 'https://x/p.mp3' })]),
        getTrack: vi.fn(), getPreviewUrl: vi.fn(), getChartTracks: vi.fn(),
      });

      const deck = await buildDeck(NO_SPOTIFY_ENV, makeLobby({ category: null }));
      expect(deck).toBeDefined();
      expect(deck!.length).toBeGreaterThan(0);
    });

    it('falls back to random hits when the history pool is too small', async () => {
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockResolvedValueOnce({});
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValueOnce([makeCatalogTrack()]);
      vi.spyOn(catalogService, 'getProvider').mockReturnValue({
        name: 'deezer',
        searchTracks: vi.fn().mockResolvedValue([makeCatalogTrack({ previewUrl: 'https://x/p.mp3' })]),
        getTrack: vi.fn(), getPreviewUrl: vi.fn(), getChartTracks: vi.fn(),
      });

      const deck = await buildDeck(NO_SPOTIFY_ENV, makeLobby({ category: 'heard_by_any' }));
      expect(deck).toBeDefined();
      // Fallback deck is random-hits, so it should include chart or decade cards
      expect(deck!.some((c) => c.id === 'deezer-1' || c.id.startsWith('decade-'))).toBe(true);
    });
  });
});
