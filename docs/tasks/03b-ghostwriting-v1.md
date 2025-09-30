# Task 03b — Ghostwriting V1 Split Loops

We keep the existing project selection and intake experience intact. The assistant should continue to:
- Run the project selection loop with `list_projects` / `create_project` / `assign_project_to_session`.
- Run the intake loop to close blueprint gaps before drafting (`sync_blueprint_field`, `commit_blueprint`).

The changes below focus solely on the drafting side so the realtime assistant feels human-fast.

## Goals
- Offload whole-document editing from the realtime assistant to a queued background drafter.
- Keep conversation + memory capture inside the current WebRTC session for responsiveness.
- Ship tonight: minimal schema/API churn; reuse existing Convex mutations where possible.

## High-Level Architecture
1. **Realtime loop (unchanged for selection/intake):**
   - Assistant interviews the client, captures notes/TODOs (`create_note`, `update_todo_status`, `record_transcript_pointer`).
   - When in ghostwriting mode it no longer calls `apply_document_edits`; instead it enqueues a draft update.
2. **Draft queue (new):**
   - Ghostwriting toolset gains a `queue_draft_update` function. Payload: `{ projectId, urgency, summary? }`.
   - The realtime client handles the tool call by invoking a new Convex mutation `documents.enqueueDraftUpdate`.
3. **Background drafter (new action/cron):**
   - Polls queued jobs, loads blueprint + open notes + recent transcripts.
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
   - Action/cron `documents.processDraftQueue` pops next job, calls model (stub first), writes via `documents.applyEdits`, updates status.
4. **UI feedback**
   - Extend `DocumentWorkspace` query to fetch latest job status.
   - Show spinner/banner when `status === "queued" | "running"`, show error toast when `status === "error"`.
5. **Testing / polish**
   - Manual end-to-end: selection → intake → ghostwriting; confirm assistant stays responsive while Markdown updates arrive via Convex.
   - Log + metrics stub for draft job durations.

## Nice-to-haves (if time allows)
- Throttle queue requests (ignore duplicates within N seconds).
- Persist generated summary inside job for assistant to narrate.
- Swap stub writer with `gpt-5-mini` call when API key ready.

Deliverable for Task 03b: ghostwriting V1 with responsive interview loop and background drafting, ready for live demos.
