import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createLobby,
  getLobbyByCode,
  getLobby,
  addPlayerToLobby,
  removePlayerFromLobby,
  setLobbyState,
  deleteLobby,
} from '../services/lobby-service';
import { getAvailableCategories, validateCategoryEligibility } from '../services/category-service';
import { catalogService } from '../services/catalog-service';
import { createSession, extractTokenFromRequest, validateSession } from '../services/auth-service';
import { historyService } from '../services/history-service';
import type { HistoryTrack } from '../adapters/history-provider';
import type { CreateLobbyRequest, JoinLobbyRequest, Lobby } from '../types';
import type { Env } from '../env';

const api = new Hono<{ Bindings: Env }>();

api.use('*', cors());

// ─── Health ───

api.get('/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// ─── Lobby ───

api.post('/lobbies', async (c) => {
  const body = await c.req.json<CreateLobbyRequest>();
  const hostId = crypto.randomUUID();

  const lobby = await createLobby(hostId, body.hostName, body.hostAvatar, body.settings);
  const token = await createSession(hostId, lobby.id, body.hostName);

  return c.json({
    lobbyId: lobby.id,
    code: lobby.code,
    token,
  }, 201);
});

api.get('/lobbies/:code', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);

  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  return c.json(lobby);
});

api.post('/lobbies/:code/join', async (c) => {
  const code = c.req.param('code');
  const body = await c.req.json<JoinLobbyRequest>();
  const lobby = await getLobbyByCode(code);

  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  const playerId = crypto.randomUUID();
  const updated = await addPlayerToLobby(lobby.id, playerId, body.playerName, body.playerAvatar);

  if (!updated) return c.json({ error: 'Lobby is full or not found' }, 400);

  const token = await createSession(playerId, lobby.id, body.playerName);

  return c.json({ playerId, token }, 201);
});

api.post('/lobbies/:code/leave', async (c) => {
  const { playerId } = await c.req.json<{ playerId: string }>();
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);

  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  await removePlayerFromLobby(lobby.id, playerId);

  return c.json({ success: true });
});

api.post('/lobbies/:code/start', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);

  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  await setLobbyState(lobby.id, 'starting');

  // Fetch real tracks from Deezer for the match deck
  const tracks = await catalogService.searchTracks('', 50);
  const deck = tracks.length > 0
    ? tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        year: t.year,
        genre: t.genre,
        emoji: '🎵',
        previewUrl: t.previewUrl ?? undefined,
        coverUrl: t.coverUrl ?? undefined,
        gradient: 'linear-gradient(135deg, #1e1c2e, #13121f)',
      }))
    : undefined; // fallback: DO will use MOCK_TRACKS

  // Pre-seed the Durable Object with the deck
  const doId = c.env.MATCH_ROOM.idFromName(lobby.id);
  const stub = c.env.MATCH_ROOM.get(doId);

  await stub.fetch('http://dummy/init-deck', {
    method: 'POST',
    body: JSON.stringify({ deck }),
  });

  return c.json({
    success: true,
    redirectTo: `/game/${code}`,
    playerCount: lobby.players.length,
    trackCount: deck?.length ?? 0,
  });
});

// ─── Categories ───

api.get('/categories', async (c) => {
  const hasHistory = c.req.query('history') === 'true';
  const categories = getAvailableCategories(hasHistory);
  return c.json({ categories });
});

api.post('/categories/validate', async (c) => {
  const { category, playerIds } = await c.req.json<{ category: string; playerIds: string[] }>();
  const result = await validateCategoryEligibility(category, playerIds, false);
  return c.json(result);
});

// ─── Catalog ───

api.get('/catalog/search', async (c) => {
  const query = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const tracks = await catalogService.searchTracks(query, limit);
  return c.json({ tracks, provider: catalogService.getPrimaryProvider().name });
});

api.get('/catalog/track/:id', async (c) => {
  const id = c.req.param('id');
  const track = await catalogService.getTrack(id);

  if (!track) return c.json({ error: 'Track not found' }, 404);

  return c.json(track);
});

api.get('/catalog/providers', async (c) => {
  return c.json({ providers: catalogService.getAvailableProviders() });
});

// ─── Game commands (HTTP REST — reliable single-player path) ───

async function sendToDO(env: Env, lobbyId: string, path: string, body: unknown, method = 'POST'): Promise<Response> {
  const doId = env.MATCH_ROOM.idFromName(lobbyId);
  const stub = env.MATCH_ROOM.get(doId);
  const url = `http://do/${path}`;
  return stub.fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

api.post('/games/:code/start', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);
  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  // Pre-seed the deck with Deezer tracks
  const tracks = await catalogService.searchTracks('', 50);
  const deck = tracks.length > 0
    ? tracks.map((t) => ({
        id: t.id, title: t.title, artist: t.artist, year: t.year,
        genre: t.genre, emoji: '🎵', previewUrl: t.previewUrl ?? undefined,
        coverUrl: t.coverUrl ?? undefined,
        gradient: 'linear-gradient(135deg, #1e1c2e, #13121f)',
      }))
    : undefined;

  // Init deck
  await sendToDO(c.env, lobby.id, 'init-deck', { deck });

  // Start match
  const res = await sendToDO(c.env, lobby.id, 'command', {
    type: 'start_match',
    payload: {
      players: lobby.players.map((p) => ({ id: p.id, name: p.name, avatar: p.avatar })),
      totalRounds: lobby.settings.totalRounds,
    },
  });
  const result = await res.json();
  return c.json(result);
});

api.post('/games/:code/draw', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);
  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  const res = await sendToDO(c.env, lobby.id, 'command', {
    type: 'draw_card',
    payload: { playerId: 'local-player', lobbyId: lobby.id },
  });
  const result = await res.json();
  return c.json(result);
});

api.post('/games/:code/guess', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);
  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  const body = await c.req.json();
  const res = await sendToDO(c.env, lobby.id, 'command', {
    type: 'submit_guess',
    payload: body,
  });
  const result = await res.json();
  return c.json(result);
});

api.get('/games/:code/state', async (c) => {
  const code = c.req.param('code');
  const lobby = await getLobbyByCode(code);
  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  const res = await sendToDO(c.env, lobby.id, 'state', undefined, 'GET');
  const result = await res.json();
  return c.json(result);
});

// ─── WebSocket relay endpoint ───

api.get('/ws/:lobbyCode', async (c) => {
  const lobbyCode = c.req.param('lobbyCode');
  // Look up by CODE (not UUID) — the frontend sends the 4-letter code
  const lobby = await getLobbyByCode(lobbyCode);

  if (!lobby) return c.json({ error: 'Lobby not found' }, 404);

  // Upgrade to WebSocket handled by Durable Object
  // Use the lobby UUID for the DO namespace (stable, unique)
  const doId = c.env.MATCH_ROOM.idFromName(lobby.id);
  const stub = c.env.MATCH_ROOM.get(doId);

  const upstream = new URL(c.req.url);
  upstream.pathname = `/ws/${lobby.id}`;

  const workerReq = new Request(upstream, {
    headers: Object.fromEntries(c.req.raw.headers),
  });

  return stub.fetch(workerReq);
});

// ─── Player History ───

/**
 * Sync player's history from Spotify.
 * Requires a valid Spotify access token.
 */
api.post('/history/sync', async (c) => {
  const { playerId, accessToken } = await c.req.json<{ playerId: string; accessToken: string }>();

  if (!playerId || !accessToken) {
    return c.json({ error: 'playerId and accessToken are required' }, 400);
  }

  const history = await historyService.syncFromSpotify(playerId, accessToken);
  if (!history) {
    return c.json({ error: 'Spotify sync failed. No tracks found or invalid token.' }, 502);
  }

  return c.json({
    playerId: history.playerId,
    tracks: history.tracks.length,
    syncedAt: history.syncedAt,
    source: history.source,
  });
});

/**
 * Import manually uploaded tracks as player history.
 * Accepts an array of tracks with title, artist, album (optional), playedAt.
 */
api.post('/history/import', async (c) => {
  const { playerId, tracks } = await c.req.json<{
    playerId: string;
    tracks: Omit<HistoryTrack, 'source'>[];
  }>();

  if (!playerId || !tracks?.length) {
    return c.json({ error: 'playerId and tracks[] are required' }, 400);
  }

  const history = await historyService.importTracks(playerId, tracks);

  return c.json({
    playerId: history.playerId,
    tracks: history.tracks.length,
    syncedAt: history.syncedAt,
    source: history.source,
  });
});

/**
 * Get cached history summary for a player.
 */
api.get('/history/:playerId', (c) => {
  const playerId = c.req.param('playerId');
  const history = historyService.getHistory(playerId);

  if (!history) {
    return c.json({ error: 'No history found for this player. Sync or import first.' }, 404);
  }

  return c.json({
    playerId: history.playerId,
    tracks: history.tracks.length,
    syncedAt: history.syncedAt,
    source: history.source,
  });
});

/**
 * Get unique artists from multiple players' history.
 * Used by category-service to determine which tracks to select.
 */
api.post('/history/artists', async (c) => {
  const { playerIds } = await c.req.json<{ playerIds: string[] }>();

  if (!playerIds?.length) {
    return c.json({ error: 'playerIds[] is required' }, 400);
  }

  const artists = historyService.getUniqueArtists(playerIds);
  return c.json({ playerIds, artists: artists.length, names: artists });
});

export default api;