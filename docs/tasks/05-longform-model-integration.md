# Task 05 — Long-form Model Integration & Batching

## Summary
Replace the drafting stub with full integration to OpenAI `gpt-5-mini` (Responses API) and establish batching/throttling strategies for note-driven document updates.

## Key Requirements
- Implement server-side helper (Convex action or Node route) that calls `gpt-5-mini` with blueprint + notes context and returns structured section updates.
- Introduce configurable throttling/debouncing so long-form calls don’t trigger on every minor note change.
- Capture token usage metrics and handle fallback to `gpt-4.1-mini` on failure/latency spikes.
- Respect locked sections (Task 06 dependency) and avoid rewriting them.
- Add logging/observability for API errors and response times.

## Deliverables
- Updated Convex action for drafting with OpenAI API integration.
- Helper to diff previous vs new section content and annotate highlights.
- Environment variable documentation for OpenAI keys + model selection.
- Basic unit/integration test covering prompt assembly and fallback logic (mock API).

## Acceptance Criteria
- Drafting pipeline produces coherent sections via `gpt-5-mini` using real API calls.
- Throttling prevents redundant calls while still updating within reasonable time (<30s after meaningful note changes).
- Fallback model engages when the primary call fails, logged for later review.
- Locked sections remain untouched even when notes referencing them change.
- Lint/type/build checks pass.

## References
- PRD §7.5, §13 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §3 (first bullet).
