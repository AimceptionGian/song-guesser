# 01 Idea

## Goal
Define a validated concept brief for a Spotify-powered song quiz web app that supports singleplayer, local multiplayer (same device), and online multiplayer (multiple devices), with a host-led lobby and category-driven gameplay.

## Inputs
- User problem statement (June 5, 2026):
	- Build a full-featured song quiz website.
	- Modes: singleplayer, local multiplayer (one device), online multiplayer (multiple devices).
	- Players must sign in with Spotify to enable song playback.
	- Turn flow: player draws a card, a random song plays, player guesses artist, title, and year.
	- Card ownership: player keeps the drawn card regardless of correctness.
	- Scoring: by default, points are awarded only if the card is placed in the correct chronological position.
	- Optional ruleset: host can enable a mode where guess points are still awarded even when timeline placement is incorrect.
	- Host selects category before game starts.
	- Example categories:
		- Hits
		- Songs known by at least one player (heard at least once in Spotify history)
		- Well-known songs for players (heard at least ten times by at least one player)
		- Songs heard by all players (each player heard each song at least once)
	- Match end condition: continue until all players have 10 cards.
- Assumptions:
	- A Spotify Premium-capable playback path or equivalent legal playback mechanism is available for all participants where required.
	- Players consent to using their Spotify listening history for category filtering.
	- The product requests broader Spotify scopes than strict minimum to support future feature expansion.
	- If direct Spotify history access is unavailable, players can upload their Spotify listening history export for category generation.
	- Original album release year is available and can be used as the single scoring reference.
- Constraints:
	- No stack or implementation planning in this phase.
	- Multiplayer fairness must be maintained across all game modes.
	- Category logic must work with varying data availability between players.

## Decisions
- Problem statement:
	- Players want a socially engaging music trivia game that combines recognition (artist/title) with timeline reasoning (year placement), playable both co-located and remote.
	- Alternative considered: a pure quiz without timeline placement.
	- Why rejected: timeline placement is core to differentiation and strategic depth.
- Target user segments:
	- Friends and families hosting party-style game nights.
	- Music enthusiasts seeking competitive trivia.
	- Hybrid groups where some players share one device and others join remotely.
	- Alternative considered: focusing only on hardcore music experts.
	- Why rejected: reduces accessibility and replayability for mixed-skill groups.
- Game scope (in-scope):
	- Three modes: singleplayer, local multiplayer, online multiplayer.
	- Spotify authentication for each participant profile used in online sessions.
	- Local multiplayer uses one Spotify login for the shared device session.
	- Host-created lobby with category selection before game start.
	- Host selects ruleset options at lobby creation per match, including scoring behavior toggles.
	- Category availability is pre-validated; categories with insufficient eligible songs are shown as unavailable and cannot be selected.
	- Category filters support default all-time listening history and an optional "last 12 months" window.
	- If Spotify history API access is restricted or unavailable, category filters can be computed from player-provided Spotify history uploads.
	- Turn-based card draw with random song playback per selected category.
	- Guess inputs: artist, title, year.
	- Timeline placement mechanic where correct placement is a prerequisite for scoring by default.
	- Optional scoring toggle: allow guess points despite incorrect timeline placement.
	- Release year scoring reference is fixed to original album release.
	- Card retention by active player after each turn, regardless of scoring outcome.
	- Online multiplayer scoring is auto-validated from player inputs.
	- Local multiplayer uses host-assisted/manual point assignment based on shown results.
	- Match completion when each player has 10 cards.
	- Alternative considered: fixed number of rounds independent of cards per player.
	- Why rejected: card-based end condition aligns with the physical-card mental model and keeps mode parity.
- Out-of-scope for this concept phase:
	- Monetization model and pricing.
	- Anti-cheat enforcement details.
	- Final UI style system and brand language.
	- Technical architecture and vendor selection beyond Spotify requirement.
- Success metrics (measurable):
	- Game completion rate: at least 70% of started matches reach the 10-cards-per-player end condition.
	- Time-to-first-round: median less than 3 minutes from lobby creation to first song playback.
	- Category viability: at least 95% of matches can generate enough valid songs for all turns without manual intervention.
	- Guess interaction quality: at least 80% of turns capture all three guess fields and a placement action without technical failure.
	- Multiplayer stability: at least 99% turn synchronization success in online multiplayer sessions.

## Risks
- Spotify policy and playback limitations may affect availability across devices, regions, or account types.
- Player history-based categories may produce sparse pools for new or low-activity accounts.
- Metadata inconsistencies (release year variants, remasters, regional releases) can cause scoring disputes.
- Online multiplayer latency may impact perceived fairness in turn handling and timeline placement.
- Privacy concerns may reduce willingness to share listening-history-derived categories.

## Open Questions
- Missing input note: legal/product policy guidance is needed on acceptable use of Spotify playback and listening history in multiplayer contexts.

## Review Checklist
- Confirm legal/product guidance for Spotify playback and listening-history usage.
- Confirm host-level ruleset toggle behavior is clear for all three modes.
- Confirm category-availability gating (unavailable categories cannot be selected) is accepted.
- Confirm fallback flow for Spotify history upload is acceptable from privacy and UX perspective.
- Confirm measurable success metrics are acceptable for next-phase planning.

## Status
in-review
