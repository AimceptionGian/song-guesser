# Testing

## Scope
- Unit tests for backend services (scoring, lobby, category, auth, catalog, history)
- Unit tests for all adapter providers (Deezer, Jamendo, Spotify, Mock)
- Unit tests for MatchRoom Durable Object (state machine, HTTP routing, version tracking)
- Integration tests for API routes and WebSocket game flow
- End-to-end validation via MatchRoom Durable Object

## Framework
- **Vitest v3** — test runner for both frontend and backend
- **@testing-library/react** — component tests (frontend)
- **jsdom** — browser environment simulation (frontend)

## Strategy

### Backend Unit Tests (`workers/`)
- `scoring-service.test.ts` — 4×1-Punktesystem: Artist, Title, Exact Year, Timeline Bucket (12 Tests)
- `lobby-service.test.ts` — CRUD operations, player limits, code generation uniqueness, cleanup (13 tests)
- `category-service.test.ts` — Category filtering by history access, eligibility validation (6 tests)
- `auth-service.test.ts` — Token generation entropy, session lifecycle, Authorization header parsing (11 tests)
- `catalog-service.test.ts` — Provider registry, fallback chaining, mock routing (7 tests)
- `deezer-catalog-provider.test.ts` — Search, getTrack, preview URLs, error handling, chart endpoints (10 tests)
- `jamendo-catalog-provider.test.ts` — Search, getTrack, preview URLs, error handling, genre mapping (10 tests)
- `spotify-history-provider.test.ts` — Recently-played, top-tracks fallback, API errors, multi-artist, import (10 tests)
- `history-service.test.ts` — Provider listing, Spotify sync, track import, unique artists/track IDs, clear (12 tests)
- `in-memory-repository.test.ts` — Lobby + Session repository CRUD (13 tests)
- `match-room.test.ts` — HTTP routing, start/draw/guess/end lifecycle, version tracking, WebSocket upgrade (27 tests)

### Frontend Tests (`src/`)
- Component rendering and interaction tests
- Scoring logic parity with backend
- Screen smoke tests (navigation, mock data rendering)

### Integration Tests
- Lobby creation → join → start → draw → guess → result flow
- WebSocket message relay through MatchRoom DO

## Running Tests

```bash
# Backend tests
cd workers && npm test

# Frontend tests
npm test

# Watch mode
npm run test:watch
```

## Execution

| Area | Status | Tests |
|------|--------|-------|
| Backend scoring service | ✅ | 9 |
| Backend lobby service | ✅ | 13 |
| Backend category service | ✅ | 6 |
| Backend auth service | ✅ | 11 |
| Catalog service registry | ✅ | 7 |
| Deezer catalog provider | ✅ | 10 |
| Jamendo catalog provider | ✅ | 10 |
| Spotify history provider | ✅ | 10 |
| History service | ✅ | 12 |
| In-memory repositories | ✅ | 13 |
| MatchRoom Durable Object | ✅ | 27 |
| Frontend components | ❌ Not started | Pending |
| Integration / E2E | ❌ Not started | Pending |
| **Total** | **11 suites** | **128 tests** |
