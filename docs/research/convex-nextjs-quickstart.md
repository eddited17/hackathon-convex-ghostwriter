# Convex + Next.js Quickstart (Docs Snapshot 2025)

Source: https://docs.convex.dev/quickstart/nextjs

Steps captured:
1. `npx create-next-app@latest my-app`
2. `cd my-app && npm install convex`
3. `npx convex dev` to authenticate, create a project, sync functions, and scaffold the `convex/` directory.
4. Prepare sample JSONL and import into Convex via `npx convex import --table tasks sampleData.jsonl`.
5. Define a query in `convex/tasks.ts` using `query` helper returning `ctx.db.query("tasks").collect()`.
6. Create `app/ConvexClientProvider.tsx` using `ConvexReactClient` and `ConvexProvider`.
7. Wrap `app/layout.tsx` body with the provider.
8. Use `useQuery(api.tasks.get)` in `app/page.tsx` (App Router) to render realtime data.
9. Start local dev server via `npm run dev`.

Highlights:
- Convex dev CLI handles deployment URLs and continuous sync of server functions.
- Convex provider requires `NEXT_PUBLIC_CONVEX_URL` for client connection.
- App Router integration uses generated `api` types in `convex/_generated/api`.
