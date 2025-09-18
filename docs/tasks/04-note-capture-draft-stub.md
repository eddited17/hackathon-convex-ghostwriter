# Task 04 — Note Capture & Background Draft Stub

## Summary
Convert session transcripts and assistant summaries into structured notes, then wire a background drafting action (stub) that produces incremental document sections in Convex. This sets the stage for Milestone 2 enhancements.

## Key Requirements
- Automatically generate notes from transcripts (facts, stories, style cues, TODOs, voice entries) using assistant/system logic.
- Provide manual controls to tag/edit notes in the UI.
- Implement Convex action that listens for note updates and calls the long-form model (`gpt-5-mini`, stub output acceptable initially) to populate `documents` and `documentSections`.
- Present live document preview with change highlights (basic diff or timestamp markers acceptable for stub).
- Ensure notes and drafts sync in near real-time; handle concurrent sessions gracefully.

## Deliverables
- Convex mutations/actions for note creation, updates, and background draft generation.
- UI components for note list + document preview.
- Lib helper to format draft model prompts using project blueprint + notes.
- Placeholder draft output (e.g., simple summarization) if full model call not yet available.

## Acceptance Criteria
- Notes appear automatically as conversation progresses and can be edited manually.
- Background action updates the document stub when notes change (verified in Convex collections + UI preview).
- Document preview refreshes without page reload and indicates which sections were updated.
- All lint/type/build checks succeed.

## References
- PRD §7.4, §7.5 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §2-F4 (`docs/implementation.md`).
