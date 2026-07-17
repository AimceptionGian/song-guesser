// ─── Durable Object–backed Lobby Repository ───
// Proxies lobby CRUD to the single global LobbyRegistry Durable Object
// instance, so every isolate/colo reads and writes the same storage
// instead of an isolate-local in-memory Map. See lobby-registry.ts for why.

import type { Lobby } from '../../types';
import type { LobbyRepository } from './repository';
import type { Env } from '../../env';

const REGISTRY_INSTANCE_NAME = 'global';

export class DurableObjectLobbyRepository implements LobbyRepository {
  constructor(private env: Env) {}

  private stub() {
    const id = this.env.LOBBY_REGISTRY.idFromName(REGISTRY_INSTANCE_NAME);
    return this.env.LOBBY_REGISTRY.get(id);
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await this.stub().fetch(`http://lobby-registry${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<T>;
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
