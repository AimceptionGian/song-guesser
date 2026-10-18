import {
  fetchRecentChartCards,
  buildCuratedDecadeCards,
  buildRandomHitsDeck,
  buildHistoryDeck,
  buildDeck,
  buildRefillCards,
  cardKey,
  deckSizeFor,
  mergeDeduped,
  orderByFreshness,
  spreadArtists,
  trackKey,
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

    it('holds enough songs that a match cannot drain the pool', () => {
      // Repeat protection only buys variety if there is variety to hand out:
      // a match deals ~25 cards, so a shallow pool guarantees repeats.
      const total = DECADES.reduce((n, d) => n + DECADE_HITS[d].length, 0);
      expect(total).toBeGreaterThanOrEqual(150);
      for (const decade of DECADES) {
        expect(DECADE_HITS[decade].length).toBeGreaterThanOrEqual(20);
      }
    });

    it('skips recently played songs while fresh ones remain', () => {
      const played = buildCuratedDecadeCards(30);
      const recency = new Map(played.map((c, i) => [trackKey(c.artist, c.title), i]));

      const next = buildCuratedDecadeCards(30, recency);
      const playedKeys = new Set(recency.keys());

      expect(next.filter((c) => playedKeys.has(trackKey(c.artist, c.title)))).toHaveLength(0);
    });

    it('falls back to the oldest songs once everything has been played', () => {
      const total = DECADES.reduce((n, d) => n + DECADE_HITS[d].length, 0);
      const everything = buildCuratedDecadeCards(total);
      const recency = new Map(everything.map((c, i) => [trackKey(c.artist, c.title), i]));

      // Nothing is fresh any more — the deck must still fill up rather than
      // come back short.
      expect(buildCuratedDecadeCards(30, recency)).toHaveLength(30);
    });

    it('never deals the same song twice within one deck', () => {
      const keys = buildCuratedDecadeCards(60).map((c) => trackKey(c.artist, c.title));
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  describe('trackKey', () => {
    it('collapses the same song from different sources onto one key', () => {
      expect(trackKey("Guns N' Roses", "Sweet Child O' Mine"))
        .toBe(trackKey('guns n roses', 'sweet child o mine'));
    });

    it('keeps different songs apart', () => {
      expect(trackKey('Queen', 'Bohemian Rhapsody')).not.toBe(trackKey('Queen', 'We Will Rock You'));
    });
  });

  describe('orderByFreshness', () => {
    const key = (s: string) => s;

    it('puts songs nobody heard recently ahead of remembered ones', () => {
      const recency = new Map([['a', 0], ['b', 1], ['c', 2]]);
      const ordered = orderByFreshness(['a', 'b', 'c', 'fresh'], key, recency);
      expect(ordered[0]).toBe('fresh');
    });

    it('orders remembered songs least-recently-played first', () => {
      const recency = new Map([['oldest', 0], ['middle', 1], ['newest', 2]]);
      expect(orderByFreshness(['newest', 'middle', 'oldest'], key, recency))
        .toEqual(['oldest', 'middle', 'newest']);
    });

    it('never drops items, so a saturated memory cannot starve the deck', () => {
      const items = ['a', 'b', 'c'];
      const recency = new Map(items.map((k, i) => [k, i]));
      expect(orderByFreshness(items, key, recency).sort()).toEqual(items);
    });

    it('leaves the order random when nothing has been played yet', () => {
      const items = Array.from({ length: 30 }, (_, i) => `s${i}`);
      const ordered = orderByFreshness(items, key, new Map());
      expect(ordered).toHaveLength(30);
      expect(ordered).not.toEqual(items);
    });
  });

  describe('spreadArtists', () => {
    it('separates two songs by the same artist', () => {
      const deck = spreadArtists([
        makeCard({ id: '1', artist: 'Queen' }),
        makeCard({ id: '2', artist: 'Queen' }),
        makeCard({ id: '3', artist: 'ABBA' }),
        makeCard({ id: '4', artist: 'Toto' }),
      ]);
      const adjacent = deck.some((c, i) => i > 0 && c.artist === deck[i - 1].artist);
      expect(adjacent).toBe(false);
    });

    it('keeps every card', () => {
      const cards = Array.from({ length: 10 }, (_, i) =>
        makeCard({ id: `c${i}`, artist: i % 2 === 0 ? 'A' : 'B' })
      );
      expect(spreadArtists(cards).map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    });

    it('survives a deck where one artist has no alternative', () => {
      const cards = [makeCard({ id: '1', artist: 'A' }), makeCard({ id: '2', artist: 'A' })];
      expect(spreadArtists(cards)).toHaveLength(2);
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

    it('deals a completely different set to the next match', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const first = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 30);
      const recency = new Map(first!.map((c, i) => [trackKey(c.artist, c.title), i]));
      const second = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 30, recency);

      const firstKeys = new Set(recency.keys());
      expect(second!.filter((c) => firstKeys.has(trackKey(c.artist, c.title)))).toHaveLength(0);
    });

    it('never lands the same artist on two consecutive turns', async () => {
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const deck = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 40);
      const adjacent = deck!.filter((c, i) => i > 0 && c.artist === deck![i - 1].artist);
      expect(adjacent).toEqual([]);
    });

    it('prefers chart entries the group has not had yet', async () => {
      const tracks = Array.from({ length: 20 }, (_, i) =>
        makeCatalogTrack({ id: `chart-${i}`, artist: `Artist ${i}`, title: `Chart Song ${i}` })
      );
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue(tracks);

      // Everything but the last two chart entries was played recently
      const recency = new Map(
        tracks.slice(0, 18).map((t, i) => [trackKey(t.artist, t.title), i])
      );
      const deck = await buildRandomHitsDeck(NO_SPOTIFY_ENV, 30, recency);
      const chartIds = deck!.filter((c) => c.id.startsWith('chart-')).map((c) => c.id);

      expect(chartIds).toContain('chart-18');
      expect(chartIds).toContain('chart-19');
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

  describe('buildHistoryDeck — heard_by_all top-up', () => {
    const track = (id: string, title: string) => ({
      id, title, artist: `Artist ${title}`,
      playedAt: new Date().toISOString(), source: 'spotify' as const, year: 2001,
    });

    it('tops a small shared pool up with songs one player knows, shared songs drawn first', async () => {
      const shared = Array.from({ length: 5 }, (_, i) => track(`s${i}`, `Shared ${i}`));
      const p1Only = Array.from({ length: 20 }, (_, i) => track(`a${i}`, `Only A ${i}`));
      const p2Only = Array.from({ length: 20 }, (_, i) => track(`b${i}`, `Only B ${i}`));
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockResolvedValueOnce({
        p1: [...shared, ...p1Only],
        p2: [...shared, ...p2Only],
      });

      const lobby = makeLobby({
        players: [
          { id: 'p1', name: 'A', avatar: '', joinedAt: 0 },
          { id: 'p2', name: 'B', avatar: '', joinedAt: 0 },
        ],
      });
      const deck = await buildHistoryDeck(NO_SPOTIFY_ENV, lobby, 'heard_by_all', 20);

      expect(deck).toHaveLength(20);
      // The match pops from the end — the 5 shared songs must come up first
      const drawOrder = [...deck!].reverse();
      expect(drawOrder.slice(0, 5).every((c) => c.title.startsWith('Shared'))).toBe(true);
    });
  });

  describe('buildDeck — short history pools', () => {
    it('pads a history deck to the full match size so the match cannot run dry', async () => {
      const tracks = Array.from({ length: 12 }, (_, i) => ({
        id: `spotify-${i}`, title: `History ${i}`, artist: `Artist ${i}`,
        playedAt: new Date().toISOString(), source: 'spotify' as const, year: 2000,
      }));
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockResolvedValueOnce({ p1: tracks });
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'getRecentKeys').mockResolvedValue([]);
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'rememberKeys').mockResolvedValue();

      const lobby = makeLobby({ category: 'heard_by_any' });
      const deck = await buildDeck(NO_SPOTIFY_ENV, lobby);

      expect(deck).toHaveLength(deckSizeFor(lobby));
      // History songs are drawn before the padding
      const drawOrder = [...deck!].reverse();
      expect(drawOrder.slice(0, 12).every((c) => c.title.startsWith('History'))).toBe(true);
    });

    it('falls back to random hits when reading the histories fails', async () => {
      vi.spyOn(historyStore.DurableObjectHistoryStore.prototype, 'getHistories').mockRejectedValueOnce(new Error('down'));
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'getRecentKeys').mockResolvedValue([]);
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'rememberKeys').mockResolvedValue();
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const deck = await buildDeck(NO_SPOTIFY_ENV, makeLobby({ category: 'heard_by_all' }));
      expect(deck!.length).toBeGreaterThan(0);
    });
  });

  describe('buildRefillCards', () => {
    it('only deals songs the match has not had yet', () => {
      const first = buildRefillCards(30, new Set());
      const exclude = new Set(first.map(cardKey));
      const second = buildRefillCards(30, exclude);

      expect(second).toHaveLength(30);
      expect(second.some((c) => exclude.has(cardKey(c)))).toBe(false);
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

    it('records the dealt songs so the next match can avoid them', async () => {
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'getRecentKeys').mockResolvedValue([]);
      const remember = vi
        .spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'rememberKeys')
        .mockResolvedValue();
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const deck = await buildDeck(NO_SPOTIFY_ENV, makeLobby());

      expect(remember).toHaveBeenCalledWith(deck!.map((c) => trackKey(c.artist, c.title)));
    });

    it('hands consecutive matches disjoint decks', async () => {
      const played: string[] = [];
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'getRecentKeys')
        .mockImplementation(async () => [...played]);
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'rememberKeys')
        .mockImplementation(async (keys) => { played.push(...keys); });
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const first = await buildDeck(NO_SPOTIFY_ENV, makeLobby());
      const second = await buildDeck(NO_SPOTIFY_ENV, makeLobby());

      const firstKeys = new Set(first!.map((c) => trackKey(c.artist, c.title)));
      expect(second!.filter((c) => firstKeys.has(trackKey(c.artist, c.title)))).toEqual([]);
    });

    it('still starts a match when the repeat-protection store is unreachable', async () => {
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'getRecentKeys')
        .mockRejectedValue(new Error('registry down'));
      vi.spyOn(historyStore.DurableObjectRecentPickStore.prototype, 'rememberKeys')
        .mockRejectedValue(new Error('registry down'));
      vi.spyOn(catalogService, 'getChartTracks').mockResolvedValue([]);

      const deck = await buildDeck(NO_SPOTIFY_ENV, makeLobby());
      expect(deck!.length).toBeGreaterThan(0);
    });
  });
});
