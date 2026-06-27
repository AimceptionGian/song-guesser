// ─── Auth Service ───
// Simple token-based session management for players.
// Tokens are generated on lobby creation/join and validated on protected routes.

import type { SessionRepository } from '../db/repositories/repository';
import { InMemorySessionRepository } from '../db/repositories/in-memory-repository';
import type { PlayerSession } from '../types';

let repo: SessionRepository = new InMemorySessionRepository();

const TOKEN_BYTES = 24;

/**
 * Override the session repository.
 */
export function setSessionRepository(repository: SessionRepository): void {
  repo = repository;
}

/**
 * Generate a cryptographically random token.
 */
export function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Create a new session for a player.
 * Returns the session token.
 */
export async function createSession(playerId: string, lobbyId: string, name: string): Promise<string> {
  const token = generateToken();
  await repo.addSession(token, {
    playerId,
    lobbyId,
    name,
    createdAt: Date.now(),
  });
  return token;
}

/**
 * Validate a session token.
 * Returns the session data if valid, null otherwise.
 */
export async function validateSession(token: string): Promise<PlayerSession | null> {
  return repo.findByToken(token);
}

/**
 * Remove a session (logout / lobby leave).
 */
export async function destroySession(token: string): Promise<void> {
  await repo.deleteByToken(token);
}

/**
 * Invalidate all sessions for a given lobby (used when match ends).
 */
export async function destroyLobbySessions(lobbyId: string): Promise<void> {
  await repo.deleteByLobbyId(lobbyId);
}

/**
 * Extract session token from request headers (Authorization: Bearer <token>).
 */
export function extractTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth) return null;
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}