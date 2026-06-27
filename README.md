# 🎵 Beat Timeline — SongGuesser

**Rate Songs auf einer interaktiven Timeline.** Ziehe Karten, höre Preview-Clips, rate Interpret, Titel und Erscheinungsjahr — und sammle Punkte gegen deine Freunde.

![CI](https://github.com/GianLuetti/song-guesser/actions/workflows/ci.yml/badge.svg)
![Deploy Worker](https://github.com/GianLuetti/song-guesser/actions/workflows/deploy.yml/badge.svg)
![Deploy Frontend](https://github.com/GianLuetti/song-guesser/actions/workflows/deploy-frontend.yml/badge.svg)

---

## ✨ Features

| Feature | Status |
|---------|--------|
| 🎮 Lobby-System mit 4-stelligem Game-Code | ✅ |
| 🃏 Karten ziehen + auf Timeline platzieren | ✅ |
| 🎤 Interpret & Titel raten | ✅ |
| 📅 Jahres-Schätzung mit Punkte-System | ✅ |
| 🎵 Deezer 30s Preview-Player | ✅ |
| 🏆 Punktetafel + Final-Ranking | ✅ |
| 📱 Voll responsive (Mobile + Desktop) | ✅ |
| 🔐 Token-basiertes Session-Management | ✅ |
| 📜 Spotify-History-Sync (optional) | ✅ |
| 📤 Upload-Import für Play-History | ✅ |
| 💾 MongoDB Persistence (optional) | ✅ |

---

## 🧱 Tech Stack

| Layer | Technologie |
|-------|------------|
| **Frontend** | React 18 · TypeScript · Vite · React Router 6 |
| **Backend** | Cloudflare Workers · Hono · Durable Objects |
| **Testing** | Vitest 3 · Testing Library · jsdom |
| **CI/CD** | GitHub Actions · Cloudflare Pages + Workers |
| **APIs** | Deezer (Preview-Clips) · Jamendo (Fallback) · Spotify (History) |
| **DB** | In-Memory (dev) · MongoDB Atlas Data API (prod) |

---

## 🚀 Lokale Entwicklung

### Voraussetzungen

- Node.js 22+
- npm
- (Optional) [Cloudflare API Token](https://dash.cloudflare.com/profile/api-tokens)

### Setup

```bash
# 1. Repository klonen
git clone https://github.com/AimceptionGian/song-guesser.git
cd song-guesser

# 2. Frontend-Dependencies installieren
npm install

# 3. Backend-Dependencies installieren
cd workers
npm install
cd ..

# 4. (Optional) Environment-Variablen setzen
cp .env.example .env
# Bearbeite .env nach Bedarf (JAMENDO_CLIENT_ID für echte Tracks)
```

### Development starten

**Terminal 1 — Backend (Cloudflare Workers):**
```bash
cd workers
npx wrangler dev
```

**Terminal 2 — Frontend (Vite Dev Server):**
```bash
npm run dev
```

Dann im Browser öffnen: `http://localhost:3000`

### Nützliche Befehle

```bash
npm run dev          # Frontend-Dev-Server (Port 3000)
npm run build        # Frontend-Build
npm test             # Frontend-Tests
npx tsc --noEmit     # Frontend-TypeScript-Check

cd workers
npx wrangler dev     # Backend-Dev-Server (Port 8787)
npm test             # Backend-Tests (128 Tests / 11 Suiten)
npx tsc --noEmit     # Backend-TypeScript-Check
```

---

## 🏗️ Projekt-Struktur

```
song-guesser/
├── .github/workflows/   # CI/CD (ci.yml, deploy.yml, deploy-frontend.yml)
├── docs/                # Architektur-Dokumente, ADRs, WiPs
├── src/                 # React SPA
│   ├── components/      # Timeline, AudioPlayer, Scoreboard, etc.
│   ├── screens/         # LobbyScreen, GameScreen, ResultScreen, FinalScreen
│   ├── services/        # API Client
│   ├── hooks/           # useWebSocket
│   ├── styles/          # global.css
│   └── types/           # TypeScript Interfaces
├── workers/             # Cloudflare Worker API
│   ├── src/
│   │   ├── adapters/    # Deezer-, Jamendo-, Spotify-Adapter
│   │   ├── db/          # Repository-Interface, InMemory-, MongoDB-Impl.
│   │   ├── durable-objects/  # MatchRoom DO (Game State Machine)
│   │   ├── routes/      # Hono API Routes (lobbies, games, history, catalog)
│   │   ├── services/    # Scoring, Lobby, Category, Auth, History, Catalog
│   │   └── types/       # Worker TypeScript Interfaces
│   └── wrangler.toml    # Worker-Konfiguration
├── .env.example         # Alle benötigten Environment-Variablen
└── vite.config.ts       # Vite-Konfiguration (API-Proxy → :8787)
```

---

## 🌍 Deployment

Die App deployt **automatisch via GitHub Actions** bei Push auf `main`.

| Komponente | Pipeline | Trigger |
|-----------|----------|---------|
| **API Worker** | `deploy.yml` | Änderungen an `workers/**` |
| **Frontend (Pages)** | `deploy-frontend.yml` | Änderungen an `src/**` |
| **CI (Tests + Types)** | `ci.yml` | Push/PR auf `main`/`dev` |

### Manuelles Deployment

```bash
# Worker deployen
cd workers && npx wrangler deploy

# Frontend deployen
npm run build
npx wrangler pages deploy dist/
```

### Secrets (GitHub → Actions → Secrets)

| Secret | Beschreibung |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (Deployment) |
| `JAMENDO_CLIENT_ID` | Jamendo API Client ID |
| `SPOTIFY_CLIENT_ID` | Spotify App Client ID (History) |
| `SPOTIFY_CLIENT_SECRET` | Spotify App Client Secret |

---

## 🧪 Tests

```
✓ 11 Test Suites  |  128 Tests passed
✓ 0 TypeScript-Fehler
```

- **Backend:** Unit-Tests für alle Services (Scoring, Lobby, Category, Auth, Catalog + alle Adapter + MatchRoom DO)
- **Frontend:** (geplant — @testing-library/react)

Detail: `docs/TESTING.md`

---

## 🔑 Environment-Variablen

| Variable | Pflicht | Beschreibung |
|----------|---------|-------------|
| `JAMENDO_CLIENT_ID` | Nein | Katalog-Fallback (echte Preview-Tracks) |
| `SPOTIFY_CLIENT_ID` | Nein | Spotify OAuth für History-Sync |
| `SPOTIFY_CLIENT_SECRET` | Nein | Spotify OAuth Secret |
| `MONGODB_API_URL` | Nein | MongoDB Atlas Data API URL |
| `MONGODB_API_KEY` | Nein | MongoDB Data API Key |
| `MONGODB_DATABASE` | Nein | MongoDB Datenbank-Name |
| `CLOUDFLARE_API_TOKEN` | Ja (Deploy) | Cloudflare Deployment Token |

---

## 📚 Dokumentation

| Dokument | Inhalt |
|----------|--------|
| `docs/01-idea.md` | Ursprüngliches Konzept |
| `docs/03-architecture.md` | System-Architektur |
| `docs/04-ui-ux.md` | Wireframes & UX Flow |
| `docs/architecture-game-engine.md` | Game Engine Deep-Dive |
| `docs/TESTING.md` | Test-Strategie & Status |
| `docs/DECISIONS.md` | Architektur-Entscheidungen (ADRs) |
| `docs/CONTRIBUTING.md` | Contribution Guidelines |

---

## 📄 Lizenz

MIT © GianLuetti
