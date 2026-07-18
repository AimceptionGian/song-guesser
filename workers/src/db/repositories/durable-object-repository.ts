// ─── Durable Object–backed Lobby Repository ───
// Proxies lobby CRUD to the single global LobbyRegistry Durable Object
// instance, so every isolate/colo reads and writes the same storage
// instead of an isolate-local in-memory Map. See lobby-registry.ts for why.

import type { Lobby } from '../../types';
import type { HistoryTrack } from '../../adapters/history-provider';
import type { LobbyRepository } from './repository';
import type { Env } from '../../env';

const REGISTRY_INSTANCE_NAME = 'global';

function registryStub(env: Env) {
  const id = env.LOBBY_REGISTRY.idFromName(REGISTRY_INSTANCE_NAME);
  return env.LOBBY_REGISTRY.get(id);
}

async function registryCall<T>(env: Env, path: string, body: unknown): Promise<T> {
  const res = await registryStub(env).fetch(`http://lobby-registry${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

/**
 * Per-lobby player listening histories, stored in the LobbyRegistry DO so
 * every isolate sees the same data (same reasoning as for lobbies).
 */
export class DurableObjectHistoryStore {
  constructor(private env: Env) {}

  async saveHistory(lobbyId: string, playerId: string, tracks: HistoryTrack[]): Promise<void> {
    await registryCall(this.env, '/saveHistory', { lobbyId, playerId, tracks });
  }

  async getHistories(lobbyId: string): Promise<Record<string, HistoryTrack[]>> {
    const { histories } = await registryCall<{ histories: Record<string, HistoryTrack[]> }>(
      this.env, '/getHistories', { lobbyId }
    );
    return histories;
  }
}

export class DurableObjectLobbyRepository implements LobbyRepository {
  constructor(private env: Env) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    return registryCall<T>(this.env, path, body);
  }

  async findById(id: string): Promise<Lobby | null> {
    const { lobby } = await this.call<{ lobby: Lobby | null }>('/findById', { id });
    return lobby;
  }

  async findByCode(code: string): Promise<Lobby | null> {
    const { lobby } = await this.call<{ lobby: Lobby | null }>('/findByCode', { code });
    return lobby;
  }

  async findAll(): Promise<Lobby[]> {
    const { lobbies } = await this.call<{ lobbies: Lobby[] }>('/findAll', {});
    return lobbies;
  }

  async save(lobby: Lobby): Promise<void> {
    await this.call('/save', { lobby });
  }

  async deleteById(id: string): Promise<void> {
    await this.call('/deleteById', { id });
  }
}
