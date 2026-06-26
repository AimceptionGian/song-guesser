# Testing

## Scope
- Unit tests for backend services (scoring, lobby, category)
- Unit tests for frontend components (screens, components, hooks)
- Integration tests for API routes and WebSocket game flow
- End-to-end validation via MatchRoom Durable Object

## Framework
- **Vitest v4** — test runner for both frontend and backend
- **@testing-library/react** — component tests (frontend)
- **jsdom** — browser environment simulation (frontend)

## Strategy

### Backend Unit Tests (`workers/`)
- `scoring-service.test.ts` — Points calculation, case-insensitivity, year penalty clamping
- `lobby-service.test.ts` — CRUD operations, player limits, code generation uniqueness, cleanup
- `category-service.test.ts` — Category filtering by history access, eligibility validation
- Future: MatchRoom DO state machine tests (start, draw, guess, end)
- Future: API route tests (lobby endpoints, error responses)

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

| Area | Status | Notes |
|------|--------|-------|
| Backend scoring service | ✅ 9 tests | All passing |
| Backend lobby service | ✅ 12 tests | All passing |
| Backend category service | ✅ 8 tests | All passing |
| Deezer catalog provider | ✅ 13 tests | All passing (mocked fetch) |
| Catalog service registry | ✅ 7 tests | All passing (fallback chain) |
| Frontend components | ❌ Not started | Pending |
| Integration flow | ❌ Not started | Pending |
| MatchRoom DO | ❌ Not started | Needs DO runtime mocking |
