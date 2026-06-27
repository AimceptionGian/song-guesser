// ─── In-Memory Repository Implementations ───
// Used for development / testing. Data is lost on worker restart.

import type { Lobby } from '../../types';
import type { PlayerSession } from '../../types';
import type { LobbyRepository, SessionRepository } from './repository';

// ─── In-Memory Lobby Repository ───

export class InMemoryLobbyRepository implements LobbyRepository {
  private lobbies = new Map<string, Lobby>();

  async findById(id: string): Promise<Lobby | null> {
    return this.lobbies.get(id) ?? null;
  }

  async findByCode(code: string): Promise<Lobby | null> {
    for (const lobby of this.lobbies.values()) {
      if (lobby.code === code) return lobby;
    }
    return null;
  }

  async findAll(): Promise<Lobby[]> {
    return Array.from(this.lobbies.values());
  }

  async save(lobby: Lobby): Promise<void> {
    this.lobbies.set(lobby.id, lobby);
  }

  async deleteById(id: string): Promise<void> {
    this.lobbies.delete(id);
  }
}

// ─── In-Memory Session Repository ───

export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, PlayerSession>();

  async findById(token: string): Promise<PlayerSession | null> {
    return this.sessions.get(token) ?? null;
  }

  async findByPlayerId(playerId: string): Promise<PlayerSession | null> {
    for (const session of this.tokenMap.values()) {
      if (session.playerId === playerId) return session;
    }
    return null;
  }

  async findByLobbyId(lobbyId: string): Promise<PlayerSession[]> {
    const results: PlayerSession[] = [];
    for (const session of this.tokenMap.values()) {
      if (session.lobbyId === lobbyId) results.push(session);
    }
    return results;
  }

  async findAll(): Promise<PlayerSession[]> {
    return Array.from(this.tokenMap.values());
  }

  async save(session: PlayerSession): Promise<void> {
    // The token is used as the key. We need it from the session object,
    // but it's not part of PlayerSession. We store by token via set().
    // Callers must provide the token separately.
    // For now, we keep a separate Map-based approach for tokens.
    // This save() is a pass-through — use addSession() instead.
  }

  // Token-based operations (simplified for in-memory)
  private tokenMap = new Map<string, PlayerSession>();

  async addSession(token: string, session: PlayerSession): Promise<void> {
    this.tokenMap.set(token, session);
  }

  async findByToken(token: string): Promise<PlayerSession | null> {
    return this.tokenMap.get(token) ?? null;
  }

  async deleteByToken(token: string): Promise<void> {
    this.tokenMap.delete(token);
  }

  async deleteById(id: string): Promise<void> {
    // Delete by token (id = token)
    this.tokenMap.delete(id);
  }

  async deleteByLobbyId(lobbyId: string): Promise<void> {
    for (const [token, session] of this.tokenMap) {
      if (session.lobbyId === lobbyId) {
        this.tokenMap.delete(token);
      }
    }
  }
}