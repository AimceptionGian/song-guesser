// ─── MongoDB Atlas Data API Repository ───
// Uses the MongoDB Atlas Data API (REST) instead of the native driver,
// making it compatible with Cloudflare Workers (no TCP socket needed).
//
// Required env vars:
//   MONGODB_API_URL     – e.g. https://ap-southeast-1.data.mongodb-api.com/app/<app-id>/endpoint/data/v1
//   MONGODB_API_KEY     – Data API key
//   MONGODB_DATABASE    – database name
//   MONGODB_LOBBY_COLLECTION   – collection for lobbies (default "lobbies")
//   MONGODB_SESSION_COLLECTION – collection for sessions (default "sessions")

import type { Lobby, MatchState } from '../../types';
import type { PlayerSession } from '../../types';
import type { LobbyRepository, SessionRepository, MatchStateRepository } from './repository';

interface DataAPIPayload {
  dataSource: string;
  database: string;
  collection: string;
  document?: unknown;
  filter?: Record<string, unknown>;
  documents?: unknown[];
  projection?: Record<string, number>;
  sort?: Record<string, number>;
  limit?: number;
  update?: Record<string, unknown>;
}

interface Env {
  MONGODB_API_URL?: string;
  MONGODB_API_KEY?: string;
  MONGODB_DATABASE?: string;
  MONGODB_LOBBY_COLLECTION?: string;
  MONGODB_SESSION_COLLECTION?: string;
  MONGODB_MATCH_COLLECTION?: string;
}

function makePayload(
  collection: string,
  overrides: Partial<DataAPIPayload>,
  env: Env,
): DataAPIPayload {
  return {
    dataSource: 'SongGuesser',
    database: env.MONGODB_DATABASE || 'song-guesser',
    collection,
    ...overrides,
  };
}

async function dataApiPost(
  env: Env,
  action: string,
  payload: DataAPIPayload,
): Promise<Response> {
  if (!env.MONGODB_API_URL || !env.MONGODB_API_KEY) {
    throw new Error('MongoDB not configured: MONGODB_API_URL and MONGODB_API_KEY required');
  }
  const url = `${env.MONGODB_API_URL}/action/${action}`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': env.MONGODB_API_KEY,
    },
    body: JSON.stringify(payload),
  });
}

// ─── MongoDB Lobby Repository ───

export class MongoLobbyRepository implements LobbyRepository {
  constructor(private env: Env) {}

  private coll(): string {
    return this.env.MONGODB_LOBBY_COLLECTION || 'lobbies';
  }

  async findById(id: string): Promise<Lobby | null> {
    const res = await dataApiPost(this.env, 'findOne', makePayload(this.coll(), {
      filter: { id },
    }, this.env));
    if (!res.ok) return null;
    const body = await res.json() as { document?: Lobby };
    return body.document ?? null;
  }

  async findByCode(code: string): Promise<Lobby | null> {
    const res = await dataApiPost(this.env, 'findOne', makePayload(this.coll(), {
      filter: { code },
    }, this.env));
    if (!res.ok) return null;
    const body = await res.json() as { document?: Lobby };
    return body.document ?? null;
  }

  async findAll(): Promise<Lobby[]> {
    const res = await dataApiPost(this.env, 'find', makePayload(this.coll(), {
      filter: {},
      limit: 1000,
    }, this.env));
    if (!res.ok) return [];
    const body = await res.json() as { documents: Lobby[] };
    return body.documents ?? [];
  }

  async save(lobby: Lobby): Promise<void> {
    await dataApiPost(this.env, 'upsertOne', makePayload(this.coll(), {
      filter: { id: lobby.id },
      update: { $set: lobby },
    }, this.env));
  }

  async deleteById(id: string): Promise<void> {
    await dataApiPost(this.env, 'deleteOne', makePayload(this.coll(), {
      filter: { id },
    }, this.env));
  }
}

// ─── MongoDB Session Repository ───

export class MongoSessionRepository implements SessionRepository {
  constructor(private env: Env) {}

  private coll(): string {
    return this.env.MONGODB_SESSION_COLLECTION || 'sessions';
  }

  async findById(token: string): Promise<PlayerSession | null> {
    const res = await dataApiPost(this.env, 'findOne', makePayload(this.coll(), {
      filter: { token },
    }, this.env));
    if (!res.ok) return null;
    const body = await res.json() as { document?: PlayerSession & { token: string } };
    const doc = body.document;
    if (!doc) return null;
    const { token: _t, ...session } = doc;
    return session;
  }

  async findByPlayerId(playerId: string): Promise<PlayerSession | null> {
    const res = await dataApiPost(this.env, 'findOne', makePayload(this.coll(), {
      filter: { playerId },
    }, this.env));
    if (!res.ok) return null;
    const body = await res.json() as { document?: PlayerSession & { token: string } };
    return body.document ?? null;
  }

  async findByLobbyId(lobbyId: string): Promise<PlayerSession[]> {
    const res = await dataApiPost(this.env, 'find', makePayload(this.coll(), {
      filter: { lobbyId },
      limit: 100,
    }, this.env));
    if (!res.ok) return [];
    const body = await res.json() as { documents: Array<PlayerSession & { token: string }> };
    return (body.documents ?? []).map(({ token: _t, ...s }) => s);
  }

  async findAll(): Promise<PlayerSession[]> {
    const res = await dataApiPost(this.env, 'find', makePayload(this.coll(), {
      filter: {},
      limit: 1000,
    }, this.env));
    if (!res.ok) return [];
    const body = await res.json() as { documents: Array<PlayerSession & { token: string }> };
    return (body.documents ?? []).map(({ token: _t, ...s }) => s);
  }

  async save(session: PlayerSession): Promise<void> {
    // Cannot save without a token — use addSession
  }

  async addSession(token: string, session: PlayerSession): Promise<void> {
    await dataApiPost(this.env, 'upsertOne', makePayload(this.coll(), {
      filter: { token },
      update: { $set: { token, ...session } },
    }, this.env));
  }

  async findByToken(token: string): Promise<PlayerSession | null> {
    return this.findById(token);
  }

  async deleteByToken(token: string): Promise<void> {
    await dataApiPost(this.env, 'deleteOne', makePayload(this.coll(), {
      filter: { token },
    }, this.env));
  }

  async deleteById(id: string): Promise<void> {
    await this.deleteByToken(id);
  }

  async deleteByLobbyId(lobbyId: string): Promise<void> {
    await dataApiPost(this.env, 'deleteMany', makePayload(this.coll(), {
      filter: { lobbyId },
    }, this.env));
  }
}

// ─── MongoDB Match State Repository ───

export class MongoMatchStateRepository implements MatchStateRepository {
  constructor(private env: Env) {}

  private coll(): string {
    return this.env.MONGODB_MATCH_COLLECTION || 'matches';
  }

  async findById(id: string): Promise<MatchState | null> {
    const res = await dataApiPost(this.env, 'findOne', makePayload(this.coll(), {
      filter: { lobbyId: id },
    }, this.env));
    if (!res.ok) return null;
    const body = await res.json() as { document?: MatchState };
    return body.document ?? null;
  }

  async findByLobbyId(lobbyId: string): Promise<MatchState | null> {
    return this.findById(lobbyId);
  }

  async findAll(): Promise<MatchState[]> {
    const res = await dataApiPost(this.env, 'find', makePayload(this.coll(), {
      filter: {},
      limit: 1000,
    }, this.env));
    if (!res.ok) return [];
    const body = await res.json() as { documents: MatchState[] };
    return body.documents ?? [];
  }

  async save(state: MatchState): Promise<void> {
    await dataApiPost(this.env, 'upsertOne', makePayload(this.coll(), {
      filter: { lobbyId: state.lobbyId },
      update: { $set: state },
    }, this.env));
  }

  async deleteById(id: string): Promise<void> {
    await dataApiPost(this.env, 'deleteOne', makePayload(this.coll(), {
      filter: { lobbyId: id },
    }, this.env));
  }
}