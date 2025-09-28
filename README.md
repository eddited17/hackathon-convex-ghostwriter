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

The workspace now opens on the Projects list (`/projects`), where you can launch realtime conversations that connect to OpenAI’s Realtime API while persisting transcripts to Convex.

1. Ensure a Convex dev deployment is running locally (`npx convex dev`) and that `NEXT_PUBLIC_CONVEX_URL`/`CONVEX_DEPLOYMENT_URL` point to it.
2. Populate `.env.local` with your OpenAI credentials and realtime preferences.
3. Start the Next.js dev server with `npm run dev` and visit [http://localhost:3000](http://localhost:3000). You’ll be redirected to `/projects`.
4. Use **Start session** to begin the assistant. When prompted, grant microphone access, pick input/output devices, and toggle the noise-reduction profile as needed.
5. Speak with the assistant or type a manual reply—transcripts stream live, VAD badges reflect server events, and messages are written into the `sessions`/`messages` Convex tables.

If the connection drops, refresh the devices list and use “Start session” again; a fresh ephemeral secret will be generated automatically.

## Project Intake & Blueprint Mode

The project list doubles as the launchpad for guided intake:

- **Existing project path:** choose any card or tell the assistant which project to reopen. The shell hydrates metadata, applies project context to the current session, and keeps the intake tooling available for follow-up questions.
- **New project path:** from a blank session, say you want to start something new (or trigger the CTA). The assistant creates an `intake` project plus draft blueprint, then walks field-by-field through the schema while the “Blueprint fields” panel updates in realtime.
- **Manual metadata edits:** title, content type, goal, and any blueprint text areas in the sidebar stay editable. Blur events sync changes back to Convex using the same tool plumbing as voice updates.
- **Partial progress:** blueprint drafts are saved incrementally, so refreshing or rejoining later resumes where you left off.

Task 03 will extend this foundation with a ghostwriting toolset, transcript anchors, and richer interview behavior—see [`docs/tasks/03-curiosity-voice-coaching.md`](docs/tasks/03-curiosity-voice-coaching.md) for the upcoming scope.
