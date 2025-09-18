# Task 08 — Recap Checkpoints & Markdown Export

## Summary
Finalize Milestone 2 by adding automated recap checkpoints and enabling markdown export of the current manuscript for external sharing.

## Key Requirements
- Define recap triggers (e.g., end of session, major section completion) and send concise summaries via assistant dialogue + UI notification.
- Store recap summaries in Convex (link to sessions and notes for future review).
- Implement export endpoint/button that bundles the document as Markdown (optionally zipped with metadata).
- Ensure export respects locked sections and includes revision metadata where relevant.

## Deliverables
- Realtime prompt logic or background worker that generates recap summaries.
- UI component for recap history and export call-to-action.
- Server-side export handler (API route or Convex action) returning Markdown file.

## Acceptance Criteria
- Recaps appear automatically at configured milestones and are reviewable later.
- Export produces a Markdown file matching the latest draft state, available for download.
- Lint/type/build checks pass.

## References
- PRD §7.5, §11 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §3 (fourth bullet).
