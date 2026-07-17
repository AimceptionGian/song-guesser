import { describe, it, expect, vi } from 'vitest';
import { DurableObjectLobbyRepository } from '../durable-object-repository';
import type { Lobby } from '../../../types';

function makeLobby(overrides: Partial<Lobby> = {}): Lobby {
  return {
    id: 'lobby-1',
    code: 'ABCD',
    hostId: 'host-1',
    players: [],
    state: 'waiting',
    settings: { maxPlayers: 4, totalRounds: 5, maxPoints: 1000, timelineOnlyScoring: false, yearRange: { min: 1960, max: 2024 } },
    category: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

/** Fake DO namespace: routes every idFromName() to the SAME stub regardless
 *  of the name, mirroring the always-"global" addressing the repository uses.
 *  Mimics the real stub.fetch(url, init) signature (like global fetch). */
function createFakeNamespace(fetchImpl: (req: Request) => Promise<Response>) {
  const stub = {
    fetch: vi.fn((url: string, init?: RequestInit) => fetchImpl(new Request(url, init))),
  };
  return {
    idFromName: vi.fn(() => 'fake-id'),
    get: vi.fn(() => stub),
    stub,
  };
}

describe('DurableObjectLobbyRepository', () => {
  it('findById posts to /findById and returns the lobby', async () => {
    const lobby = makeLobby();
    const ns = createFakeNamespace(async (req) => {
      expect(new URL(req.url).pathname).toBe('/findById');
      expect(await req.json()).toEqual({ id: 'lobby-1' });
      return Response.json({ lobby });
    });
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    const result = await repo.findById('lobby-1');
    expect(result).toEqual(lobby);
  });

  it('findByCode posts to /findByCode', async () => {
    const lobby = makeLobby({ code: 'WXYZ' });
    const ns = createFakeNamespace(async (req) => {
      expect(new URL(req.url).pathname).toBe('/findByCode');
      expect(await req.json()).toEqual({ code: 'WXYZ' });
      return Response.json({ lobby });
    });
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    const result = await repo.findByCode('WXYZ');
    expect(result?.code).toBe('WXYZ');
  });

  it('save posts the lobby to /save', async () => {
    const lobby = makeLobby();
    const ns = createFakeNamespace(async (req) => {
      expect(new URL(req.url).pathname).toBe('/save');
      expect(await req.json()).toEqual({ lobby });
      return Response.json({ ok: true });
    });
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    await repo.save(lobby);
    expect(ns.stub.fetch).toHaveBeenCalledOnce();
  });

  it('deleteById posts to /deleteById', async () => {
    const ns = createFakeNamespace(async (req) => {
      expect(new URL(req.url).pathname).toBe('/deleteById');
      expect(await req.json()).toEqual({ id: 'lobby-1' });
      return Response.json({ ok: true });
    });
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    await repo.deleteById('lobby-1');
    expect(ns.stub.fetch).toHaveBeenCalledOnce();
  });

  it('findAll posts to /findAll and returns the lobby list', async () => {
    const lobbies = [makeLobby({ id: 'a' }), makeLobby({ id: 'b', code: 'ZZZZ' })];
    const ns = createFakeNamespace(async (req) => {
      expect(new URL(req.url).pathname).toBe('/findAll');
      return Response.json({ lobbies });
    });
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    const result = await repo.findAll();
    expect(result).toHaveLength(2);
  });

  it('always addresses the same DO instance name regardless of lobby', async () => {
    const ns = createFakeNamespace(async () => Response.json({ lobby: null }));
    const repo = new DurableObjectLobbyRepository({ LOBBY_REGISTRY: ns } as any);

    await repo.findById('a');
    await repo.findById('b');

    expect(ns.idFromName).toHaveBeenCalledWith('global');
    expect(ns.idFromName).toHaveBeenCalledTimes(2);
    expect(ns.idFromName).not.toHaveBeenCalledWith(expect.stringMatching(/^(a|b)$/));
  });
});
