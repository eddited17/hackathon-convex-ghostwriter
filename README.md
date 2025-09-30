# AI Ghostwriter Realtime Assistant

This repository hosts the scaffolding for a voice-first ghostwriting workspace built with:

- **Next.js 15.5** (App Router, TypeScript)
- **Convex** for reactive data + background actions
- **OpenAI Realtime API** for audio-first collaboration

The high-level requirements and delivery plan live in [`docs/prd/ai-ghostwriter-prd.md`](docs/prd/ai-ghostwriter-prd.md) and [`docs/implementation.md`](docs/implementation.md).

## Getting Started

> **Note:** Dependencies are declared but not yet installed (network access is disabled in this environment). After cloning, run `npm install` locally to produce `node_modules` and a `package-lock.json`.

```bash
npm install
npm run dev
```

The app uses the Next.js App Router. Pages are served from the `app/` directory.

## Environment Variables

Duplicate `.env.example` to `.env.local` and provide values before running the stack.

```bash
cp .env.example .env.local
```

Key variables required for the realtime shell:

- `OPENAI_API_KEY` – standard API key used by the secret exchange endpoint.
- `OPENAI_REALTIME_MODEL` – defaults to `gpt-realtime`, override if you want a different snapshot.
- `OPENAI_REALTIME_VOICE` – optional; voice name passed to the session config (defaults to `marin`).
- `NEXT_PUBLIC_CONVEX_URL` – Convex deployment URL exposed to the browser (`http://localhost:3210` for `npx convex dev`).
- `CONVEX_DEPLOYMENT_URL` – server-side Convex URL used by scripts and actions.

## Project Layout

```
app/                # Next.js routes and layout
components/         # Shared React components (stub)
convex/             # Convex schema and server functions
lib/                # Shared utilities (stub)
public/             # Static assets
```

For detailed milestones, refer to [`docs/implementation.md`](docs/implementation.md).

## Realtime Session Shell

The workspace still opens on the Projects list (`/projects`), but the realtime shell now delivers the full ghostwriting workflow: interviewing, note-taking, and live drafting in a single loop.

1. Ensure a Convex dev deployment is running locally (`npx convex dev`) and that `NEXT_PUBLIC_CONVEX_URL`/`CONVEX_DEPLOYMENT_URL` point to it.
2. Populate `.env.local` with your OpenAI credentials and realtime preferences.
3. Start the Next.js dev server with `npm run dev` and visit [http://localhost:3000](http://localhost:3000). You’ll be redirected to `/projects`.
4. Use **Start session** to begin the assistant. When prompted, grant microphone access, pick input/output devices, and toggle the noise-reduction profile as needed.
5. Speak with the assistant or type a manual reply—transcripts stream live, voice-activity badges reflect server events, and messages are persisted to the `sessions`/`messages` Convex tables.

If the connection drops, refresh the devices list and tap “Start session” again; a fresh ephemeral secret will be generated automatically.

## Blueprint Intake with Skip/Resume Controls

The project list still doubles as the launchpad for guided intake, but the assistant now treats the blueprint as optional:

- **Existing project path:** choose any card or tell the assistant which project to reopen. The shell hydrates metadata, applies project context to the current session, and keeps blueprint tooling available for follow-up questions.
- **New project path:** from a blank session, say you want to start something new (or trigger the CTA). The assistant creates an `intake` project plus draft blueprint, then walks field-by-field through the schema while the “Blueprint fields” panel updates in realtime.
- **Skip & resume:** at any point you or the client can say “let’s jump into the draft” (or click the “Skip setup & start drafting” button). The document tab unlocks instantly, yet the sidebar continues to track which blueprint fields still need answers. You can resume setup later via voice or the “Resume setup” button.
- **Manual metadata edits:** title, content type, goal, and any blueprint text areas in the sidebar stay editable. Blur events sync changes back to Convex using the same tool plumbing as voice updates.
- **Partial progress:** blueprint drafts and bypass state are stored in Convex, so refreshing or rejoining later resumes exactly where you left off.

## Ghostwriting Document Loop

Once a project enters drafting (either because the blueprint is committed or you skipped intake), the shell switches to the document-first view:

- **Document tab:** shows the live Markdown draft, section outline, blueprint highlights, and outstanding TODOs. Edits streamed back from Convex update immediately thanks to the ghostwriting toolset.
- **Session settings tab:** houses transcripts, diagnostics, device controls, and manual reply. Switching tabs never interrupts the live draft view.
- **Realtime drafting:** the assistant receives the entire document and can trigger `apply_document_edits`, `create_note`, `update_todo_status`, `record_transcript_pointer`, and more. Tool access is controlled centrally via `lib/realtimeTools.ts` so the server and client stay in sync as session mode changes.
- **Transcript anchoring:** every OpenAI transcript fragment (`user-*` / `assistant-*` / `item_*`) is mapped back to the persisted Convex message id. Notes, blueprint syncs, and TODO updates now attach to the correct transcript pointer without validation errors.
- **Memory loop:** facts, stories, style cues, and TODOs are captured as structured Convex notes with optional transcript anchors. The document sidebar surfaces open items so nothing gets lost while drafting.

For additional roadmap context, check [`docs/tasks/03-curiosity-voice-coaching.md`](docs/tasks/03-curiosity-voice-coaching.md) and the PRD in `docs/prd/ai-ghostwriter-prd.md`.
