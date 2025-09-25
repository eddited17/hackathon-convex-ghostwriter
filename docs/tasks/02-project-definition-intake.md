# Task 02 — Conversational Project Routing & Blueprint Intake

## Summary
Reimagine the entry experience so any realtime conversation can begin from the project list and branch into either (a) creating a brand-new project with a blueprinting dialogue or (b) continuing work on an existing project. The assistant must drive this through a natural conversation that issues tool calls behind the scenes to fetch projects, create records, and update blueprint fields. The UI should shift into a structured blueprint mode when appropriate, showing live-updating fields that map directly to the Convex schema.

## Experience Flow
1. **Launch point (project list)** — Home view surfaces recent projects plus a prominent "Start conversation" action. When triggered without an active project, the assistant opens with a greeting and clarifies whether the user is starting something new or picking up an existing project.
2. **Mode selection dialogue** — Assistant listens for the user decision (voice or text) and confirms the mode. If the intent is ambiguous, it uses clarification follow-ups. The UI reflects the pending choice (e.g., badge or banner indicating "choosing project context").
3. **Existing project path** — Assistant lists viable projects (fed by `projects` table) via tool calls, lets the user pick verbally or by tapping, and then loads the active project context. Once confirmed, the conversation switches into the ghostwriting toolset (notes, document updates, etc.) while keeping the standard realtime session view.
4. **New project path (blueprint mode)** — Assistant issues tool calls to create a draft project record and the associated blueprint document. The layout pivots to a dedicated blueprint panel that reflects the schema-backed fields: `title`, `contentType`, `goal` (project table) plus blueprint fields `desiredOutcome`, `targetAudience`, `publishingPlan`, `timeline`, `materialsInventory`, `communicationPreferences`, `budgetRange`, and `voiceGuardrails`.
5. **Conversational slot filling** — For new projects, the assistant proceeds with progressive discovery loops, updating the blueprint panel in realtime as tool calls write to Convex. Each field shows provenance (e.g., "Summarized from your last answer") and confidence state. Users can correct items verbally; the assistant patches the relevant field via another tool call.
6. **Manual project activation** — If a user manually selects a project card, the conversation starts directly in project mode, bypassing the mode-selection questions but still displaying the active project indicator and ghostwriting toolset.
7. **Confirmation & handoff** — Blueprint mode culminates in a confirmation step summarizing the configuration and linking the transcript ID. On approval, the assistant promotes the draft to an active project and transitions to the standard session layout so Task 03 can build on the captured data.

## Tool Calls & Data Binding
- Define a `projectIntakeToolset` with capabilities to `listProjects`, `createProject`, `updateProjectMetadata`, `syncBlueprintField`, `recordTranscriptPointer`, and `commitBlueprint`. These operations should wrap Convex mutations/queries and enforce the schema contracts.
- Define a `ghostwritingToolset` for in-project sessions (can reuse existing Task 01 hooks, but ensure it is explicitly loaded only after a project is chosen).
- The conversation orchestrator must inspect assistant responses for tool call directives, dispatch them, and stream the UI updates as mutation results arrive (Convex realtime should propagate the changes automatically).
- Tool errors or conflicting updates should be verbalized by the assistant with suggestions for resolution (e.g., "I couldn't save the publishing plan; let's try rephrasing it").

## Key Requirements
- Replace the single-purpose `RealtimeSessionShell` landing page with a project-aware shell that shows project list, session start CTA, and current project context.
- Support starting a session from either the project list or a specific project detail view; both paths must initialize the assistant appropriately.
- Conversation mode must branch based on user intent, load the correct toolset, and visually indicate the current mode (project creation vs. active project work).
- Blueprint mode UI uses the actual schema fields and keeps them readable/editable during the conversation; changes should appear immediately after successful tool calls.
- Persist project + blueprint data to Convex with transcript linkage and timestamps, ensuring idempotency if the user restarts the intake mid-way.
- Store partial progress so a paused new-project conversation can resume later with the same draft records and current field states.
- Maintain keyboard-only and mobile-friendly affordances for the redesigned UI (project chooser, blueprint panel, confirmation step).

## Deliverables
- Updated app shell under `app/` that presents the project list, session starter, and context-specific layouts (standard realtime panel vs. blueprint mode).
- Conversation orchestration logic that routes between `projectIntakeToolset` and `ghostwritingToolset`, including natural-language intent detection for mode switching.
- Convex functions/mutations implementing the toolset operations (project listing, creation, blueprint field updates, transcript tagging, blueprint commit).
- Shared TypeScript types for the tool payloads and blueprint structures (extending `projects` and `projectBlueprints` definitions).
- Optional: interaction tests or Storybook stories demonstrating both mode flows and realtime blueprint updates.

## Acceptance Criteria
- From the home screen, a user can start the assistant, choose between new or existing project, and see the UI adapt instantly (project badge, blueprint panel, etc.).
- Selecting "existing project" populates options from Convex via tool calls; the chosen project context loads before the assistant continues the conversation.
- Selecting "new project" triggers blueprint mode; all schema-backed fields appear, fill in as the user speaks, and persist correctly to `projects` and `projectBlueprints`.
- Users can correct any field verbally or by editing the blueprint panel; updates propagate back to Convex and are acknowledged by the assistant.
- Partial blueprint conversations survive refresh or handoff and can be resumed without losing collected data.
- After blueprint confirmation, the conversation transitions into the standard session loop with the ghostwriting toolset already loaded.
- `npm run lint`, `npm run typecheck`, and `npm run build` succeed.

## References
- PRD §7.1, §7.3 (`docs/prd/ai-ghostwriter-prd.md`).
  - Pay special attention to project setup expectations and collaboration handoff notes.
- Implementation Plan §2-F2 (`docs/implementation.md`).
- Ghostwriting interview research (`docs/research/ghostwriting-best-practices.md`).
