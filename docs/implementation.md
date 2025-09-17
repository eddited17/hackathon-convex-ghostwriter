# Implementation Plan — AI Ghostwriter Realtime Assistant

## 0. Outstanding Planning Decisions
- **Long-form model snapshot**: Default to OpenAI `gpt-5-mini` (Responses API) for background drafting; define fallback if latency or quality gaps emerge.
- **Audio UI scope**: Commit to state-of-the-art experience—device selection, audio level metering, VAD metadata usage, OpenAI background suppression—ensure feasibility with target browsers/devices.
- **better-auth & Autumn sequencing**: Defer integration until core authoring, collaboration, and export features are complete and stable.

## 1. Foundational Setup (Shared Groundwork)
1. Initialize Next.js 15.5 App Router project with TypeScript, ESLint, testing baseline.
2. Install Convex CLI, create dev deployment, scaffold `convex/` directory.
3. Commit shared configs: Node version manager, lint/test scripts, prettier, `.env.example` (OpenAI, Convex, better-auth, Stripe/Autumn placeholders).
4. Establish folder structure (`app/`, `components/`, `lib/`, `docs/`, `convex/`), add README with contributor workflow, branch naming, PR checklist.
5. Seed Convex schema with `users`, `projects`, `projectBlueprints`, `sessions`, `messages`, `notes`, `documents`, `documentSections`, `todos` tables (skeleton types, indexes TBD).
6. Add CI skeleton (e.g., GitHub Actions) running `lint`, `test`, and `typecheck` on PRs.

## 2. Core Realtime Experience (Milestone 1)
- **Feature Slice F1** — Realtime Session Shell
  - Implement WebRTC handshake with OpenAI Realtime API (client secret endpoint + browser client).
  - Build advanced audio controls: device picker, live level meters, VAD indicators, toggle for OpenAI background suppression.
  - Stream transcripts in real time and persist speaker-separated text to Convex (`sessions`, `messages`); no raw audio storage.

- **Feature Slice F2** — Project Definition Intake
  - Build UI flow for guided intake (project concept, outcomes, target audience, timeline, materials, budget, comms prefs).
  - Store results in `projectBlueprints`; expose summary on project dashboard.
  - Link blueprint to new sessions (pre-fill prompts, voice workshop queue).

- **Feature Slice F3** — Curiosity & Voice Coaching
  - Encode guided interview prompts (leveraging `docs/research/ghostwriting-best-practices.md`).
  - Implement “voice workshop” module capturing tone/structure/content preferences; sync to notes (`noteType=voice`).
  - Surface TODO chips for unresolved questions.

- **Feature Slice F4** — Note Capture & Document Draft Stub
  - Convert transcripts + AI summaries into structured Convex notes.
  - Build background action stub for long-form drafting (selected model TBD) writing placeholder document sections.
  - Render live document preview with diff highlights (UI scaffold only).

## 3. Enhanced Drafting & Collaboration (Milestone 2)
- Integrate selected long-form model; finalize batching/throttling strategy.
- Implement section locking/refinement controls and history tracking.
- Expand content-type templates (blog/article/biography) stored in Convex.
- Add recap checkpoints (voice + timeline reminders) and export plain Markdown.

## 4. Authentication & Monetization (Post-Core Enhancements)
- **better-auth integration**: Only begin once core authoring, collaboration, and export flows (Milestones 1–2) are stable in production-like testing; then wire better-auth for sign-in, session enforcement, organization support if needed.
- **Autumn + Stripe**: After better-auth is live and stable, introduce paid tiers, integrate `autumnHandler` routes, wrap UI with `<AutumnProvider>`, gate premium features.

## 5. QA & DevOps
- Define testing strategy: unit tests for Convex functions, integration tests for WebRTC flow (mocked), end-to-end smoke tests.
- Document manual QA checklist per milestone (audio handshake, note syncing, draft update latency).
- Plan staging environment + feature flagging for risky additions (better-auth, billing).

## 6. Project Management Rituals
- Maintain Kanban board with feature slices, owners, review status.
- Enforce PR checklist: lint/test, schema diffs, env updates, documentation links.
- Schedule integration reviews before merging into `main`; resolve Convex schema migrations collaboratively.

## 7. Documentation & Knowledge Base
- Keep `docs/` updated with architectural decisions, API usage, prompt templates.
- Add developer onboarding checklist referencing PRD, implementation plan, and schematics.
- Capture lessons learned from each milestone to inform parallel agent assignments.
