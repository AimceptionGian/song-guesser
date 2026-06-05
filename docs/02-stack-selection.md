# 02 Stack Selection

## Goal
Select a delivery-ready technology stack for SongGuesser under hard constraints: permanently free hosting and data layer, no sleep mode/cold-start behavior for core gameplay, and minimal operational overhead.

## Inputs
- docs/01-idea.md (approved)
- Product constraints from idea phase:
	- Three gameplay modes (singleplayer, local multiplayer, online multiplayer)
	- Host-led lobbies and real-time turn sync for online mode
	- Spotify integration for auth, playback, and history-based categories with upload fallback
	- Category availability pre-validation before match start
	- Score logic with per-match host toggle for timeline dependency
- Additional hard constraints from user review:
	- Hosting platform must be free.
	- Database/data layer must be free.
	- Realtime layer must be free.
	- No sleep mode/cold starts acceptable for core game flow.
	- If free managed platform cannot satisfy constraints, self-hosting is acceptable fallback but should be avoided if possible.
- Team skill profile: not explicitly provided (assume small team, full-stack TypeScript preference)

## Decisions
- Option A: Cloudflare-first edge stack (recommended)
	- Frontend hosting: Cloudflare Pages (free tier)
	- Backend/API: Cloudflare Workers (TypeScript)
	- Realtime authoritative match rooms: Durable Objects (WebSocket rooms)
	- Persistent storage: D1 (SQLite-based serverless DB)
	- Optional file storage for Spotify history uploads: R2 free allowance
	- Complexity:
		- Medium. One platform with multiple primitives (Workers, DO, D1) but cohesive runtime model.
	- Cost:
		- Free within published free-tier quotas for hosting, compute, realtime sessions, and DB usage.
	- Performance:
		- Strong for turn-based realtime. Durable Objects provide deterministic room ownership and reduce race conditions.
	- Maintainability:
		- Strong for TypeScript teams; one vendor surface and one language.
	- Pros:
		- Aligns best with all hard constraints (free stack, no traditional server sleep model).
		- Good fit for authoritative per-lobby game state and ordering.
		- Minimizes ops compared with self-managed servers.
	- Cons:
		- Requires careful quota monitoring to keep operation free.
		- Platform-specific patterns (Durable Objects/D1) increase vendor coupling.
- Option B: Firebase free tier stack (conditionally free, not preferred)
	- Frontend hosting: Firebase Hosting
	- Backend: Cloud Functions
	- Realtime + data: Firestore
	- Complexity:
		- Medium initial setup, medium-high long-term for strict game-state correctness.
	- Cost:
		- Can start free, but sustained realtime traffic can trigger paid usage earlier.
	- Performance:
		- Good for lightweight realtime; strict ordering and arbitration are harder than single-room authority patterns.
	- Maintainability:
		- Medium. Fast start, but transaction-heavy game rules can become complex.
	- Pros:
		- Fast MVP and mature tooling.
	- Cons:
		- Free-tier predictability is weaker for frequent multiplayer events.
		- Cold-start/latency characteristics can appear in serverless execution paths.
		- Does not cleanly satisfy the no-cold-start preference.
- Option C: Self-host fallback on own server (only if managed-free constraints fail)
	- Frontend/API/realtime: single Node runtime (e.g., Fastify/Nest + Socket.IO)
	- Data: PostgreSQL on same server or local network DB
	- Complexity:
		- Medium-high operational burden (patching, backups, uptime, monitoring).
	- Cost:
		- Platform spend can be near-zero if existing hardware is used.
	- Performance:
		- Predictable if server is stable and properly provisioned.
	- Maintainability:
		- Lower than managed options due to operations workload.
	- Pros:
		- Full control and avoids third-party quota surprises.
	- Cons:
		- Highest ops responsibility and reliability risk for a small team.
- Option D: MongoDB Atlas Free as primary database (evaluated, not recommended as primary)
	- Typical integration path here: keep hosting/realtime on Cloudflare, replace D1 with Atlas Free.
	- Complexity:
		- Medium-high. Additional platform integration and quota-aware data modeling are required.
	- Cost:
		- Free tier is available, but with strict capacity and throughput limits.
	- Performance:
		- Acceptable for early prototype traffic; less predictable for sustained multiplayer write/read bursts.
	- Maintainability:
		- Medium. MongoDB ergonomics are good, but free-tier operational constraints add product logic overhead.
	- Pros:
		- Familiar document model and good developer tooling.
		- Free entry point and easy early experimentation.
	- Cons:
		- Free tier constraints are tight for this product profile: small storage cap, transfer/ops throttling, and one free cluster per project.
		- Atlas may deactivate idle free clusters after long inactivity windows.
		- Additional cross-platform complexity without clear advantage over D1 for this turn-based game.
	- Atlas Free v1 feasibility envelope (only if explicitly chosen):
		- Storage budget target: keep total data + indexes below 350 MB (safety margin under the 512 MB free cap).
		- Throughput budget target: design for sustained DB load below 60 ops/s (headroom under the 100 ops/s throttle threshold).
		- Transfer budget target: keep rolling 7-day traffic below 7 GB in and 7 GB out (headroom under 10 GB / 10 GB limits).
		- Connection budget target: keep below 300 concurrent DB connections (headroom under 500 max).
		- Feature limits accepted: no built-in backups on free tier, no sharding, limited observability.
		- Activity requirement: maintain periodic activity/health checks to avoid long-idle deactivation risk.
	- Atlas decision rule for this project:
		- GO only if all above budgets are modeled and enforced via product limits.
		- NO-GO if expected usage exceeds any threshold or if strict no-throttle multiplayer UX is required.
- Final recommendation: Option A (Cloudflare-first edge stack)
	- Rationale:
		- Best available match for all hard constraints: fully free path across hosting, realtime, and database within quota limits.
		- Better fit than conventional function stacks for no-sleep gameplay expectation.
		- Keeps self-hosting as true fallback instead of default path.
	- Alternative considered for recommendation: Option C (self-host) and Option D (MongoDB Atlas Free)
	- Why not selected as primary:
		- Option C has high ops overhead and conflicts with your goal to avoid server management.
		- Option D introduces stricter free-tier bottlenecks and platform coupling without improving your hard constraints.
- Fallback options:
	- Fallback 1 (quota pressure): Introduce strict in-product limits (max concurrent lobbies, room TTL, payload caps) to remain in free tier.
	- Fallback 2 (hard free-tier violation): Move authoritative engine to your own server while keeping static frontend on free hosting.
	- Fallback 3 (Spotify policy limitation): Keep stack unchanged and switch history categories to uploaded-history-only flow.

## Risks
- No third-party provider can guarantee "unlimited forever free"; viability depends on staying inside quota and policy terms.
- Atlas Free-specific risk (if chosen): throughput and transfer throttling can degrade multiplayer responsiveness under bursty lobby activity.
- Spotify API/policy constraints can block auth/playback/history features independent of stack quality.
- Realtime fairness still requires strict authoritative room logic (ordering, reconnect, duplicate submit control).
- Uploaded-history flow introduces privacy/security obligations (retention, deletion, access control).
- Vendor lock-in risk is increased when using platform-specific realtime primitives.

## Open Questions
- Define hard free-tier operating limits for v1 (max concurrent lobbies, max players per lobby, max matches per day).
- Confirm acceptable gameplay behavior if free-tier limits are reached (queue, temporary join block, or read-only lobby view).
- Confirm exact Spotify scopes and legal position for playback/history use before implementation lock.
- Confirm retention and deletion policy for uploaded Spotify history files.
- If Atlas Free is reconsidered, confirm whether the v1 feasibility envelope thresholds are acceptable as hard product limits.

## Review Checklist
- Confirm that permanently free constraints (hosting, DB, realtime) are treated as hard decision criteria.
- Confirm no-sleep/cold-start expectation for core gameplay is adequately addressed by the recommended stack.
- Confirm Option A (Cloudflare-first) is accepted as primary and Option C (self-host) as fallback only.
- Confirm Atlas Free is documented as a conditional option with explicit GO/NO-GO limits.
- Confirm remaining legal/policy dependencies (Spotify scopes, history usage, upload retention) are acceptable to carry into architecture.

## Status
in-review
