# Next.js 15.5 Release Notes (Aug 18, 2025)

Source: https://nextjs.org/blog/next-15-5

Key highlights:
- Turbopack production builds (`next build --turbopack`) in beta with significant multi-core performance gains.
- Node.js runtime for middleware is now stable, enabling access to Node APIs within `middleware.ts`.
- Typed Routes flag is stable; new route export validation and route props helpers with Turbopack support.
- New `next typegen` command for generating route types outside of dev/build pipelines.
- `next lint` command deprecated in preparation for removal in Next.js 16; emphasis on native ESLint/Biome configs.
- Deprecation warnings for Next.js 16: `legacyBehavior` prop removal, AMP support removal, `next/image` quality restrictions, and local image pattern requirements.

Upgrade commands:
```
npx @next/codemod@canary upgrade latest
npm install next@latest react@latest react-dom@latest
npx create-next-app@latest
```

Middleware example using Node runtime:
```
export const config = { runtime: 'nodejs' };

export function middleware(request: NextRequest) {
  const fs = require('fs');
  const crypto = require('crypto');
  const token = request.headers.get('authorization');
  if (!isValidToken(token)) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}
```

Deprecation timeline: warnings now in 15.5, removals coming in 16. Plan migrations accordingly.
