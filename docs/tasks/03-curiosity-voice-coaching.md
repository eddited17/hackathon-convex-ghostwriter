# Task 03 — Guided Interview & Live Drafting

## Summary
Deliver the document-first ghostwriting workspace: the assistant keeps interviewing like a pro, the draft updates in front of the user in real time, and every insight is captured for later refinement. Task 03 builds directly on the realtime session shell (Task 01) and the project blueprint intake (Task 02), so tone/voice rules are already locked in by the blueprint.

## Parallel Loops
1. **Conversation loop** — Continue the structured client interview (motivation, anecdotes, proof points, objections) grounded in the existing blueprint context. No extra tone workshop is required; the blueprint remains the single source of stylistic truth.
2. **Drafting loop** — After each meaningful exchange, feed the entire current document plus new transcript excerpts into the drafting model. Apply the returned Markdown edits to the Convex `documents` record so updates stream to every client instantly.
3. **Memory loop** — Persist structured notes (`noteType = fact | story | style | todo`) with transcript anchors via `recordTranscriptPointer`, and surface actionable TODOs for missing evidence or follow-ups.

## Key Requirements
- **Document-first UI**: Introduce a `Document` tab (default) that renders the live Markdown draft, section outline, blueprint highlights, and the assistant-authored TODO checklist. All content should originate from the Convex document store so realtime streaming just works.
- **Session settings tab**: Relocate today’s RealtimeSessionShell controls (transcripts, diagnostics, manual reply, audio/device selectors) into a secondary tab. Preserve hot paths like “manual text reply” without changing their behavior.
- **Ghostwriting toolset activation**: Once a project is confirmed, expose Convex helpers for project fetch/update, blueprint sync, document mutations, `recordTranscriptPointer`, and notes/TODO writes. Intake-only tools must stay hidden in this mode.
- **Whole-document drafting**: Every drafting call receives the entire current document and returns ordered edit operations (add/update/remove sections). Apply edits atomically to Convex, optimistic-render them in the Document tab, and reconcile with the streamed update.
- **Structured note capture**: Each time the assistant creates or resolves a TODO/fact/story, log it with a transcript pointer so users can jump back to the source quote.
- **Simple progress indicators**: Track per-section status (drafting, needs detail, complete) and show lightweight metrics such as word count or completion badges—keep it minimal but helpful.

## Deliverables
- Updated session instructions/prompt scaffolding to reflect simultaneous interviewing + drafting responsibilities (using blueprint tone as-is).
- Tabbed session layout separating `Document` and `Session settings` screens, including shared state plumbing.
- React components/hooks for the Document tab: Markdown document viewer/editor, outline tracker, blueprint reminder panel, TODO list with resolve controls.
- Ghostwriting toolset wiring across the realtime client and Convex functions, including document mutation endpoints and transcript-pointer support.
- Drafting utilities that queue whole-document updates, stream Markdown edits into the UI, and persist results back to Convex.

## Acceptance Criteria
- While the user talks, the Document tab shows Markdown paragraphs appearing or being refined in real time; refreshing the page reflects the same state via Convex.
- Notes and TODOs created by the assistant appear in the Document tab with links back to their transcript anchors, and they can be marked resolved.
- Switching to the Session settings tab reveals transcripts, diagnostics, and device controls from Task 01 without resetting the document view.
- Section progress indicators reflect the drafting loop’s status and prompt the assistant when additional detail is needed.
- Only the ghostwriting toolset is active after project confirmation; intake prompts/tools do not fire.
- `npm run lint`, `npm run typecheck`, and `npm run build` succeed.

## References
- PRD §7.3, §7.4 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §2-F3 (`docs/implementation.md`).
- Ghostwriting research dossier (`docs/research/ghostwriting-best-practices.md`).
