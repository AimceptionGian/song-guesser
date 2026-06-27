// ─── Repository Context ───
// Wires up repository instances based on environment.
// Falls back to in-memory when MongoDB is not configured.

import type { Env } from '../../env';
import type { LobbyRepository, SessionRepository, MatchStateRepository, Repository } from './repository';
import { InMemoryLobbyRepository, InMemorySessionRepository } from './in-memory-repository';
import { MongoLobbyRepository, MongoSessionRepository, MongoMatchStateRepository } from './mongo-repository';
import type { MatchState } from '../../types';

export interface RepositoryContext {
  lobbies: LobbyRepository;
  sessions: SessionRepository;
  matchStates: MatchStateRepository;
}

/**
 * Create repository instances based on environment config.
 * Uses MongoDB when API URL is configured, in-memory otherwise.
 */
export function createRepositoryContext(env: Env): RepositoryContext {
  if (env.MONGODB_API_URL && env.MONGODB_API_KEY) {
    console.log('[Repository] Using MongoDB persistence');
    return {
      lobbies: new MongoLobbyRepository(env),
      sessions: new MongoSessionRepository(env),
      matchStates: new MongoMatchStateRepository(env),
    };
  }

  console.log('[Repository] Using in-memory storage');
  return {
    lobbies: new InMemoryLobbyRepository(),
    sessions: new InMemorySessionRepository(),
    matchStates: new InMemoryMatchStateRepository(),
  };
}

// ─── Simple in-memory match state repo ───

class InMemoryMatchStateRepository implements MatchStateRepository {
  private states = new Map<string, MatchState>();

  async findById(id: string): Promise<MatchState | null> {
    return this.states.get(id) ?? null;
  }

  async findByLobbyId(lobbyId: string): Promise<MatchState | null> {
    for (const state of this.states.values()) {
      if (state.lobbyId === lobbyId) return state;
    }
    return null;
  }

  async findAll(): Promise<MatchState[]> {
    return Array.from(this.states.values());
  }

  async save(state: MatchState): Promise<void> {
    this.states.set(state.lobbyId, state);
  }

  async deleteById(id: string): Promise<void> {
    this.states.delete(id);
  }
}