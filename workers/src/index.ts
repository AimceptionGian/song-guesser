import { Hono } from 'hono';
import { cors } from 'hono/cors';
import api from './routes/api';
import { MatchRoom } from './durable-objects/match-room';
import { LobbyRegistry } from './durable-objects/lobby-registry';
import { createRepositoryContext } from './db/repositories/context';
import { setLobbyRepository } from './services/lobby-service';
import { setSessionRepository } from './services/auth-service';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Bootstrap: wire up repositories based on environment config (runs once)
let initialized = false;
app.use('*', async (c, next) => {
  if (!initialized) {
    const ctx = createRepositoryContext(c.env as unknown as Env);
    setLobbyRepository(ctx.lobbies);
    setSessionRepository(ctx.sessions);
    initialized = true;
  }
  await next();
});

// Mount API routes
app.route('/api', api);

// Serve frontend static assets (when deployed via Pages)
app.get('/', (c) => c.redirect('/api/health'));

// Durable Object exports (required for Wrangler dev & deployment)
export { MatchRoom, LobbyRegistry };

// Fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;