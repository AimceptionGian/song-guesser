import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryLobbyRepository, InMemorySessionRepository } from '../in-memory-repository';
import type { Lobby } from '../../types';

describe('InMemoryLobbyRepository', () => {
  let repo: InMemoryLobbyRepository;

  beforeEach(() => {
    repo = new InMemoryLobbyRepository();
  });

  const sampleLobby = (overrides: Partial<Lobby> = {}): Lobby => ({
    id: 'lobby-1',
    code: 'ABCD',
    hostId: 'host-1',
    players: [{ id: 'host-1', name: 'Alice', avatar: '🎵', joinedAt: Date.now() }],
    state: 'waiting',
    settings: { maxPlayers: 4, totalRounds: 5, maxPoints: 1000, timelineOnlyScoring: false, yearRange: { min: 1960, max: 2024 } },
    category: null,
    createdAt: Date.now(),
    ...overrides,
  });

  it('should save and find by id', async () => {
    const lobby = sampleLobby();
    await repo.save(lobby);
    const found = await repo.findById('lobby-1');
    expect(found).not.toBeNull();
    expect(found!.code).toBe('ABCD');
  });

  it('should find by code', async () => {
    await repo.save(sampleLobby());
    const found = await repo.findByCode('ABCD');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('lobby-1');
  });

  it('should return null for unknown id', async () => {
    const found = await repo.findById('unknown');
    expect(found).toBeNull();
  });

  it('should return null for unknown code', async () => {
    const found = await repo.findByCode('XXXX');
    expect(found).toBeNull();
  });

  it('should delete by id', async () => {
    await repo.save(sampleLobby());
    await repo.deleteById('lobby-1');
    expect(await repo.findById('lobby-1')).toBeNull();
  });

  it('should return all lobbies', async () => {
    await repo.save(sampleLobby({ id: 'l1', code: 'A' }));
    await repo.save(sampleLobby({ id: 'l2', code: 'B' }));
    const all = await repo.findAll();
    expect(all).toHaveLength(2);
  });

  it('should update existing lobby on save', async () => {
    await repo.save(sampleLobby());
    await repo.save(sampleLobby({ state: 'starting' }));
    const found = await repo.findById('lobby-1');
    expect(found!.state).toBe('starting');
  });
});

describe('InMemorySessionRepository', () => {
  let repo: InMemorySessionRepository;

  beforeEach(() => {
    repo = new InMemorySessionRepository();
  });

  it('should add and find by token', async () => {
    await repo.addSession('token-1', { playerId: 'p1', lobbyId: 'l1', name: 'Alice', createdAt: 100 });
    const found = await repo.findByToken('token-1');
    expect(found).not.toBeNull();
    expect(found!.playerId).toBe('p1');
  });

  it('should return null for unknown token', async () => {
    expect(await repo.findByToken('nope')).toBeNull();
  });

  it('should delete by token', async () => {
    await repo.addSession('t1', { playerId: 'p1', lobbyId: 'l1', name: 'A', createdAt: 0 });
    await repo.deleteByToken('t1');
    expect(await repo.findByToken('t1')).toBeNull();
  });

  it('should delete all sessions by lobbyId', async () => {
    await repo.addSession('t1', { playerId: 'p1', lobbyId: 'l1', name: 'A', createdAt: 0 });
    await repo.addSession('t2', { playerId: 'p2', lobbyId: 'l1', name: 'B', createdAt: 0 });
    await repo.addSession('t3', { playerId: 'p3', lobbyId: 'l2', name: 'C', createdAt: 0 });

    await repo.deleteByLobbyId('l1');

    expect(await repo.findByToken('t1')).toBeNull();
    expect(await repo.findByToken('t2')).toBeNull();
    expect(await repo.findByToken('t3')).not.toBeNull();
  });

  it('should find by playerId', async () => {
    await repo.addSession('t1', { playerId: 'p1', lobbyId: 'l1', name: 'A', createdAt: 0 });
    const found = await repo.findByPlayerId('p1');
    expect(found).not.toBeNull();
    expect(found!.lobbyId).toBe('l1');
  });

  it('should find all sessions by lobbyId', async () => {
    await repo.addSession('t1', { playerId: 'p1', lobbyId: 'l1', name: 'A', createdAt: 0 });
    await repo.addSession('t2', { playerId: 'p2', lobbyId: 'l1', name: 'B', createdAt: 0 });
    const found = await repo.findByLobbyId('l1');
    expect(found).toHaveLength(2);
  });
});