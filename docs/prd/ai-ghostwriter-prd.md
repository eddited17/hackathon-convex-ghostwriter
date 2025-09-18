# AI Ghostwriter Realtime Assistant — Product Requirements Document

## 1. Summary
Build a voice-first ghostwriting companion that captures a user’s spoken input, collaborates in real time with clarifying questions, and continuously produces long-form content (blog post, article, or biography). The experience should feel like working with a professional ghostwriter: mostly listening, probing for detail, and delivering a live-updating document without requiring the user to type.

## 2. Goals
- Deliver a hands-free creation experience enabled by OpenAI’s latest `gpt-realtime` model (GA Aug 28, 2025; see `docs/research/openai-realtime.md`).
- Maintain continuous alignment between the user’s spoken notes, the evolving outline, and the generated manuscript.
- Provide lightweight project management so returning users can resume or branch work effortlessly.
- Keep implementation lean: Next.js 15.5 + Convex backend, minimal third-party packages (per ground rule).

## 3. Non-Goals
- Editing or exporting to DOCX/Google Docs (out of scope for v1; limit to Markdown/HTML preview + copy/export later).
- Multi-user collaboration within the same session.
- Offline native mobile apps (focus on responsive web experience first).

## 4. Target Users
- Creators or executives who prefer dictation while commuting or multitasking.
- Subject matter experts who want a structured interview-style ghostwriting helper without typing.

## 5. Product Principles
- **Hands-free first:** All critical flows must be voice-driven with optional manual overrides.
- **Continuous alignment:** The AI repeats key facts, asks for clarifications, and confirms direction before large revisions.
- **Transparency:** Show what the AI heard (transcripts/notes) and how it is reflected in the draft.
- **Low cognitive load:** Minimal UI chrome; highlight questions and changes instead of dense controls.

## 6. Core Use Cases
1. Start a new project (select content type, co-create title + high-level goal) and capture initial briefing while the draft begins to form.
2. Resume an existing project, review last notes, continue conversation, and see the document evolve.
3. AI proactively asks for missing elements (e.g., target audience, anecdotes, timeline), confirms facts, and recaps before moving on.
4. Users request on-the-fly changes (“Let’s reframe the intro for a younger audience”) and watch the background draft update.

## 7. Functional Requirements
### 7.1 Project & Document Management
- Create/list projects with attributes: `title`, `contentType` (`blog_post`, `article`, `biography`), `goal`, `status`, `lastUpdated`.
- Auto-suggest project titles based on conversation and confirm with user.
- Attach multiple sessions to a project (each session = discrete realtime conversation).
- Persist generated documents with version history and section statuses (`drafting`, `needs_review`, `approved`).
- Provide a structured “project definition” flow before the first session that captures success outcomes, reader persona, publishing plan, high-level outline expectations, timeline boundaries, available materials, and budget guardrails—seed this intake with the guided questions in §7.3 and store the result as a reusable blueprint for future sessions.

### 7.2 Realtime Conversation Experience
- Use WebRTC with OpenAI `gpt-realtime` for sub-second round trips. Must support microphone capture, AI audio playback, and streaming transcripts persisted per speaker (no raw audio storage).
- Offer state-of-the-art voice UX: device selection (input/output), live audio level meters, voice activity detection leveraging `server_vad` metadata, and optional background suppression/noise reduction via OpenAI `input_audio_noise_reduction` profiles.
- Render dual transcripts (User / AI) with timestamped entries; allow the user to tap to hear segments again.
- Provide simple voice cues + visual prompts when AI needs response (e.g., highlight questions).
- Allow manual text replies via quick type input (fallback for noisy environments).

### 7.3 Curiosity & Clarification Loop
- Guided intake mirrors professional ghostwriter interviews (see `docs/research/ghostwriting-best-practices.md`): capture project concept, motivation, target audience, publishing plan, timeline expectations, existing material, budget guardrails, prior experiences, availability, preferred communication cadence, and lingering anxieties.
- System prompt drives behaviors: frequent paraphrasing, targeted follow-up questions, explicit consent before big outline shifts, polite interjections for missing context.
- Dedicated “voice workshop” turn early in the session to co-define structure, tone, and content markers (sentence cadence, formality, humor allowances, story types) so downstream drafting honors desired persona.
- Auto-generate recap checkpoints (e.g., “Here’s what I have so far—does this capture the main narrative?”) and restate agreed goals/reader outcomes during milestones.
- Flag unresolved TODOs; surface them in UI as chips to revisit, including missing stories, research gaps, and timeline/budget follow-ups.

### 7.4 Note Capture & Structuring
- All user insights (raw transcript + AI summaries) stored as structured notes with metadata: `noteType` (`fact`, `story`, `style`, `voice`, `todo`), `sourceMessageIds`, `confidence`.
- Capture dedicated “voice profile” entries detailing agreed tone, structure, and content boundaries so the background drafter can reference them explicitly.
- Notes update live in UI; allow lightweight editing/archiving.

### 7.5 Background Draft Composer
- Convex action listens for new/updated notes; periodically (or via throttle threshold) calls OpenAI `gpt-5-mini` (Responses API) to update document sections, with room to swap in a fallback snapshot if quality or latency regress.
- Support incremental section updates: introduction, body sections, conclusion. Display diff highlights and changelog in UI.
- Provide manual “refine section” and “lock section” controls; locked sections excluded from further automated rewrites.

### 7.6 Content-Type Templates
- Each content type presets outline skeleton, tone guidelines, and length targets.
- AI references templates when proposing structure and when drafting (store templates in Convex for easy updates).

### 7.7 Session Lifecycle
- Handle start, pause, resume, and end of realtime sessions with graceful audio cues.
- On session end, generate summary + next steps using background model and save to session record.

## 8. Technical Requirements
- Frontend: Next.js 15.5 (App Router). Prefer `next build --turbopack` (see `docs/research/nextjs-15-5.md`).
- State: Favor server components + Convex React hooks; avoid heavy client state managers.
- Backend: Convex for:
  - Data persistence (projects, sessions, notes, documents, transcripts, users).
  - Actions for orchestrating OpenAI calls (realtime token generation, background drafts, summarization).
  - Scheduled jobs for cleanup and progress summaries.
- OpenAI Integration:
  - Generate Realtime API client secrets server-side; provide to browser for WebRTC handshake.
  - Manage session configuration (tools list, instructions, template injection, asynchronous function calling).
  - Background writer uses Responses API with streaming disabled (batch updates) for deterministic diffing.
- Authentication: Begin with minimal access controls; adopt better-auth once core flows stabilize to deliver production-grade authentication.
- Storage: Transcripts + documents stored as structured JSON; generated manuscript also stored as Markdown for export.
- Monetization: Post-core functionality, integrate Stripe billing flows using Autumn to manage subscription lifecycle.
- Accessibility: Provide captions, keyboard focus management, and fallback TTS transcripts for hearing-impaired.

## 9. Data Model (Convex Draft)
- `users`: profile, voice preferences, roles.
- `projects`: `ownerId`, `title`, `contentType`, `goal`, `status`, `createdAt`, `updatedAt`.
- `sessions`: `projectId`, `startedAt`, `endedAt`, `realtimeSessionId`, `summary`, `status`.
- `messages`: transcripts incl. `sessionId`, `speaker`, `text`, `audioUrl`, `timestamp`, `tags`.
- `notes`: structured note entries referencing `messageIds`, metadata, `resolved` flag.
- `documents`: `projectId`, `latestDraftMarkdown`, `status`, `lockedSections`.
- `documentSections`: `documentId`, `heading`, `order`, `content`, `version`, `locked`.
- `todos`: outstanding clarifications or tasks.
- `projectBlueprints`: `projectId`, `desiredOutcome`, `targetAudience`, `publishingPlan`, `timeline`, `materialsInventory`, `communicationPreferences`, `budgetRange`, `voiceGuardrails`.

## 10. UX Flow (High-Level)
1. **Project onboarding:** AI greets, proposes content type options, co-creates title + goal, confirms outline expectations.
2. **Active interview:** User speaks; AI records transcript, paraphrases key info, asks follow-ups. Notes populate in sidebar.
3. **Draft updates:** Background composer produces first section preview; UI highlights change, AI announces progress.
4. **Clarify & iterate:** AI surfaces open questions; user responds; locked sections remain stable.
5. **Session wrap:** AI recaps achievements, outlines remaining tasks, optionally schedules follow-up session.

## 11. Metrics & Success Criteria
- Session continuation rate (users returning to same project).
- Average clarifications per session (should show active curiosity without overwhelming user).
- Time from initial note to first document section (<60 seconds target).
- User satisfaction proxy: thumbs-up/down per session recap.
- System reliability: <1% dropped realtime sessions per day.

## 12. Release Strategy
- **Milestone 1 (Internal Alpha):** Core realtime conversation with transcripts, manual note review, simple Markdown draft generation for blog posts.
- **Milestone 2 (Private Beta):** Add structured notes, automatic background drafting, biography template, section locking.
- **Milestone 3 (Public Beta):** Full project management, export/share, comprehensive analytics, expand content types.
- **Post-M3 Enhancements:** Layer in better-auth powered sign-in flows for all users and introduce paid tiers managed via Stripe subscriptions orchestrated through Autumn once core authoring experience is stable.

## 13. Risks & Mitigations
- **Realtime API evolution:** Track GA updates (docs in `docs/research/openai-realtime-prompting.md`); keep prompts modular.
- **Latency spikes:** Implement fallback to audio summarization if network degrades; degrade gracefully to text chat.
- **Overfitting prompts:** Establish prompt testing harness; version prompts in Convex to enable rapid iteration.
- **User trust:** Provide visible logs of captured facts; allow users to delete notes immediately.

## 14. Open Questions
- Preferred export formats and formatting fidelity requirements.
- Need for multilingual support (if yes, extend prompts + voice selection accordingly).
- How to price sessions vs. per-project usage given audio token costs.

---
**References**
- `docs/research/openai-realtime.md`: GA announcement and capabilities.
- `docs/research/openai-realtime-prompting.md`: Prompting best practices for `gpt-realtime`.
- `docs/research/openai-realtime-console.md`: Sample integration patterns.
- `docs/research/nextjs-15-5.md`: Framework baseline.
- `docs/research/convex-realtime.md` & `docs/research/convex-nextjs-quickstart.md`: Backend architecture & integration.
- `docs/research/system-plan.md`: Architectural plan supporting this PRD.
- `docs/research/better-auth.md`: Authentication library capabilities and Next.js example.
- `docs/research/autumn.md`: Stripe subscription orchestration with Autumn setup steps.
- `docs/research/ghostwriting-best-practices.md`: Human ghostwriter workflows, interview frameworks, and voice-capture tactics.
- `docs/research/audio-realtime-capabilities.md`: Realtime audio feature matrix, VAD/noise-reduction guidance, and browser/device requirements.
