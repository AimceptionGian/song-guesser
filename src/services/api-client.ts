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
}

export interface JoinLobbyRequest {
  playerName: string;
  playerAvatar: string;
}

export interface JoinLobbyResponse {
  playerId: string;
  token: string;
}

export interface LobbyData {
  id: string;
  code: string;
  hostId: string;
  players: Array<{ id: string; name: string; avatar: string; joinedAt: number }>;
  state: string;
  settings: {
    maxPlayers: number;
    totalRounds: number;
    maxPoints: number;
    timelineOnlyScoring: boolean;
    yearRange: { min: number; max: number };
  };
  createdAt: number;
}

export interface CategoryInfo {
  name: string;
  description: string;
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

  /** Health check */
  health(): Promise<{ status: string; timestamp: number }> {
    return apiFetch('/health');
  },

  // ─── Game Commands (HTTP REST) ───

  /** Start a match — initializes DO with deck and players */
  startMatch(code: string): Promise<{ accepted: boolean; newVersion: number; stateDelta: Record<string, unknown>; state: import('../types').GameState | null }> {
    return apiFetch(`/games/${code}/start`, { method: 'POST', body: {} });
  },

  /** Draw the next card */
  drawCard(code: string): Promise<{ accepted: boolean; newVersion: number; stateDelta: Record<string, unknown>; state: import('../types').GameState | null }> {
    return apiFetch(`/games/${code}/draw`, { method: 'POST', body: {} });
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