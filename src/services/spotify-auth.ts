// ─── Spotify OAuth (Authorization Code + PKCE) ───
// Runs entirely in the browser: PKCE needs no client secret, only the
// public client ID (served by the backend via /api/config). After the
// redirect back, the lobby session is restored from localStorage.

const VERIFIER_KEY = 'sg-spotify-verifier';
const PENDING_KEY = 'sg-spotify-pending';

export const SPOTIFY_SCOPES = 'user-read-recently-played user-top-read';

/** Lobby session info persisted across the OAuth redirect. */
export interface PendingSpotifyAuth {
  lobbyCode: string;
  playerId: string;
  isHost: boolean;
  token: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Kick off the Spotify authorization flow. Persists the PKCE verifier and
 * the lobby session, then navigates away to accounts.spotify.com.
 */
export async function beginSpotifyAuth(clientId: string, pending: PendingSpotifyAuth): Promise<void> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));

  localStorage.setItem(VERIFIER_KEY, verifier);
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: window.location.origin,
    scope: SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export function getPendingAuth(): PendingSpotifyAuth | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSpotifyAuth) : null;
  } catch {
    return null;
  }
}

export function clearPendingAuth(): void {
  localStorage.removeItem(PENDING_KEY);
  localStorage.removeItem(VERIFIER_KEY);
}

/**
 * Exchange the authorization code for a user access token (PKCE).
 * Returns null when the exchange fails or no verifier is stored.
 */
export async function exchangeCodeForToken(clientId: string, code: string): Promise<string | null> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) return null;

  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: window.location.origin,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      console.warn('[SpotifyAuth] token exchange failed:', res.status, await res.text().catch(() => ''));
      return null;
    }
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  } catch (err) {
    console.warn('[SpotifyAuth] token exchange error:', err);
    return null;
  }
}
