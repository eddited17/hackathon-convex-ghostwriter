# Task 06 — Section Locking & Revision History

## Summary
Allow users to lock draft sections, track revisions, and audit changes over time, giving fine-grained control over the evolving manuscript.

## Key Requirements
- UI controls to lock/unlock sections; locked sections must be visually indicated.
- Convex mutations that toggle `documentSections.locked` and store revision metadata.
- Maintain version history (e.g., array of snapshots or change log table) with timestamps and author/agent attribution.
- Provide ability to view previous versions and restore if needed (full restore or copy/paste-friendly view).
- Ensure background drafting respects locked status (coordinate with Task 05 logic).

## Deliverables
- Frontend components for lock buttons, version history modal, and diff view.
- Convex schema updates if additional tables are required (e.g., `sectionRevisions`).
- Utilities for generating diffs (textual summary acceptable if full diff is heavy).

## Acceptance Criteria
- Users can lock a section, see a locked badge, and observe that subsequent drafts leave it unchanged.
- Each section edit (manual or model-driven) records a revision entry accessible via UI.
- History view renders past versions and supports restoration.
- Build/lint/type checks succeed.

## References
- PRD §7.5, §12 (Milestone 2) (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §3 (second bullet).
