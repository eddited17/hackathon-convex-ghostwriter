# Convex Backend Scaffold

This folder contains the starter schema and scaffolding for the Convex backend.

## Setup

1. Install the Convex CLI locally: `npm install -g convex`.
2. Authenticate and create a dev deployment: `npx convex dev`.
3. Update the generated `convex.json` with your deployment slug.
4. Regenerate client types after schema or function changes: `npx convex codegen`.

Sample functions are provided in `convex/functions.example.ts`; copy the snippets into
real modules after you generate `./_generated` bindings.

See [`docs/implementation.md`](../docs/implementation.md) for the milestone plan.
