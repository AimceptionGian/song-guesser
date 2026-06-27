// ─── Environment bindings ───

export interface Env {
  MATCH_ROOM: DurableObjectNamespace;
  JAMENDO_CLIENT_ID?: string;
  // Spotify integration (optional – for history sync only)
  SPOTIFY_CLIENT_ID?: string;
  SPOTIFY_CLIENT_SECRET?: string;
  // MongoDB Atlas Data API (optional – for persistent storage)
  MONGODB_API_URL?: string;
  MONGODB_API_KEY?: string;
  MONGODB_DATABASE?: string;
  MONGODB_LOBBY_COLLECTION?: string;
  MONGODB_SESSION_COLLECTION?: string;
  MONGODB_MATCH_COLLECTION?: string;
}