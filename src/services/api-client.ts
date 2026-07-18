// ─── Frontend API Client ───
// In dev mode, calls are proxied to the Cloudflare Worker via Vite.
// In production, calls go directly to the Worker URL.
// Override via VITE_API_BASE env var for local dev.

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

interface FetchOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string>;
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  let url = `${API_BASE}${path}`;

  if (opts.params) {
    const qs = new URLSearchParams(opts.params).toString();
    url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Types mirroring backend DTOs ───

export interface CreateLobbyRequest {
  hostName: string;
  hostAvatar: string;
  settings?: Partial<{
    maxPlayers: number;
    totalRounds: number;
    maxPoints: number;
    timelineOnlyScoring: boolean;
    yearRange: { min: number; max: number };
  }>;
}

export interface CreateLobbyResponse {
  lobbyId: string;
  code: string;
  token: string;
  hostId: string;
}

export interface JoinLobbyRequest {
  playerName: string;
  playerAvatar: string;
}

export interface JoinLobbyResponse {
  playerId: string;
  token: string;
}

export interface CategoryAvailability {
  eligible: boolean;
  totalSongs: number;
  reason?: string;
}

/** Mirrors the backend's HistoryTrack shape (cached client-side). */
export interface HistoryTrackDto {
  id: string;
  title: string;
  artist: string;
  album?: string;
  playedAt: string;
  source: string;
  year?: number;
  isTop?: boolean;
}

// ─── Lobby session persistence (survives OAuth redirects and reloads) ───

const SESSION_KEY = 'sg-lobby-session';

export interface LobbySession {
  code: string;
  playerId: string;
  isHost: boolean;
}

export function saveLobbySession(session: LobbySession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* storage unavailable */ }
}

export function getLobbySession(): LobbySession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as LobbySession) : null;
  } catch {
    return null;
  }
}

export function clearLobbySession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch { /* storage unavailable */ }
}

// ─── Spotify history cache (so players stay "connected" across lobbies) ───

const HISTORY_CACHE_KEY = 'sg-spotify-history';

export function saveHistoryCache(tracks: HistoryTrackDto[]): void {
  try {
    localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(tracks));
  } catch { /* storage unavailable or quota exceeded */ }
}

export function getHistoryCache(): HistoryTrackDto[] | null {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as HistoryTrackDto[]) : null;
    return parsed?.length ? parsed : null;
  } catch {
    return null;
  }
}

export interface LobbyData {
  id: string;
  code: string;
  hostId: string;
  players: Array<{ id: string; name: string; avatar: string; joinedAt: number }>;
  state: string;
  category: string | null;
  settings: {
    maxPlayers: number;
    totalRounds: number;
    maxPoints: number;
    timelineOnlyScoring: boolean;
    yearRange: { min: number; max: number };
  };
  createdAt: number;
  playersWithHistory?: string[];
  categoryAvailability?: Record<string, CategoryAvailability>;
}

export interface CategoryInfo {
  name: string;
  label: string;
  description: string;
  emoji: string;
  requiresHistory: boolean;
}

// ─── API Methods ───

export const api = {
  /** Create a new lobby, returns the lobby code and token */
  createLobby(req: CreateLobbyRequest): Promise<CreateLobbyResponse> {
    return apiFetch<CreateLobbyResponse>('/lobbies', {
      method: 'POST',
      body: req,
    });
  },

  /** Get lobby info by code */
  getLobby(code: string): Promise<LobbyData> {
    return apiFetch<LobbyData>(`/lobbies/${code}`);
  },

  /** Join an existing lobby */
  joinLobby(code: string, req: JoinLobbyRequest): Promise<JoinLobbyResponse> {
    return apiFetch<JoinLobbyResponse>(`/lobbies/${code}/join`, {
      method: 'POST',
      body: req,
    });
  },

  /** Leave a lobby */
  leaveLobby(code: string, playerId: string): Promise<{ success: boolean }> {
    return apiFetch<{ success: boolean }>(`/lobbies/${code}/leave`, {
      method: 'POST',
      body: { playerId },
    });
  },

  /** Start the game (host only) */
  startGame(code: string): Promise<{ success: boolean; redirectTo: string }> {
    return apiFetch<{ success: boolean; redirectTo: string }>(`/lobbies/${code}/start`, {
      method: 'POST',
    });
  },

  /** Get available categories */
  getCategories(hasHistory?: boolean): Promise<{ categories: CategoryInfo[] }> {
    return apiFetch<{ categories: CategoryInfo[] }>('/categories', {
      params: hasHistory ? { history: 'true' } : undefined,
    });
  },

  /** Set the lobby's game category (host only) */
  setCategory(code: string, category: string): Promise<{ success: boolean; category: string }> {
    return apiFetch<{ success: boolean; category: string }>(`/lobbies/${code}/category`, {
      method: 'POST',
      body: { category },
    });
  },

  /** Public frontend config (Spotify client ID for the PKCE flow) */
  getConfig(): Promise<{ spotifyClientId: string | null }> {
    return apiFetch<{ spotifyClientId: string | null }>('/config');
  },

  /** Sync a player's Spotify listening history for the lobby */
  syncSpotifyHistory(req: { playerId: string; accessToken: string; lobbyCode: string }): Promise<{
    playerId: string; tracks: number; trackList: HistoryTrackDto[]; syncedAt: number; source: string;
  }> {
    return apiFetch(`/history/sync`, { method: 'POST', body: req });
  },

  /** Re-import a cached history into a (new) lobby without OAuth */
  importCachedHistory(req: { playerId: string; lobbyCode: string; tracks: HistoryTrackDto[] }): Promise<{
    success: boolean; tracks: number;
  }> {
    return apiFetch(`/history/import-cached`, { method: 'POST', body: req });
  },

  /** Update lobby settings (host only, currently totalRounds) */
  updateSettings(code: string, settings: { totalRounds: number }): Promise<{ success: boolean; totalRounds: number }> {
    return apiFetch(`/lobbies/${code}/settings`, { method: 'POST', body: settings });
  },

  /** Broadcast what the active player is typing */
  sendLiveInput(code: string, input: { playerId: string; artist: string; title: string; year: number }): Promise<{ accepted: boolean }> {
    return apiFetch(`/games/${code}/live-input`, { method: 'POST', body: input });
  },

  /** Health check */
  health(): Promise<{ status: string; timestamp: number }> {
    return apiFetch('/health');
  },

  // ─── Game Commands (HTTP REST) ───

  /** Start a match — initializes DO with deck and players */
  startMatch(code: string): Promise<{ accepted: boolean; newVersion: number; stateDelta: Record<string, unknown>; state: import('../types').GameState | null }> {
    return apiFetch(`/games/${code}/start`, { method: 'POST', body: {} });
  },

  /** Draw the next card (playerId enforces turn order server-side) */
  drawCard(code: string, playerId?: string): Promise<{ accepted: boolean; newVersion: number; stateDelta: Record<string, unknown>; state: import('../types').GameState | null }> {
    return apiFetch(`/games/${code}/draw`, { method: 'POST', body: playerId ? { playerId } : {} });
  },

  /** Submit a guess */
  submitGuess(code: string, guess: { playerId: string; cardId: string; guessedArtist: string; guessedTitle: string; guessedYear: number }): Promise<{ accepted: boolean; newVersion: number; stateDelta: Record<string, unknown>; state: import('../types').GameState | null }> {
    return apiFetch(`/games/${code}/guess`, { method: 'POST', body: guess });
  },

  /** Get current game state */
  getGameState(code: string): Promise<import('../types').GameState> {
    return apiFetch(`/games/${code}/state`);
  },
};

export default api;