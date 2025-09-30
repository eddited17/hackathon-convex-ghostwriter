# Task 03b — Ghostwriting V1 Split Loops

We keep the existing project selection and intake experience intact. The assistant should continue to:
- Run the project selection loop with `list_projects` / `create_project` / `assign_project_to_session`.
- Run the intake loop to close blueprint gaps before drafting (`sync_blueprint_field`, `commit_blueprint`).

The changes below focus solely on the drafting side so the realtime assistant feels human-fast.

## Goals
- Offload whole-document editing from the realtime assistant to a queued background drafter.
- Keep conversation + memory capture inside the current WebRTC session for responsiveness.
- Ship tonight: minimal schema/API churn; reuse existing Convex mutations where possible.

## Realtime Transcript Handling (Sept 2025 docs)
- **Authoritative source:** Follow the GA Realtime guides (see [OpenAI Realtime API](https://platform.openai.com/docs/guides/realtime) & [Realtime conversations](https://platform.openai.com/docs/guides/realtime-conversations), cached 2025‑09‑30). Conversation state is a linked list of `conversation.item.added` → `conversation.item.done` events with `previous_item_id` for ordering.
- **Capture strategy:** Subscribe to `conversation.item.*` and `response.*` transcript events that are already surfaced in `useRealtimeSession.ts:2100+`. Stream them into an in-memory log, but persist only via the default event payloads—no custom fragment IDs. This aligns with our local note in `docs/research/audio-realtime-capabilities.md` about relying on server transcripts.
- **Persistence:**
  1. When a session is assigned to a project, start appending every completed conversation item (`conversation.item.done`) for both roles into a new Convex `projectTranscripts` record keyed by `{ projectId, sessionId }`.
  2. On `stopSession`, snapshot the full ordered array (reconstruct via `previous_item_id` if necessary) so other services can replay the canonical transcript.
  3. Expose `projects.getTranscriptForProject` so drafting/memory jobs can read the entire conversation without rehydrating fragments.
- **Pointers:** Update `recordTranscriptPointer` to map anchors to official `item.id` values instead of synthetic fragment keys.

## High-Level Architecture
1. **Realtime loop (unchanged for selection/intake):**
   - Assistant interviews the client, captures notes/TODOs (`create_note`, `update_todo_status`, `record_transcript_pointer`).
   - When in ghostwriting mode it no longer calls `apply_document_edits`; instead it enqueues a draft update.
2. **Draft queue (new):**
   - Ghostwriting toolset gains a `queue_draft_update` function. Payload: `{ projectId, urgency, summary? }`.
   - The realtime client handles the tool call by invoking a new Convex mutation `documents.enqueueDraftUpdate`.
3. **Background drafter (new action/cron):**
   - Polls queued jobs, loads blueprint + open notes + latest transcript payload.
   - Calls long-form model (stub ok) to generate Markdown + section metadata.
   - Commits via existing `documents.applyEdits` mutation so Document tab auto-refreshes.
4. **Progress feedback:**
   - Store queue + job status in Convex (e.g. `draftJob.status = queued|running|complete|error`).
   - `DocumentWorkspace` subscribes to status and shows "drafting…" indicator while jobs run.

## Work Items
1. **Prompt & tools**
   - Update ghostwriting instructions to mention the queue, not direct edits.
   - Adjust `lib/realtimeTools.ts` ghostwriting list: remove `apply_document_edits`, add `queue_draft_update` definition.
2. **Realtime hook**
   - Handle `queue_draft_update` in `handleToolCall` within `useRealtimeSession.ts`.
   - Mutation should capture `sessionId`, optional transcript/message anchors.
3. **Convex backend**
   - Schema addition: `draftJobs` table (`projectId`, `sessionId`, `status`, `summary`, `createdAt`, `startedAt`, `completedAt`, `error`?).
   - Mutation `documents.enqueueDraftUpdate` inserts job if none running, else dedup/merge.
   - Action/cron `documents.processDraftQueue` pops next job, loads transcript via new query, calls model (stub first), writes via `documents.applyEdits`, updates status.
   - Add `projectTranscripts` table + `projects.saveTranscriptChunk` / `projects.finalizeTranscript` mutations to persist conversation items as described above.
4. **UI feedback**
   - Extend `DocumentWorkspace` query to fetch latest job status and transcript availability.
   - Show spinner/banner when `status === "queued" | "running"`, show error toast when `status === "error"`.
5. **Testing / polish**
   - Manual end-to-end: selection → intake → ghostwriting; confirm assistant stays responsive while Markdown updates arrive via Convex and full transcript is saved for the project.
   - Log + metrics stub for draft job durations; add sanity check that transcript replay matches live UI transcript.

## Nice-to-haves (if time allows)
- Throttle queue requests (ignore duplicates within N seconds).
- Persist generated summary inside job for assistant to narrate.
- Swap stub writer with `gpt-5-mini` call when API key ready.

Deliverable for Task 03b: ghostwriting V1 with responsive interview loop, canonical project transcripts, and background drafting ready for live demos.
