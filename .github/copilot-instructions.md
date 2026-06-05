# Multi-Agent Project Base Instructions

## Scope
These rules apply to all project agents and prompts in this repository.

## Language
- Default output language: English.
- Keep outputs concise but complete.

## Delivery Contract
- Every phase writes exactly one primary markdown artifact in `docs/`.
- Each artifact must contain the sections below:
  - Goal
  - Inputs
  - Decisions
  - Risks
  - Open Questions
  - Status
- Allowed status values: `draft`, `in-review`, `approved`, `superseded`.

## Phase Control
- User controls transitions for early phases.
- Do not auto-advance to the next phase without explicit user confirmation.

## Test and Implementation Concurrency
- Implementation may start only after `Test Package 1` is marked `approved` by the test agent.
- After that gate, the test agent continues producing `Test Package 2..N` while implementation progresses.

## Quality Baseline
- Include assumptions and constraints in every phase artifact.
- Record at least one alternative considered for every major decision.
- Raise blockers early and clearly.

## Documentation Sync Policy
- Documentation Agent runs automatically after every completed phase as a synchronization pass.
- The sync pass updates affected docs artifacts and project-level docs.
- `TBD` placeholders must be replaced when required information is available from approved upstream artifacts.
- If information is not yet available, keep `TBD` and add a specific missing-input note under Open Questions.
