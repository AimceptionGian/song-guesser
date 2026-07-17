import { describe, it, expect, vi } from 'vitest';
import { LobbyRegistry } from './lobby-registry';
import type { Lobby } from '../types';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected ctx: any;
    protected env: any;
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

function createMockStorage() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    list: vi.fn(async (opts?: { prefix?: string }) => {
      if (!opts?.prefix) return new Map(store);
      const filtered = new Map<string, unknown>();
      for (const [k, v] of store) if (k.startsWith(opts.prefix)) filtered.set(k, v);
      return filtered;
    }),
  };
}

function createRegistry() {
  const storage = createMockStorage();
  const ctx = { storage } as any;
  const registry = new LobbyRegistry(ctx, {} as any);
  return { registry, storage };
}

function makeLobby(overrides: Partial<Lobby> = {}): Lobby {
  return {
    id: 'lobby-1',
    code: 'ABCD',
    hostId: 'host-1',
    players: [{ id: 'host-1', name: 'Host', avatar: '🎮', joinedAt: Date.now() }],
    state: 'waiting',
    settings: { maxPlayers: 4, totalRounds: 5, maxPoints: 1000, timelineOnlyScoring: false, yearRange: { min: 1960, max: 2024 } },
    category: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function post(registry: LobbyRegistry, path: string, body: unknown) {
  return registry.fetch(new Request(`http://lobby-registry${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
}

describe('LobbyRegistry', () => {
  it('saves a lobby and finds it by id', async () => {
    const { registry } = createRegistry();
    const lobby = makeLobby();

    await post(registry, '/save', { lobby });
    const res = await post(registry, '/findById', { id: lobby.id });
    const body = await res.json() as { lobby: Lobby | null };

    expect(body.lobby).toEqual(lobby);
  });

  it('finds a saved lobby by code', async () => {
    const { registry } = createRegistry();
    const lobby = makeLobby({ code: 'WXYZ' });

    await post(registry, '/save', { lobby });
    const res = await post(registry, '/findByCode', { code: 'WXYZ' });
    const body = await res.json() as { lobby: Lobby | null };

    expect(body.lobby?.id).toBe(lobby.id);
  });

  it('returns null for an unknown id or code', async () => {
    const { registry } = createRegistry();

    const byId = await (await post(registry, '/findById', { id: 'nope' })).json() as { lobby: Lobby | null };
    const byCode = await (await post(registry, '/findByCode', { code: 'NOPE' })).json() as { lobby: Lobby | null };

    expect(byId.lobby).toBeNull();
    expect(byCode.lobby).toBeNull();
  });

  it('lists all saved lobbies', async () => {
    const { registry } = createRegistry();
    await post(registry, '/save', { lobby: makeLobby({ id: 'a', code: 'AAAA' }) });
    await post(registry, '/save', { lobby: makeLobby({ id: 'b', code: 'BBBB' }) });

    const res = await post(registry, '/findAll', {});
    const body = await res.json() as { lobbies: Lobby[] };

    expect(body.lobbies).toHaveLength(2);
  });

  it('deletes a lobby by id and clears its code index', async () => {
    const { registry } = createRegistry();
    const lobby = makeLobby();
    await post(registry, '/save', { lobby });

    await post(registry, '/deleteById', { id: lobby.id });

    const byId = await (await post(registry, '/findById', { id: lobby.id })).json() as { lobby: Lobby | null };
    const byCode = await (await post(registry, '/findByCode', { code: lobby.code })).json() as { lobby: Lobby | null };
    expect(byId.lobby).toBeNull();
    expect(byCode.lobby).toBeNull();
  });

  it('updates the code index when a lobby is re-saved under the same id with a different code', async () => {
    const { registry } = createRegistry();
    const lobby = makeLobby({ code: 'OLD1' });
    await post(registry, '/save', { lobby });

    await post(registry, '/save', { lobby: { ...lobby, code: 'NEW1' } });

    const oldCode = await (await post(registry, '/findByCode', { code: 'OLD1' })).json() as { lobby: Lobby | null };
    const newCode = await (await post(registry, '/findByCode', { code: 'NEW1' })).json() as { lobby: Lobby | null };
    expect(oldCode.lobby).toBeNull();
    expect(newCode.lobby?.id).toBe(lobby.id);
  });

  it('returns 404 for an unknown path', async () => {
    const { registry } = createRegistry();
    const res = await registry.fetch(new Request('http://lobby-registry/unknown', { method: 'POST' }));
    expect(res.status).toBe(404);
  });
});
