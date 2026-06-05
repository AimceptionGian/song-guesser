# Agent Registry

This repository defines a specialist multi-agent workflow for full web-app projects.

## Core Sequence
1. Idea Agent
2. Stack Selection Agent
3. Architecture Agent
4. UI UX Agent
5. Visual Branding Agent
6. Documentation Agent
7. Test Strategy Authoring Agent
8. Implementation Agent

## Optional Meta Agent
- Orchestrator Agent: validates stage readiness and handover quality.

## Transition Rules
- Stages 1 to 6 are user-triggered.
- After each completed stage (1 to 8), Documentation Agent runs automatically as a sync pass.
- The sync pass updates impacted docs files and replaces placeholder `TBD` items when inputs are available.
- Stage 7 and Stage 8 can overlap only after `Test Package 1` is approved.
- Any critical requirement gap found in Stage 8 must be fed back to Stage 7 and, if needed, Stage 3.

## Handover Format
- Handover is always markdown in `docs/`.
- Use file names prefixed by phase number to keep chronological order.
