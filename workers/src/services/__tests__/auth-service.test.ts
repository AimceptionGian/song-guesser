import { describe, it, expect } from 'vitest';
import {
  createSession,
  validateSession,
  destroySession,
  destroyLobbySessions,
  extractTokenFromRequest,
  generateToken,
} from '../auth-service';

describe('auth-service', () => {
  describe('generateToken', () => {
    it('should generate a 48-character hex token', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{48}$/);
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('createSession / validateSession', () => {
    it('should create a valid session', async () => {
      const token = await createSession('player-1', 'lobby-1', 'Alice');

      expect(token).toMatch(/^[0-9a-f]{48}$/);

      const session = await validateSession(token);
      expect(session).not.toBeNull();
      expect(session!.playerId).toBe('player-1');
      expect(session!.lobbyId).toBe('lobby-1');
      expect(session!.name).toBe('Alice');
      expect(session!.createdAt).toBeGreaterThan(0);
    });

    it('should return null for invalid token', async () => {
      const session = await validateSession('invalid-token');
      expect(session).toBeNull();
    });

    it('should return null for non-existent token', async () => {
      const session = await validateSession('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(session).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('should invalidate a session', async () => {
      const token = await createSession('player-2', 'lobby-2', 'Bob');
      expect(await validateSession(token)).not.toBeNull();

      await destroySession(token);
      expect(await validateSession(token)).toBeNull();
    });
  });

  describe('destroyLobbySessions', () => {
    it('should invalidate all sessions for a lobby', async () => {
      const token1 = await createSession('p1', 'lobby-3', 'Alice');
      const token2 = await createSession('p2', 'lobby-3', 'Bob');
      const token3 = await createSession('p3', 'lobby-4', 'Charlie');

      await destroyLobbySessions('lobby-3');

      expect(await validateSession(token1)).toBeNull();
      expect(await validateSession(token2)).toBeNull();
      expect(await validateSession(token3)).not.toBeNull();
    });
  });

  describe('extractTokenFromRequest', () => {
    it('should extract token from Authorization header', () => {
      const request = new Request('http://localhost', {
        headers: { Authorization: 'Bearer my-token-123' },
      });
      const token = extractTokenFromRequest(request);
      expect(token).toBe('my-token-123');
    });

    it('should return null when no Authorization header', () => {
      const request = new Request('http://localhost');
      const token = extractTokenFromRequest(request);
      expect(token).toBeNull();
    });

    it('should return null when scheme is not Bearer', () => {
      const request = new Request('http://localhost', {
        headers: { Authorization: 'Basic abc123' },
      });
      const token = extractTokenFromRequest(request);
      expect(token).toBeNull();
    });

    it('should return null when token is missing', () => {
      const request = new Request('http://localhost', {
        headers: { Authorization: 'Bearer ' },
      });
      const token = extractTokenFromRequest(request);
      expect(token).toBeNull();
    });
  });
});