# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
npm run dev          # Start Next.js dev server (localhost:3000)
npx convex dev       # Start Convex dev deployment (localhost:3210)
npm run build        # Build Next.js for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run test         # Run vitest tests
```

### Convex Operations
```bash
npm run drain:drafts                           # Manually trigger draft processing queue
npx convex run documents:triggerDraftProcessing  # Same as above, direct invocation
```

### Environment Setup
```bash
cp .env.example .env.local  # Create local environment file
```

Required environment variables:
- `OPENAI_API_KEY` - OpenAI API key for realtime and drafting models
- `NEXT_PUBLIC_CONVEX_URL` - Convex deployment URL for browser (e.g., http://localhost:3210)
- `CONVEX_DEPLOYMENT_URL` - Server-side Convex URL for actions
- `OPENAI_REALTIME_MODEL` - Defaults to `gpt-realtime`
- `OPENAI_DRAFTING_MODEL` - Defaults to `gpt-4.1-mini` for background drafting
- `OPENAI_REALTIME_VOICE` - Defaults to `marin`

## Architecture

### Core Data Flow

This is a **voice-first AI ghostwriting assistant** that orchestrates real-time conversations between users and OpenAI's Realtime API, then queues background drafting jobs to produce long-form content.

**Key architectural patterns:**

1. **Three-tier session modes** (`lib/realtimeInstructions.ts`, `lib/realtimeTools.ts`):
   - `intake` - List/create projects, gather initial metadata
   - `blueprint` - Fill project blueprint fields (target audience, voice guardrails, materials)
   - `ghostwriting` - Active drafting with document workspace tools

2. **Realtime API integration** (`app/api/realtime/secret/route.ts`):
   - Next.js route handler exchanges OpenAI ephemeral secrets
   - Browser client (`useRealtimeSession.ts`) connects via WebSocket
   - Session instructions and toolset are dynamically built based on mode and project context
   - Supports advanced audio controls: device selection, VAD indicators, noise reduction profiles

3. **Transcript → Draft pipeline**:
   - OpenAI transcription events persist to `messages` table
   - Realtime orchestrator calls `queue_draft_update` tool with transcript anchors
   - Convex action (`convex/documents.ts`) runs background drafting using OpenAI Responses API (long-form model)
   - Draft jobs tracked in `draftJobs` table with status: queued → running → complete/error
   - Document updates stream back via reactive queries

4. **Convex as state backbone**:
   - All persistent data lives in Convex: `projects`, `projectBlueprints`, `sessions`, `messages`, `notes`, `documents`, `documentSections`, `todos`, `draftJobs`, `projectTranscripts`
   - Mutations/queries in `convex/*.ts` expose CRUD operations
   - Actions orchestrate OpenAI API calls and background processing
   - No authentication yet; uses sandbox user pattern

### File Organization

```
app/
  (session)/realtime-session/  # Realtime session shell components
    RealtimeSessionShell.tsx   # Main session orchestrator
    DocumentWorkspace.tsx      # Live draft view with sections/todos
    SessionControls.tsx        # Audio device controls, VAD meters
    useRealtimeSession.ts      # WebSocket client hook (OpenAI Realtime)
    useProjectIntakeFlow.ts    # Blueprint skip/resume logic
  api/realtime/secret/         # OpenAI client_secrets endpoint
  projects/                    # Project list and detail views

convex/
  schema.ts                    # All Convex table definitions
  documents.ts                 # Draft job queue, background drafting action
  projects.ts                  # Project + blueprint CRUD
  sessions.ts, messages.ts     # Session/transcript management
  notes.ts, todos.ts           # Memory capture and follow-up tracking
  lib/ghostwriting.ts          # Drafting prompt builder
  lib/telemetry.ts             # Metrics and alerts (stubs)

lib/
  realtimeInstructions.ts      # Dynamic system prompt builder per mode
  realtimeTools.ts             # OpenAI function tool definitions + mode mapping
  realtimeAudio.ts             # Audio device utilities, VAD helpers
  projects.ts                  # Client-side project utilities
  languages.ts                 # Language option definitions

docs/
  prd/ai-ghostwriter-prd.md    # Product requirements
  implementation.md            # Milestone roadmap
  tasks/*.md                   # Feature slice specs
  research/*.md                # OpenAI API, Convex, audio capabilities
```

### Critical Architectural Concepts

**Tool-driven conversation state:**
- The realtime assistant cannot see the document directly; it must call `get_document_workspace` to refresh its view
- `manage_outline` handles lightweight outline changes (add/rename/reorder/remove sections) without touching content
- `queue_draft_update` is the primary drafting trigger; it passes `messagePointers`, `transcriptAnchors`, and `promptContext` to the background drafter
- `apply_document_edits` is used by the DRAFTER to persist full document updates (not typically called by the assistant)
- Always set `promptContext.activeSection` to guide the drafter to the correct heading

**Transcript anchoring:**
- OpenAI realtime events produce ephemeral `item_*`, `user-*`, `assistant-*` ids
- These map to persisted Convex `messages` via `projectTranscripts` table
- Tools accept both `transcriptId` (ephemeral) and `messageId` (persisted) for cross-referencing

**Session mode transitions:**
- Start in `intake` (no project)
- Transition to `blueprint` after `create_project` or `assign_project_to_session`
- Enter `ghostwriting` after `commit_blueprint` or "Skip setup & start drafting"
- Mode changes trigger tool list refresh via `session.update({ tools: ... })`

**Background drafting:**
- Action `processDraftQueue` polls `draftJobs` table (status=queued)
- Calls OpenAI Responses API with full document + blueprint + transcript excerpts
- Parses structured JSON response: `{ markdown, sections, summary, usage }`
- Applies edits via `applyDocumentEdits` mutation
- Publishes metrics and alerts via telemetry stubs

## Development Workflow

1. **Start both servers concurrently:**
   ```bash
   npx convex dev    # Terminal 1
   npm run dev       # Terminal 2
   ```

2. **Workflow for adding new realtime tools:**
   - Add tool definition to `TOOL_DEFINITIONS` in `lib/realtimeTools.ts`
   - Add tool name to appropriate mode in `TOOLSET_BY_MODE`
   - Implement handler in relevant Convex function (mutation/query/action)
   - Update client-side tool handler in `useRealtimeSession.ts` if needed

3. **Workflow for changing session instructions:**
   - Edit `buildSessionInstructions()` in `lib/realtimeInstructions.ts`
   - Instructions are rebuilt on each secret exchange; refresh browser to test

4. **Testing draft processing:**
   - Use `npm run drain:drafts` to manually trigger queued draft jobs
   - Check `draftJobs` table in Convex dashboard for status/errors
   - Review `modelUsage` field for token consumption

5. **Schema changes:**
   - Edit `convex/schema.ts`
   - Convex dev server auto-pushes schema changes
   - Update TypeScript types via `convex/_generated/api.d.ts` (auto-generated)

## Key Patterns and Conventions

- **Realtime tool responses:** Always return structured data matching the tool's declared schema; the orchestrator reflects results back to the user
- **Outline management:** Use `manage_outline` for structural changes (add/rename/reorder/remove sections); operations are atomic and apply in sequence
- **Draft job urgency:** Use `asap` for user-requested revisions, `routine` for background processing
- **Section status enum:** `drafting` (in progress), `needs_detail` (placeholder waiting for content), `complete` (approved)
- **Section operations:**
  - `add` - Create new section with heading and position (defaults to end, status defaults to needs_detail)
  - `rename` - Change section heading (requires old heading + newHeading)
  - `reorder` - Move section to new position (requires heading + position)
  - `remove` - Delete section (requires heading)
- **Blueprint commitment:** Only call `commit_blueprint` after all required fields are filled; this unlocks ghostwriting mode
- **Transcript pointer format:** Store both realtime fragment id and Convex message id for bidirectional lookup
- **Language support:** All session instructions end with "Always respond in [language]" (see `lib/languages.ts`)

## Common Troubleshooting

**Realtime connection fails:**
- Check `OPENAI_API_KEY` is set in `.env.local`
- Verify `NEXT_PUBLIC_CONVEX_URL` matches Convex dev deployment
- Open browser DevTools → Network → WS to inspect WebSocket handshake

**Draft jobs stuck in "queued":**
- Run `npm run drain:drafts` to manually trigger processing
- Check `draftJobs` table for error messages
- Verify `OPENAI_DRAFTING_MODEL` is valid (e.g., `gpt-4.1-mini`, `gpt-5-mini`)

**Tools not available in session:**
- Confirm mode transition completed (check `session.update` event in console)
- Verify tool is listed in `TOOLSET_BY_MODE` for current mode
- Refresh browser to request new ephemeral secret with updated tools

**Transcript anchors not resolving:**
- Ensure `projectTranscripts` record exists for the session
- Check that realtime item ids are stored in `items` array with `messageId` mapping
- Use `record_transcript_pointer` tool to explicitly link fragments to messages
