// ─── Repository Interface ───
// Abstract data-access layer that can be backed by in-memory or MongoDB.

import type { Lobby, MatchState } from '../../types';
import type { PlayerSession } from '../../types';

// ─── Generic CRUD operations ───

export interface Repository<T> {
  findById(id: string): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<void>;
  deleteById(id: string): Promise<void>;
}

// ─── Lobby Repository ───

export interface LobbyRepository extends Repository<Lobby> {
  findByCode(code: string): Promise<Lobby | null>;
}

// ─── Match State Repository ───

export interface MatchStateRepository extends Repository<MatchState> {
  findByLobbyId(lobbyId: string): Promise<MatchState | null>;
}

// ─── Session Repository ───

export interface SessionRepository extends Repository<PlayerSession> {
  findByPlayerId(playerId: string): Promise<PlayerSession | null>;
  findByLobbyId(lobbyId: string): Promise<PlayerSession[]>;
  findByToken(token: string): Promise<PlayerSession | null>;
  addSession(token: string, session: PlayerSession): Promise<void>;
  deleteByToken(token: string): Promise<void>;
  deleteByLobbyId(lobbyId: string): Promise<void>;
}