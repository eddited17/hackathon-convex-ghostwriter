# AI Ghostwriter Platform Plan

## Core Technologies
- Frontend: Next.js 15.5 (App Router, React Server Components, Turbopack-ready builds).
- Backend/runtime: Convex (managed reactive database + TypeScript server functions).
- Realtime AI: OpenAI `gpt-realtime` model over WebRTC (primary) with fallback WebSocket where necessary.
- Background authoring AI: OpenAI responses API (e.g., GPT-5 or GPT-4.1) for long-form drafting fed by structured notes.
- Audio capture/synthesis: Browser WebRTC microphone stream to OpenAI; audio playback from AI responses.

## Major Components
1. **Project Workspace Management**
   - Create/search/select projects (Convex tables: `projects`, `sessions`).
   - Store metadata: title, content type (blog post, article, biography), goal statement, target audience, status.
   - Maintain session history with timestamps, participants, and link to active documents.

2. **Realtime Conversation Console**
   - Voice-first UI: microphone controls, waveform display, live transcript (user + AI).
   - Realtime session handler bridging browser to OpenAI Realtime API using WebRTC.
   - Conversational policies prompting AI to lead with questions, confirmations, summaries, and note-taking.
   - Clarification triggers: AI queries user when context gaps detected; repeat/confirm key facts.

3. **Note Capture & Structuring**
   - In-session event stream duplicates user utterances and AI summaries into structured notes (Convex `notes` table).
   - Use conversation agent instructions to tag segments (e.g., `FACT`, `ANECDOTE`, `OUTLINE`, `STYLE`).
   - Provide UI to review and edit notes asynchronously.

4. **Background Draft Composer**
   - Convex action triggered on note updates batches context and calls long-form model to produce document sections.
   - Maintain document diff (Convex `documents` + `document_sections`).
   - Support incremental updates visible in frontend (subscribe to Convex query; highlight changes).
   - Guardrails for idempotency, version tracking, and rollback snapshots.

5. **Content Type Templates**
   - Predefined story arcs & structural prompts for blog, article, biography.
   - Determine tone, deliverables (word count, headings) to steer background writer.

6. **Curiosity & Feedback Loop**
   - Agent prompt includes heuristics to ask follow-ups, confirm details, and surface missing info.
   - Use Realtime tool-calling to flag TODOs or escalate clarifications to user.
   - Provide quick reply UI if user chooses to type.

7. **Document Presentation Layer**
   - Live document viewer with diff highlights, progress indicators, section states (drafting, needs review, completed).
   - Controls for user to approve sections, lock them, or request revisions.

8. **Persistence & Sync**
   - All state persists in Convex; subscriptions feed both conversation controls and document view.
   - Convex scheduled functions for cleanup, summarizing sessions, generating final deliverables (PDF/Markdown export).

9. **Minimal Dependencies Approach**
   - Favor native Web APIs (WebRTC, Web Audio) and Convex/Next built-ins.
   - Consider only essential third-party libs (e.g., Tailwind or Radix optional).
   - Use internal utilities for state machines (XState optional but avoid unless necessary).

10. **Observability & Safety**
    - Session logging stored in Convex for auditing.
    - Rate limiting and API key management via Next.js API routes or server actions hitting Convex secrets store.
    - Basic fallback flows if Realtime session drops (auto-reconnect, graceful degrade to text). 

## Key Open Questions
- Which long-form model snapshot best balances quality and cost? (Assumed GPT-5 or GPT-4.1.)
- How to handle multi-device access or offline review? (Potential follow-up milestone.)
- Export formats and integration requirements (Docx, Google Docs?).

## Immediate Deliverables
1. Product Requirements Document (PRD) incorporating above architecture and UX flows.
2. Technical spike plan for WebRTC integration atop OpenAI Realtime API (borrowing from openai-realtime-console patterns).
3. Convex schema draft covering projects, sessions, notes, documents, messages, user profiles.
