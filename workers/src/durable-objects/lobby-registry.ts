import { DurableObject } from 'cloudflare:workers';
import type { Lobby } from '../types';
import type { HistoryTrack } from '../adapters/history-provider';
import type { Env } from '../env';

/**
 * LobbyRegistry — single global Durable Object instance holding every lobby.
 *
 * Lobbies previously lived in a per-isolate in-memory Map, but Cloudflare
 * routes different requests to different isolates (different colos, or a
 * fresh isolate after eviction). Two players joining from different devices
 * — the normal multiplayer case — could easily hit different isolates, so
 * "create lobby" and "join lobby" saw different, empty Maps and the join
 * failed with "Lobby not found". A Durable Object is addressed by a stable
 * name and Cloudflare guarantees a single active instance for that name
 * worldwide, so every request lands on the same storage.
 */
export class LobbyRegistry extends DurableObject {
  private storage: DurableObjectState['storage'];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case '/findById': {
        const { id } = (await request.json()) as { id: string };
        const lobby = (await this.storage.get<Lobby>(`lobby:${id}`)) ?? null;
        return Response.json({ lobby });
      }
      case '/findByCode': {
        const { code } = (await request.json()) as { code: string };
        const id = await this.storage.get<string>(`code:${code}`);
        const lobby = id ? ((await this.storage.get<Lobby>(`lobby:${id}`)) ?? null) : null;
        return Response.json({ lobby });
      }
      case '/findAll': {
        const entries = await this.storage.list<Lobby>({ prefix: 'lobby:' });
        return Response.json({ lobbies: Array.from(entries.values()) });
      }
      case '/save': {
        const { lobby } = (await request.json()) as { lobby: Lobby };
        // Codes are immutable once a lobby exists in this app, but guard
        // against a stale code index anyway if that ever changes.
        const existing = await this.storage.get<Lobby>(`lobby:${lobby.id}`);
        if (existing && existing.code !== lobby.code) {
          await this.storage.delete(`code:${existing.code}`);
        }
        await this.storage.put(`lobby:${lobby.id}`, lobby);
        await this.storage.put(`code:${lobby.code}`, lobby.id);
        return Response.json({ ok: true });
      }
      case '/deleteById': {
        const { id } = (await request.json()) as { id: string };
        const lobby = await this.storage.get<Lobby>(`lobby:${id}`);
        await this.storage.delete(`lobby:${id}`);
        if (lobby) await this.storage.delete(`code:${lobby.code}`);
        // Cascade: drop all player histories synced for this lobby
        const histories = await this.storage.list({ prefix: `history:${id}:` });
        for (const key of histories.keys()) {
          await this.storage.delete(key);
        }
        return Response.json({ ok: true });
      }
      // Player listening histories, stored per lobby so the history-based
      // game categories see the same data regardless of which isolate
      // handled the sync request.
      case '/saveHistory': {
        const { lobbyId, playerId, tracks } = (await request.json()) as {
          lobbyId: string; playerId: string; tracks: HistoryTrack[];
        };
        await this.storage.put(`history:${lobbyId}:${playerId}`, tracks);
        return Response.json({ ok: true });
      }
      case '/getHistories': {
        const { lobbyId } = (await request.json()) as { lobbyId: string };
        const prefix = `history:${lobbyId}:`;
        const entries = await this.storage.list<HistoryTrack[]>({ prefix });
        const histories: Record<string, HistoryTrack[]> = {};
        for (const [key, tracks] of entries) {
          histories[key.slice(prefix.length)] = tracks;
        }
        return Response.json({ histories });
      }
      default:
        return new Response('Not found', { status: 404 });
    }
  }
}
