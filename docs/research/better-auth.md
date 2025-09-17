# Better Auth Overview (Docs Snapshot 2025)

Sources:
- https://www.better-auth.com/docs/introduction
- https://www.better-auth.com/docs/examples/next-js

Key points:
- Framework-agnostic TypeScript authentication/authorization library with plugin ecosystem (2FA, multi-tenancy, social login, rate limiting, automatic DB management).
- Supports email/password, passkeys, social sign-in, session/account management, organization roles, and extensibility via plugins.
- Next.js example demonstrates full-stack features: email/password flows, social providers, passkeys, email verification, password reset, 2FA, profile update, session management, and organization role handling.
- Demo code hosted at `github.com/better-auth/better-auth` (`demo/nextjs`), runnable via pnpm.
- Setup pattern: clone repo, copy `.env.example` → `.env`, configure providers, run `pnpm install` and `pnpm dev`.
- Provides demo and StackBlitz templates for rapid experimentation.

Integration considerations for project:
- Aligns with minimal dependency rule: single auth library covering multiple flows.
- Works with Next.js App Router; can integrate with Convex actions via server components.
- Evaluate plugin needs (e.g., organization, multi-session) based on future roadmap once core functionality stabilizes.
