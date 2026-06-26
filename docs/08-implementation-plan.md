# 08 Implementation Plan

## Goal
Plan and track implementation slices aligned with approved test packages.

## Inputs
- docs/03-architecture.md
- docs/04-ui-ux.md
- docs/07a-test-package-1.md

## Decisions
- Implementation slices: Frontend SPA first (Slice 1), then backend/integration (Slice 2+)
- Delivery order: Screens → Components → Mock Data → Hooks → Build Verification

## Slice 1 — Frontend Foundation (completed 2026-06-22)
- [x] Vite + React + TypeScript project scaffolded
- [x] React Router with 4 routes: `/`, `/game/:gameCode`, `/result`, `/final`
- [x] All screens: LobbyScreen, GameScreen, ResultScreen, FinalScreen
- [x] Reusable components: Timeline, Scoreboard, AudioPlayer, AmbientBackground
- [x] Mock data layer with 15 songs, 3 players, game settings
- [x] Timeline interaction (click/drag) with decade markers
- [x] Scoring logic (artist, title, year-accuracy based)
- [x] TypeScript compilation passes with zero errors

## Slice 2–7 — Backend Foundation (completed 2026-06-22)
- [x] Cloudflare Workers + Hono scaffolded
- [x] WebSocket realtime integration (MatchRoom Durable Object)
- [x] Scoring service with artist/title/year accuracy calculation
- [x] Lobby creation and player management (in-memory)
- [x] Category service with eligibility validation (mock)
- [x] API routes: health, lobbies CRUD, categories, WS relay
- [x] Catalog provider interface + MockCatalogProvider (15 tracks)
- [x] MatchRoom game state machine: start, draw, guess, end
- [x] TypeScript compilation passes with zero errors

## Remaining work

### 🐛 Bugfixes
- [x] Fix `calculateScore()` — removed dead code (was comparing against empty strings)

### 🔧 Infrastructure
- [x] Install Vitest and set up test infrastructure (frontend + backend)
- [x] Write unit tests for scoring service (10 tests)
- [x] Write unit tests for lobby service (12 tests)
- [x] Write unit tests for category service (8 tests)
- [x] Write unit tests for MatchRoom DO (20 tests — HTTP routing, start/draw/guess/end lifecycle, version tracking)

### 🎵 Catalog Provider (real)
- [ ] Deezer API adapter (real CatalogProvider implementation)
- [ ] Jamendo API adapter (secondary provider)
- [ ] Update TESTING.md with concrete strategy

### 🎵 Catalog Provider (real)
- [x] Deezer API adapter — search, getTrack, preview URLs, chart tracks, artist queries
- [x] CatalogService registry — Deezer primary, Jamendo secondary, Mock fallback
- [x] Catalog API endpoints — search, track detail, provider listing
- [x] Jamendo API adapter (secondary provider) — search, getTrack, preview URLs, genre mapping

### 💾 Persistence
- [ ] MongoDB Atlas Free integration (repository layer)
- [ ] Event-sourcing from MatchRoom to DB

### 🎨 Frontend Polish
- [x] AudioPlayer: full HTML5 Audio API with play/pause, progress bar, seek, error handling
- [x] Error states: WS error banner in GameScreen, redirect guard for missing gameCode
- [x] Loading states: spinner + disabled button during card draw, WS connection indicator
- [x] Mobile responsive verification (clamp(), responsive grids, breakpoints, touch-friendly Timeline)

### 🔐 Auth & History
- [ ] Auth service (session management, tokens)
- [ ] Spotify history sync adapter
- [ ] Upload-import fallback

### 🚀 DevOps
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Environment segregation (dev/staging/prod)
- [ ] Secrets management

## Risks
- Scope creep
- No test package approval gate passed yet

## Open Questions
- Test Package 1 not yet approved — implementation started without it as agreed
- Whether to add MongoDB now or keep in-memory for MVP

## Status
in-progress
