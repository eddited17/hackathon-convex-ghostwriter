# Task 03 — Curiosity & Voice Coaching

## Summary
Layer conversational intelligence onto the realtime session so the assistant conducts professional ghostwriter-style interviews and co-defines voice parameters. This task depends on Task 01 (realtime shell) and Task 02 (blueprint data).

## Key Requirements
- System prompt + Realtime session instructions incorporating:
  - Blueprint context (goals, audience, timeline, etc.).
  - Interview questions derived from `docs/research/ghostwriting-best-practices.md`.
  - Behavior rules for paraphrasing, recap checkpoints, and polite clarifications.
- Define and activate the `ghostwritingToolset` once a project is confirmed, exposing Convex helpers for `listProjects`, `getProject`, `updateProjectMetadata`, `syncBlueprintField`, `recordTranscriptPointer`, `commitBlueprint`, and any drafting/notes utilities required for downstream work.
- Provide a tool-side pathway for `recordTranscriptPointer` so the assistant can tag blueprint updates and interview highlights with precise transcript references.
- Implement a dedicated “voice workshop” turn early in the session collecting tone, structure, content markers (store results as `notes` with `noteType="voice"`).
- Display outstanding TODOs / clarification chips sourced from unresolved topics.
- Provide UI for the assistant to confirm facts and recap progress at defined milestones.
- Persist conversation metadata (e.g., workshop responses, TODO status) to Convex.

## Deliverables
- Updated prompt/Session config modules (e.g., `lib/realtimePrompt.ts`).
- Realtime tool configuration split between intake and ghostwriting modes, including the new `recordTranscriptPointer` wiring.
- Realtime client utilities to send custom events (e.g., requesting clarifications, tracking TODO completion).
- Convex mutations/queries for creating TODO items and voice notes.
- UI components reflecting voice profile + TODO chips in the session view.

## Acceptance Criteria
- During a new session, assistant follows the interview structure and collects voice preferences without manual prompting.
- Voice preferences saved to Convex and displayed in the UI; subsequent assistant turns respect them.
- TODO chips appear when the assistant identifies missing info and can be marked resolved.
- Recap checkpoints trigger after significant milestones (e.g., blueprint intake completion, voice workshop finish).
- `npm run lint`, `npm run typecheck`, and `npm run build` pass.

## References
- PRD §7.3, §7.4 (`docs/prd/ai-ghostwriter-prd.md`).
- Implementation Plan §2-F3 (`docs/implementation.md`).
- Ghostwriting research dossier (`docs/research/ghostwriting-best-practices.md`).
