# AI Ghostwriter - Voice-First Writing Assistant

A **voice-first AI ghostwriting assistant** that orchestrates real-time conversations between users and OpenAI's Realtime API, then queues background drafting jobs to produce long-form content.

Built with **Next.js 15.5**, **Convex** for reactive data, and **OpenAI Realtime API** for voice-first collaboration.

## Features

### 🎙️ Three-Tier Session Modes
- **Intake Mode** - List/create projects, gather initial metadata
- **Blueprint Mode** - Fill project blueprint fields (target audience, voice guardrails, materials)
- **Ghostwriting Mode** - Active drafting with document workspace tools

### 📝 Voice-First Drafting
- Real-time voice conversations with OpenAI Realtime API
- Background draft processing using OpenAI Responses API
- Live document updates via reactive Convex queries
- Transcript anchoring for context tracking

### 🎯 Smart Project Management
- Skip or resume blueprint setup anytime
- Manual editing alongside voice capture
- Persistent draft jobs with status tracking
- Section-based document organization

### 🔧 Advanced Audio Controls
- Device selection (input/output)
- Voice Activity Detection (VAD) indicators
- Noise reduction profiles (near-field/far-field)
- Turn detection configuration

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key with Realtime API access
- Convex account (free tier works)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd hackathon-convex
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` with your credentials:
   ```env
   # OpenAI Configuration
   OPENAI_API_KEY=sk-...                    # Required: Your OpenAI API key
   OPENAI_REALTIME_MODEL=gpt-realtime       # Optional: Realtime model (default: gpt-realtime)
   OPENAI_DRAFTING_MODEL=gpt-4.1-mini       # Optional: Background drafting model (default: gpt-4.1-mini)
   OPENAI_REALTIME_VOICE=marin              # Optional: Voice name (default: marin)

   # Convex Configuration
   NEXT_PUBLIC_CONVEX_URL=http://localhost:3210    # Required: Browser Convex URL
   CONVEX_DEPLOYMENT_URL=http://localhost:3210     # Required: Server-side Convex URL
   ```

4. **Start Convex dev server** (in one terminal)
   ```bash
   npx convex dev
   ```

5. **Start Next.js dev server** (in another terminal)
   ```bash
   npm run dev
   ```

6. **Open your browser**

   Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

### Starting a Session

1. Visit `/projects` to see your project list
2. Click "Start session" in the control bar
3. Grant microphone permissions when prompted
4. Choose to create a new project or continue an existing one

### Blueprint Setup

The assistant will guide you through capturing:
- **Desired Outcome** - What you want to achieve
- **Target Audience** - Who you're writing for
- **Materials Inventory** - Source materials and references
- **Communication Preferences** - How you like to work
- **Voice Guardrails** - Tone, structure, and content boundaries

You can skip setup anytime and jump straight to drafting!

### Ghostwriting Mode

Once in ghostwriting mode:
- Speak naturally about what you want to write
- The assistant queues draft updates in the background
- Watch your document materialize in real-time
- Switch between Document and Settings tabs
- Manage outline, sections, and TODOs via voice

### Key Commands

```bash
# Development
npm run dev          # Start Next.js dev server (localhost:3000)
npx convex dev       # Start Convex dev deployment (localhost:3210)

# Build & Quality
npm run build        # Build Next.js for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint

# Convex Operations
npm run drain:drafts                            # Manually trigger draft processing queue
npx convex run documents:triggerDraftProcessing # Same as above, direct invocation
```

## Project Structure

```
app/
  (session)/realtime-session/  # Realtime session shell components
    RealtimeSessionShell.tsx   # Main session orchestrator
    DocumentWorkspace.tsx      # Live draft view with sections/todos
    SessionControls.tsx        # Audio device controls, VAD meters
    useRealtimeSession.ts      # WebSocket client hook
    useProjectIntakeFlow.ts    # Blueprint skip/resume logic
  api/realtime/secret/         # OpenAI client_secrets endpoint
  projects/                    # Project list and detail views

convex/
  schema.ts                    # All Convex table definitions
  documents.ts                 # Draft job queue, background drafting
  projects.ts                  # Project + blueprint CRUD
  sessions.ts, messages.ts     # Session/transcript management
  lib/ghostwriting.ts          # Drafting prompt builder

lib/
  realtimeInstructions.ts      # Dynamic system prompt builder
  realtimeTools.ts             # OpenAI function tool definitions
  realtimeAudio.ts             # Audio device utilities, VAD helpers
  projects.ts                  # Client-side project utilities
  languages.ts                 # Language option definitions

docs/
  prd/ai-ghostwriter-prd.md    # Product requirements
  implementation.md            # Milestone roadmap
  tasks/*.md                   # Feature slice specs
```

## Key Architecture Concepts

### Tool-Driven Conversation
The realtime assistant uses function tools to interact with the system:
- `get_document_workspace` - Refresh document view
- `manage_outline` - Add/rename/reorder/remove sections
- `queue_draft_update` - Trigger background drafting
- `sync_blueprint_field` - Capture blueprint data
- `create_note` - Save facts, stories, TODOs

### Transcript Anchoring
OpenAI realtime events produce ephemeral IDs that map to persisted Convex messages via the `projectTranscripts` table, enabling bidirectional lookup.

### Background Drafting
Draft jobs are queued with status tracking (`queued` → `running` → `complete`/`error`), processed by Convex actions that call OpenAI's Responses API, then stream updates back via reactive queries.

### Session Mode Transitions
- Start in `intake` (no project)
- Transition to `blueprint` after creating/selecting a project
- Enter `ghostwriting` after committing blueprint or skipping setup

## Troubleshooting

**Realtime connection fails:**
- Check `OPENAI_API_KEY` is set in `.env.local`
- Verify `NEXT_PUBLIC_CONVEX_URL` matches Convex dev deployment
- Open browser DevTools → Network → WS to inspect WebSocket

**Draft jobs stuck in "queued":**
- Run `npm run drain:drafts` to manually trigger processing
- Check `draftJobs` table for error messages
- Verify `OPENAI_DRAFTING_MODEL` is valid

**Tools not available:**
- Confirm mode transition completed
- Check tool is listed in `TOOLSET_BY_MODE` for current mode
- Refresh browser for new ephemeral secret with updated tools

## Documentation

- **[PRD](docs/prd/ai-ghostwriter-prd.md)** - Product requirements and vision
- **[Implementation Plan](docs/implementation.md)** - Milestone roadmap
- **[CLAUDE.md](CLAUDE.md)** - Development guidance for Claude Code
- **[Tasks](docs/tasks/)** - Feature slice specifications

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)** license.

See [LICENSE](LICENSE) for details.

**TL;DR:** Free for personal, educational, and research use. Commercial use prohibited. Derivatives must use the same license.

## Contributing

This is a hackathon project. If you'd like to contribute or have questions, please open an issue.

---

Built with ❤️ using Next.js, Convex, and OpenAI Realtime API
