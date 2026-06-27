import { describe, it, expect } from 'vitest';
import {
  createLobby,
  getLobbyByCode,
  getLobby,
  addPlayerToLobby,
  removePlayerFromLobby,
  setLobbyState,
  deleteLobby,
} from '../lobby-service';

describe('lobby-service', () => {
  const hostName = 'TestHost';
  const hostAvatar = 'avatar-1';

  it('should create a lobby with host as first player', async () => {
    const lobby = await createLobby('host-1', hostName, hostAvatar);

    expect(lobby.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(lobby.hostId).toBe('host-1');
    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0].name).toBe(hostName);
    expect(lobby.state).toBe('waiting');
    expect(lobby.settings.maxPlayers).toBe(4);
    expect(lobby.settings.totalRounds).toBe(5);
  });

  it('should create lobby with custom settings', async () => {
    const lobby = await createLobby('host-2', hostName, hostAvatar, {
      maxPlayers: 8,
      totalRounds: 10,
    });

    expect(lobby.settings.maxPlayers).toBe(8);
    expect(lobby.settings.totalRounds).toBe(10);
  });

  it('should find lobby by code', async () => {
    const lobby = await createLobby('host-3', hostName, hostAvatar);
    const found = await getLobbyByCode(lobby.code);

    expect(found).toBeDefined();
    expect(found!.id).toBe(lobby.id);
  });

  it('should return undefined for unknown code', async () => {
    const found = await getLobbyByCode('XXXX');
    expect(found).toBeUndefined();
  });

  it('should find lobby by id', async () => {
    const lobby = await createLobby('host-4', hostName, hostAvatar);
    const found = await getLobby(lobby.id);

    expect(found).toBeDefined();
    expect(found!.code).toBe(lobby.code);
  });

  it('should add player to lobby', async () => {
    const lobby = await createLobby('host-5', hostName, hostAvatar);
    const updated = await addPlayerToLobby(lobby.id, 'player-2', 'Player2', 'avatar-2');

    expect(updated).toBeDefined();
    expect(updated!.players).toHaveLength(2);
    expect(updated!.players[1].name).toBe('Player2');
  });

  it('should not add player to full lobby', async () => {
    const lobby = await createLobby('host-6', hostName, hostAvatar, { maxPlayers: 1 });
    const updated = await addPlayerToLobby(lobby.id, 'player-2', 'Player2', 'avatar-2');

    expect(updated).toBeUndefined();
  });

  it('should remove player from lobby', async () => {
    const lobby = await createLobby('host-7', hostName, hostAvatar);
    await addPlayerToLobby(lobby.id, 'player-2', 'Player2', 'avatar-2');
    await removePlayerFromLobby(lobby.id, 'player-2');

    expect(lobby.players).toHaveLength(1);
    expect(lobby.players[0].id).toBe('host-7');
  });

  it('should delete lobby when last player leaves', async () => {
    const lobby = await createLobby('host-8', hostName, hostAvatar);
    await removePlayerFromLobby(lobby.id, 'host-8');

    const found = await getLobby(lobby.id);
    expect(found).toBeUndefined();
  });

  it('should update lobby state', async () => {
    const lobby = await createLobby('host-9', hostName, hostAvatar);
    await setLobbyState(lobby.id, 'starting');

    expect(lobby.state).toBe('starting');
  });

  it('should delete lobby', async () => {
    const lobby = await createLobby('host-10', hostName, hostAvatar);
    await deleteLobby(lobby.id);

    const found = await getLobby(lobby.id);
    expect(found).toBeUndefined();
  });

  it('should generate unique codes', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const lobby = await createLobby(`host-${i}`, hostName, hostAvatar);
      codes.add(lobby.code);
    }
    expect(codes.size).toBe(100);
  });

  it('should generate codes without ambiguous characters', async () => {
    for (let i = 0; i < 100; i++) {
      const lobby = await createLobby(`host-${i}`, hostName, hostAvatar);
      expect(lobby.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    }
  });
});