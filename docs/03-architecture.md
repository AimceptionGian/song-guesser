# 03 Architecture

## Goal
Define a practical architecture blueprint for SongGuesser using the approved stack (Cloudflare Pages + Workers + Durable Objects + MongoDB Atlas Free), with explicit boundaries for gameplay authority, integrations, and data persistence.

## Inputs
- docs/01-idea.md (approved)
- docs/02-stack-selection.md (approved)
- Carry-over constraints:
	- Permanently free operation for hosting, realtime, and database within quota limits.
	- Modes: singleplayer, local multiplayer, online multiplayer.
	- Up to 2 active lobbies concurrently, 1-4 players per lobby, about 5 matches/week.
	- Cloudflare handles web/API/realtime; MongoDB Atlas Free is primary DB.
	- Self-host fallback only if free managed operation is no longer possible.

## Decisions
- System context and component boundaries
	- Web Client (Cloudflare Pages hosted SPA)
		- Responsibilities:
			- Render lobby/game UI for all modes.
			- Collect guesses, timeline placement, and host decisions.
			- Maintain authenticated session state and reconnect behavior.
		- Boundary:
			- No authoritative scoring or turn arbitration in client.
	- API Layer (Cloudflare Workers)
		- Responsibilities:
			- Handle HTTP endpoints for app auth callback, lobby setup, category pre-validation, catalog lookup orchestration, Spotify history sync, and read APIs.
			- Issue short-lived session tokens and enforce role checks (host/player).
			- Proxy provider API calls (never expose provider secrets to client where required).
			- Proxy Spotify history API calls server-side for player profile/history ingestion.
		- Boundary:
			- Stateless request/response orchestration only; no long-lived match authority.
	- Realtime Match Engine (Cloudflare Durable Objects)
		- Responsibilities:
			- Act as single authoritative state machine per lobby/match.
			- Enforce turn order, card draw progression, scoring rules, and game-end condition.
			- Broadcast state deltas to connected clients over WebSockets.
		- Boundary:
			- Own in-memory canonical match state during active session.
			- Persist snapshots/events through repository layer; do not embed DB access logic in client.
	- Persistence Layer (MongoDB Atlas Free)
		- Responsibilities:
			- Store durable entities: users, linked accounts, lobbies, match summaries, player cards, score events, category eligibility caches, uploaded-history metadata.
			- Support recovery/rejoin for interrupted sessions.
		- Boundary:
			- Not authoritative for turn sequencing in real time; Durable Object is authoritative during match.
	- External Integrations
		- Music Catalog Adapter (provider-agnostic interface).
		- Initial provider target: Deezer API for track metadata + preview URLs.
		- Secondary/fallback provider target: Jamendo API for license-friendly catalog segments.
		- Spotify Web API for playback history/profile data ingestion only (not for playback).
		- Boundary:
			- Integration adapters isolate provider-specific logic from game domain.

- Domain and service decomposition
	- Auth Service
		- App session issuance, role checks, and provider-link token handling (Spotify history consent).
	- Lobby Service
		- Lobby create/join/leave, host controls, ruleset configuration.
	- Category Service
		- Eligibility computation (hits, known-by-one, known-by-all, well-known), pre-validation before game start.
		- Supports all-time and optional last-12-month window.
	- Match Service (authoritative in Durable Object)
		- Commands: start match, draw card, submit guess, place card, resolve turn, end match.
	- Scoring Service
		- Applies default timeline-gated scoring and optional per-match scoring toggle.
		- Handles online auto-validation and local host-assisted scoring mode.
	- History Sync Service
		- Pull and normalize Spotify playback history/profile signals for category eligibility.
		- Provide upload-import fallback path when API sync is unavailable or denied.

- Data model boundaries (logical collections)
	- users
		- Identity, display name, account status.
	- provider_links
		- Provider account link metadata, scopes, token metadata references.
	- lobbies
		- Host, player roster, selected category, ruleset toggles, lifecycle state.
	- matches
		- Lobby reference, mode, start/end timestamps, winner/summary.
	- match_events
		- Event-sourced turn actions and scoring decisions (append-oriented).
	- player_cards
		- Card ownership and chronological placement for each player.
	- category_cache
		- Precomputed eligibility sets and freshness timestamps.
	- history_uploads
		- Upload metadata, parse status, retention/deletion markers.

- Primary request and event flows
	- Flow A: Login and session bootstrap
		- Client -> Worker: begin app login.
		- Worker: optional Spotify-link handshake when history-based features are enabled.
		- Worker -> DB: user/link upsert.
		- Worker -> Client: session established.
	- Flow B: Lobby creation and category pre-validation
		- Host Client -> Worker: create lobby with mode/category/ruleset.
		- Worker -> History Sync Service: refresh Spotify-based history cache (if token valid).
		- Worker -> Category Service: evaluate eligibility using Spotify history cache and selected catalog provider data.
		- Worker -> DB: store lobby config and validation result.
		- Worker -> Client: return lobby token and join endpoint.
	- Flow C: Online turn execution (authoritative)
		- Player Client -> Durable Object: turn command (draw/guess/place).
		- Durable Object: validate command against current state and role.
		- Durable Object -> Scoring logic: compute score outcome per ruleset.
		- Durable Object -> DB (async write path via Worker/repository): append event and periodic snapshot.
		- Durable Object -> All Clients: broadcast updated match state.
	- Flow D: Local multiplayer scoring
		- Local Host Client -> Durable Object: host-entered result for turn.
		- Durable Object: apply manual scoring payload and advance turn.
		- Durable Object -> DB: persist score event.
	- Flow E: End game and summary
		- Durable Object: detect each player reached 10 cards.
		- Durable Object -> DB: finalize match summary and scoreboard.
		- Client -> Worker: fetch completed match summary view.

- Integration boundaries and contracts
	- Worker-to-CatalogProvider adapter
		- All provider API traffic isolated behind adapter interfaces.
		- Domain never consumes raw provider payloads directly; adapter returns normalized DTOs.
	- Worker-to-SpotifyHistory adapter
		- Spotify history/profile calls are isolated behind an adapter with normalized history DTOs.
		- Adapter stores minimum required fields only for category computation and fairness checks.
	- Worker-to-DurableObject contract
		- Command envelope: commandType, actorId, lobbyId, expectedVersion, payload, clientTimestamp.
		- Response envelope: accepted/rejected, newVersion, stateDelta, errorCode.
	- DurableObject-to-Repository contract
		- Append event (idempotent key), checkpoint snapshot every N turns, summary write at match end.

- Reliability, consistency, and fairness decisions
	- Authoritative server state
		- Durable Object is the single writer for match state to avoid race conditions.
	- Idempotency
		- Command IDs prevent duplicate scoring from reconnect/retry.
	- Optimistic versioning
		- expectedVersion in commands prevents stale client updates from overriding current state.
	- Rejoin recovery
		- Client resync pulls latest snapshot + pending deltas from authoritative object.
	- Spotify history sync degradation policy
		- Pre-match sync window: one live sync attempt with a hard timeout of 8 seconds.
		- Retry policy: maximum 2 retries (backoff 1 second, then 2 seconds).
		- If live sync still fails and cached history for all required players is <= 24 hours old, start match with cache and show warning: "Using cached listening history."
		- If cache is missing/stale for any required player, switch to upload-import fallback before match start.
		- If fallback data is still unavailable, disable history-dependent categories for that lobby and allow preview-only categories so match flow is not blocked.
	- User-facing fallback messages (fixed copy for v1)
		- Sync in progress: "Syncing Spotify listening history..."
		- Retry notice: "Spotify sync is taking longer than expected. Retrying..."
		- Cache fallback used: "Using cached listening history (last synced: {relative_time})."
		- Import fallback required: "We could not refresh Spotify history. Please import your history file to continue with history-based categories."
		- History categories disabled: "Spotify history is currently unavailable. This lobby will continue with preview-only categories."
		- Scope/permission missing: "Spotify history permission is missing. Reconnect Spotify to re-enable history-based categories."

- Quota and cost guardrail decisions (free-tier compliance)
	- Enforce max two active lobbies globally for v1 via coordination key.
	- Limit realtime payload size and event frequency; broadcast deltas not full state.
	- Cache category eligibility per lobby and reuse during match lifecycle.
	- Persist compact events/snapshots; avoid high-frequency heavy writes.
	- Operational alerts for Atlas envelope: storage, transfer, ops/s, connection count.
	- Trigger self-host fallback when managed free tiers can no longer support required usage without paid upgrade.

- Security and privacy decisions
	- Secrets only in Workers environment bindings.
	- Token metadata persisted; sensitive token material minimized and rotated.
	- Uploaded history treated as sensitive user data with explicit retention/deletion workflow.
	- Audit trail for host manual scoring actions in local mode.
	- Match event retention is capped at 30 days.

- Catalog/provider compliance decisions
	- Spotify decision lock:
		- Based on current policy wording and developer-forum signals, Spotify approval for a trivia game is treated as not realistically obtainable for v1.
		- Spotify playback/control integration is removed from the production-critical path.
		- Spotify history ingestion remains a requested feature but is treated as a compliance-sensitive dependency.
	- New provider baseline:
		- Primary: Deezer API track metadata with `preview` URLs (30-second clips in track/search responses).
		- Constraint: comply with Deezer non-commercial terms and private-use positioning.
		- Full-length playback remains out of scope; quiz flow is designed around preview clips only.
	- Secondary provider option:
		- Jamendo API for license-flexible catalog segments where needed.
		- Use license filters and attribution rules per returned license metadata.
	- Integration rule:
		- All audio/content calls go through a provider adapter (`CatalogProvider`) so provider changes do not affect game logic.
		- All history/profile ingestion goes through a dedicated adapter (`HistoryProvider`) with Spotify as primary source.

- Plan B (Spotify playback companion, no Spotify playback API dependency)
	- Concept:
		- Keep the game engine provider-agnostic and preview-based (non-Spotify provider).
		- Online mode optionally exposes user-opened Spotify links only as companion links (no Spotify API auth/scopes).
		- Local mode optionally displays Spotify Codes/QR that resolve to Spotify track links for manual playback by players.
	- Why this Plan B is "ok" as fallback:
		- It is not relied on for core game correctness, scoring, or availability.
		- Core quiz operation remains functional without Spotify playback integration.
		- If Spotify history sync is temporarily unavailable, history upload/import fallback can keep category eligibility functional.
		- Spotify companion actions are optional, user-initiated, and replaceable.
	- Hard limitations to keep in scope:
		- Track identity can be revealed by the Spotify client UI once opened.
		- Background playback behavior is device/client dependent and cannot be guaranteed.
		- Companion mode must remain non-blocking and disabled by default in compliance-sensitive environments.

- Major alternatives considered and trade-offs
	- Alternative 1: Cloudflare + D1 only (without Atlas)
		- Benefit: lower cross-platform complexity.
		- Trade-off: rejected due to product-owner preference for MongoDB document workflow.
	- Alternative 2: Firebase-first stack
		- Benefit: fast prototype path.
		- Trade-off: weaker cost predictability and no-cold-start alignment under multiplayer usage.
	- Alternative 3: Self-host Node + Postgres as primary
		- Benefit: full control, no provider quota dependency.
		- Trade-off: rejected as primary due to higher ongoing ops overhead.
	- Alternative 4: Spotify desktop-app playback companion
		- Benefit: playback happens in the user’s Spotify client rather than in-app.
		- Trade-off: cannot guarantee blind playback UX (metadata visibility/background behavior depends on Spotify client), so it remains optional and non-core.

- Non-goals for this phase
	- No low-level ticket breakdown.
	- No UI branding/system design choices.
	- No production SRE hardening beyond v1 needs.

## Risks
- Provider compliance risk: Deezer/Jamendo terms must be continuously monitored; policy changes can force content-flow changes.
- Spotify history-access risk: required Spotify history scopes or policy interpretation may be restricted, delayed, or revoked.
- Catalog coverage risk: 30-second preview availability differs by track/territory/provider and may impact category fairness.
- Atlas Free throttling or quota exhaustion can impact responsiveness and require stricter in-app limits.
- Cross-platform integration (Cloudflare + Atlas) increases operational/debug complexity versus single-vendor data stack.
- Manual scoring in local mode can create trust/dispute issues if audit trail UX is weak.
- Companion-link risk: optional Spotify link/code mode can reveal song identity earlier than intended depending on Spotify client UI.
- Vendor lock-in risk exists for Durable Objects and Atlas-specific usage patterns.

## Open Questions
- What is the final retention period and deletion SLA for uploaded listening-history files?
- Which provider should be the v1 default for preview clips (Deezer-first, Jamendo-first, or hybrid by category)?
- If Spotify history scopes are denied, is upload-import fallback acceptable for all competitive modes?

## Review Checklist
- Confirm authoritative multiplayer state ownership in Durable Objects is accepted.
- Confirm hybrid baseline (Cloudflare runtime + Atlas Free persistence) is accepted for v1.
- Confirm quota guardrails (max two active lobbies, compact writes, delta broadcast) are sufficient to stay free-tier compliant.
- Confirm local-mode manual scoring audit trail is sufficient for dispute handling.
- Confirm unresolved provider dependencies (terms monitoring, upload retention/deletion, catalog coverage) are acceptable carry-over blockers.

## Status
approved
