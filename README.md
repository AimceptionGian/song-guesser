# Multi-Agent Project Base Template

Clone this repository as a starting point for new web-app projects.

## What this template provides
- Workspace-level Copilot customization in `.github/`
- Specialized agent definitions for idea, stack, architecture, design, docs, tests, and implementation
- Standardized phase artifacts in `docs/`
- A user-controlled early workflow and a gated test/implementation overlap

## Agent set
1. Idea Agent
2. Stack Selection Agent
3. Architecture Agent
4. UI UX Agent
5. Visual Branding Agent
6. Documentation Agent
7. Test Strategy Authoring Agent
8. Implementation Agent
9. Optional Orchestrator Agent

## Workflow model
### User-controlled phases
You manually trigger and review these phases:
1. Idea
2. Stack Selection
3. Architecture
4. UI UX
5. Visual Branding

Documentation Agent then runs automatically after each completed phase as a synchronization step.

### Coordinated phases
- Test Strategy Authoring Agent creates incremental test packages.
- Implementation Agent starts only after `docs/07a-test-package-1.md` is approved.
- Then testing and implementation continue in parallel.

## TBD handling
- `TBD` values are placeholders in templates and are expected at project start.
- Agents replace `TBD` fields as soon as enough upstream inputs exist.
- If data is still missing, the agent keeps `TBD` and documents the missing input under Open Questions.

## Handover contract
Each phase artifact in `docs/` must include:
- Goal
- Inputs
- Decisions
- Risks
- Open Questions
- Status

Allowed status values:
- `draft`
- `in-review`
- `approved`
- `superseded`

## Project structure
- `.github/copilot-instructions.md`: global rules
- `.github/AGENTS.md`: workflow registry
- `.github/agents/*.agent.md`: specialized agent definitions
- `.github/instructions/*.instructions.md`: file-scoped instructions
- `.github/prompts/*.prompt.md`: reusable prompts
- `.github/skills/*/SKILL.md`: reusable workflow skills
- `docs/*.md`: phase outputs and project docs

## First run
1. Fill `docs/01-idea.md` with your project concept.
2. Trigger stack selection and approve `docs/02-stack-selection.md`.
3. Continue through architecture and design files.
4. Let documentation phase align project-level docs.
5. Start testing phase and approve `docs/07a-test-package-1.md`.
6. Start implementation phase.
