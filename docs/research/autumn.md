# Autumn (Stripe Orchestration) Overview (Docs Snapshot 2025)

Sources:
- https://docs.useautumn.com/welcome
- https://docs.useautumn.com/setup

Key points:
- Autumn acts as the pricing/billing database atop Stripe: handles webhooks, synchronizes subscription state, enforces feature access, and exposes React components.
- Eliminates need to manage Stripe webhooks directly; provides CLI (`npx atmn`) to define products/features via `autumn.config.ts` and push to Autumn sandbox.
- Typical flow:
  1. Model products/features using `feature`, `product`, `featureItem`, `priceItem` helpers.
  2. Install `autumn-js`; configure `AUTUMN_SECRET_KEY`.
  3. Server-side: mount `autumnHandler` (for Next.js, `app/api/autumn/[...all]/route.ts`) and identify customers via auth provider (e.g., better-auth session).
  4. Client-side: wrap app with `<AutumnProvider>`; use hooks like `useCustomer()` for checkout, access checks, usage data.
  5. Payments: call `checkout` or use prebuilt `CheckoutDialog`/`PricingTable`; ensure Stripe keys configured in Autumn dashboard.
  6. Access control: utilize `check`, `track`, and `customer` APIs both server- and client-side to enforce limits and display balances.
- Supports advanced pricing: credits, usage tracking, balances, referrals, and UI components based on shadcn/ui.
- Designed for product-led SaaS/AI startups; scales without custom webhook handling; integrates with Convex backend (dedicated setup guide).
