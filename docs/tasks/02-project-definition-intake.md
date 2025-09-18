# Task 02 — Project Definition Intake

## Summary
Create the guided onboarding flow that captures project blueprints before the first realtime session. This intake must collect the structured metadata outlined in the PRD and persist it to Convex for downstream use.

## Key Requirements
- Add UI workflow (modal or dedicated route) that prompts the user for:
  - Project title (with AI-assisted suggestions optional but nice-to-have).
  - Content type (blog post, article, biography).
  - Desired outcomes / success metrics.
  - Target audience description.
  - Publishing plan and timeline expectations.
  - Available materials / research inventory.
  - Communication preferences, availability, and budget guardrails.
- Validate inputs and allow saving drafts before completion.
- Persist intake data to `projects` and `projectBlueprints` tables (create project on completion, store blueprint snapshot).
- Link blueprint metadata to new sessions so later tasks can pre-fill prompts.
- Provide a review screen summarizing captured info with edit capability.

## Deliverables
- UI components/pages under `app/` implementing the intake experience (should integrate smoothly with Task 01 session entry point).
- Convex mutations/queries to create/update `projects` and `projectBlueprints`.
- Shared TypeScript types for blueprint payloads (`lib/types.ts` or similar).
- Optional: basic unit tests for Convex functions.

## Acceptance Criteria
- From the home screen, a user can launch the intake, fill required fields, and see stored results upon return.
- Data persisted in Convex matches the schema, including timestamps and references.
- Intake flow surfaces validation errors and allows edits without losing progress.
- Follow-up session creation (manual or via stub) automatically loads blueprint metadata.
- `npm run lint`, `npm run typecheck`, and `npm run build` pass.

## References
- PRD §7.1, §7.3 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §2-F2 (`docs/implementation.md`).
- Ghostwriting interview research (`docs/research/ghostwriting-best-practices.md`).
