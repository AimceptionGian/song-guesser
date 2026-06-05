# 09 Spotify Approval Request

## Goal
Provide a practical step-by-step guide and a ready-to-send request template for asking Spotify for written approval or an explicit policy clarification for SongGuesser.

## Inputs
- docs/01-idea.md (approved)
- docs/02-stack-selection.md (approved)
- docs/03-architecture.md (in-review)
- Spotify Developer Policy and Compliance Tips:
  - Public docs currently list games and trivia quizzes as disallowed use cases.
  - Web Playback SDK requires Premium and is marked as non-commercial in the public docs.
  - Spotify requires clear privacy disclosures, disconnect flow, and data deletion on disconnect.

## Decisions
- Recommended approach
  1. Treat the current public Spotify policy as a blocking issue for launch.
  2. Keep this document as an escalation template only; it is no longer the primary execution path.
  3. Primary product direction is now a non-Spotify preview-provider architecture.
  4. Use this request text only if a formal written confirmation is still needed for legal closure.

- Where to submit the request
  - Spotify for Developers community forum: create a new topic and ask for an official policy clarification.
  - Spotify support/contact path: use the public Spotify contact/support routes linked from the developer pages.
  - Spotify Dashboard: use it to register the app and configure the Website and Redirect URI fields, but do not rely on the dashboard alone for policy approval.
  - Note: the public Dashboard "Request Extension" flow appears to be for quota/limits, not for overriding policy restrictions.

- What to include in the request
  - That the app is private and invite-only.
  - That there is no monetization, advertising, or public broadcast.
  - That players authenticate with their own Spotify accounts.
  - That playback is limited to Spotify Premium users if required.
  - That you will request only minimal scopes.
  - That you will provide a disconnect button and delete Spotify personal data when a user disconnects.
  - That you will store as little Spotify data as possible and cap retention for match data.
  - That you are asking for a written yes/no answer and the exact rule that applies.

- Suggested minimum scopes to mention in the request
  - `streaming`
  - `user-read-email`
  - `user-read-private`
  - `user-read-playback-state`
  - `user-modify-playback-state`
  - `user-read-recently-played`
  - `user-top-read`

## Risks
- The public policy currently says not to create a game, including trivia quizzes, so the answer may be a firm no.
- Spotify may reject requests that look like attempts to work around the policy by changing playback to another device.
- If approval is denied, the product should not proceed with Spotify-based gameplay in production.
- Any approval may come with strict scope or usage limits.

## Open Questions
- Which exact contact route at Spotify will produce the fastest official written answer?
- Will Spotify provide a written exception, or only a standard policy refusal?
- If Spotify approves only a subset of features, which parts of the game remain allowed?

## Ready-to-Send Request Template

Use the text below in a Spotify for Developers support request, community post, or formal contact form.

```text
Subject: Request for written policy clarification / exception for a private music quiz app

Hello Spotify Developer Team,

I am building a private, invite-only web app called SongGuesser for use with a small group of friends. The app is non-commercial, has no advertising, no public broadcasting, and no content upload/sharing feature.

What the app does:
- Each player logs in with their own Spotify account.
- The app draws a track, plays it through Spotify playback, and the player guesses artist, song title, and release year.
- The app also supports a timeline-placement mechanic where players place songs in chronological order.
- The game is only used in private sessions with a small number of invited users.

What I want to confirm:
1. Does this use case violate Spotify Developer Policy section III, which says not to create a game, including trivia quizzes?
2. If yes, is there any written exception, approved partner path, or alternative setup that Spotify would permit for this use case?
3. If playback is allowed at all, which exact scopes and features would Spotify approve for this app?

Planned safeguards:
- I will only request the minimum scopes needed for the enabled features.
- I will provide a clear disconnect-account flow.
- I will delete Spotify personal data when a user disconnects.
- I will maintain a privacy policy that clearly explains what data is used and why.
- I will not monetize Spotify streaming, run ads, or broadcast audio publicly.

If this use case is not allowed, I would appreciate an explicit written answer so I can re-scope the product correctly.

Thank you.
```

## Status
superseded