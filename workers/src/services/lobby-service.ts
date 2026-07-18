import type { Lobby, LobbySettings } from '../types';
import type { LobbyRepository } from '../db/repositories/repository';
import { InMemoryLobbyRepository } from '../db/repositories/in-memory-repository';

const defaultSettings: LobbySettings = {
  maxPlayers: 4,
  totalRounds: 5,
  maxPoints: 1000,
  timelineOnlyScoring: false,
  yearRange: { min: 1960, max: 2024 },
};

// Repository instance (swappable for testing / MongoDB)
let repo: LobbyRepository = new InMemoryLobbyRepository();

/**
 * Override the repository used by lobby-service.
 * Call this during app bootstrap when MongoDB is configured.
 */
export function setLobbyRepository(repository: LobbyRepository): void {
  repo = repository;
}

export async function createLobby(
  hostId: string,
  hostName: string,
  hostAvatar: string,
  partial?: Partial<LobbySettings>
): Promise<Lobby> {
  const code = await generateCode();
  const lobby: Lobby = {
    id: crypto.randomUUID(),
    code,
    hostId,
    players: [{ id: hostId, name: hostName, avatar: hostAvatar, joinedAt: Date.now() }],
    state: 'waiting',
    settings: { ...defaultSettings, ...partial },
    category: null,
    createdAt: Date.now(),
  };
  await repo.save(lobby);
  return lobby;
}

export async function getLobbyByCode(code: string): Promise<Lobby | undefined> {
  const lobby = await repo.findByCode(code);
  return lobby ?? undefined;
}

export async function getLobby(id: string): Promise<Lobby | undefined> {
  const lobby = await repo.findById(id);
  return lobby ?? undefined;
}

export async function addPlayerToLobby(lobbyId: string, playerId: string, name: string, avatar: string): Promise<Lobby | undefined> {
  const lobby = await repo.findById(lobbyId);
  if (!lobby) return undefined;
  if (lobby.players.length >= lobby.settings.maxPlayers) return undefined;
  lobby.players.push({ id: playerId, name, avatar, joinedAt: Date.now() });
  await repo.save(lobby);
  return lobby;
}

export async function removePlayerFromLobby(lobbyId: string, playerId: string): Promise<void> {
  const lobby = await repo.findById(lobbyId);
  if (!lobby) return;
  lobby.players = lobby.players.filter((p) => p.id !== playerId);
  if (lobby.players.length === 0) {
    await repo.deleteById(lobbyId);
  } else {
    await repo.save(lobby);
  }
}

export async function setLobbyState(lobbyId: string, state: Lobby['state']): Promise<void> {
  const lobby = await repo.findById(lobbyId);
  if (lobby) {
    lobby.state = state;
    await repo.save(lobby);
  }
}

export async function setLobbyCategory(lobbyId: string, category: string): Promise<void> {
  const lobby = await repo.findById(lobbyId);
  if (lobby) {
    lobby.category = category;
    await repo.save(lobby);
  }
}

export async function updateLobbySettings(lobbyId: string, partial: Partial<LobbySettings>): Promise<Lobby | undefined> {
  const lobby = await repo.findById(lobbyId);
  if (!lobby) return undefined;
  lobby.settings = { ...lobby.settings, ...partial };
  await repo.save(lobby);
  return lobby;
}

export async function deleteLobby(lobbyId: string): Promise<void> {
  await repo.deleteById(lobbyId);
}

async function generateCode(): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code: string;
  let attempts = 0;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    attempts++;
    const existing = await repo.findByCode(code);
    if (!existing) return code;
  } while (attempts < 50);
  return code + (Date.now() % 10);
}