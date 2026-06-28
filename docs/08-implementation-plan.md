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

### 🐛 Bugfixes (nach Deployment entdeckt) ✅ ALLE BEHOBEN (2026-06-28)
- [x] Fix `calculateScore()` — removed dead code (was comparing against empty strings)
- [x] **#1 Lobby-Flow korrigieren** — `handleCreateGame()` navigiert nicht mehr direkt zu `/game/:code`. LobbyScreen zeigt nach Erstellen den Code + wartende Spieler (Polling alle 2s). Host kann Spiel starten.
- [x] **#2 Punkte-System umbauen** — Neues 4×1-System implementiert:
  - 1 Punkt: Karte RICHTIG in Timeline eingeordnet (vor/nach bestehenden Karten aus früheren Runden)
  - 1 Punkt: Exaktes Jahr getroffen
  - 1 Punkt: Interpret richtig
  - 1 Punkt: Titel richtig
  - Altes `calculateFullScore()` mit 150/150/200 + Jahr-Abzug wurde durch neues System ersetzt
  - Backend `calculateFullScore()` + Frontend `handleSubmit()` umgestellt
  - Tests komplett neu geschrieben (12 Tests für das 4×1-System)
- [x] **#3 Song-Snippets abspielbar machen** — `previewUrl` in alle 15 Mock-Tracks eingefügt (echte Deezer-Preview-URLs)
- [x] **#4 Platzierte Karten auf Timeline anzeigen** — Timeline rendert Mini-Karten mit Emoji, Titel, Stem-Line und Dot (V7-Wireframe-Design). `placedCards` werden nach Navigation via Player-State korrekt wiederhergestellt.
- [x] **#5 Lobby-Einstellungen UI** — Lobby-Warteraum mit Spielerliste; Host kann Spiel starten. Lobby-Settings werden im Wartezimmer angezeigt.

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
- [x] MongoDB Atlas Free integration (repository layer via Data API)
- [x] Repository interfaces: LobbyRepository, SessionRepository, MatchStateRepository
- [x] In-memory repositories (dev/testing default)
- [x] MongoDB repositories (via Atlas Data API REST — CF Workers compatible)
- [x] RepositoryContext factory (autoselect MongoDB vs in-memory based on env)
- [x] Service layer migrated to async repository pattern
- [x] Event-sourcing from MatchRoom to DB — DO storage persistence after every mutation
- [x] MongoMatchStateRepository for MongoDB match state persistence
- [x] MatchRoom state recovery on wake-up via `ctx.storage.get()`

### 🎨 Frontend Polish
- [x] AudioPlayer: full HTML5 Audio API with play/pause, progress bar, seek, error handling
- [x] Error states: WS error banner in GameScreen, redirect guard for missing gameCode
- [x] Loading states: spinner + disabled button during card draw, WS connection indicator
- [x] Mobile responsive verification (clamp(), responsive grids, breakpoints, touch-friendly Timeline)

### 🔐 Auth & History
- [x] Auth service (session management, tokens) — token-based PlayerSession CRUD, Authorization header extraction
- [x] Spotify history sync adapter — SpotifyHistoryProvider (recently-played + top-tracks fallback), HistoryService, 4 API routes
- [x] Upload-import fallback — `POST /history/import` accepts manual track uploads as player history

### 🚀 DevOps
- [x] CI/CD pipeline (GitHub Actions) — CI (lint, typecheck, test, build) + Deploy Worker + Deploy Frontend
- [x] **wrangler.toml** — alle Env-Vars in `[vars]`, compatibility_date auf 2026-06-01
- [x] **vite.config.ts** — Production-Build config (`base: '/'`, `sourcemap: false`)
- [x] **CI Workflows** — Node 22 statt 20
- [x] **Root vitest** — downgrade auf 3.2.4 (Node 24 Kompatibilität)
- [x] **`.env.example`** — alle 10 Env-Vars dokumentiert
- [x] **`README.md`** — vollständige Projektdoku (Setup, Deployment, Env-Vars, Tests)
- [ ] Environment segregation (dev/staging/prod)
- [ ] Secrets management

## Risks
- Scope creep
- Spotify Policy: "Trivia quizzes" nicht erlaubt → non-Spotify-Architektur als Primärpfad
- Vitest 4.x inkompatibel mit Node 24 → auf 3.x ausgewichen

## Open Questions
- Test Package 1 not yet approved — implementation started without it as agreed
- Whether to add MongoDB now or keep in-memory for MVP

## Status
in-progress

---
*Letzte Aktualisierung: 2026-06-28 — 5 Bugfix-Einträge (#1–#5) nach Deployment-Review hinzugefügt.*
