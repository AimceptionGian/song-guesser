---
applyTo: "docs/**/*.md"
description: "Use when: creating or updating phase artifacts in docs, enforcing section schema and phase status rules."
---

# Workflow Artifact Instruction

When writing phase artifacts in `docs/`, ensure each file contains:
- Goal
- Inputs
- Decisions
- Risks
- Open Questions
- Status

Status must be one of:
- draft
- in-review
- approved
- superseded

If required inputs are missing, block progression and write a short missing-input note under Open Questions.
