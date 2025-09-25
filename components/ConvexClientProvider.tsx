"use client";

import { useMemo, type ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";

const DEFAULT_CONVEX_URL = "http://localhost:3210";
let cachedClient: ConvexReactClient | null = null;

const createClient = (url: string) => {
  if (cachedClient) return cachedClient;
  cachedClient = new ConvexReactClient(url);
  return cachedClient;
};

type ConvexClientProviderProps = {
  children: ReactNode;
};

export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  const configuredUrl =
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    process.env.NEXT_PUBLIC_CONVEX_DEPLOYMENT ??
    process.env.CONVEX_DEPLOYMENT_URL ??
    "";
  const convexUrl = configuredUrl || DEFAULT_CONVEX_URL;

  if (!configuredUrl && typeof window !== "undefined") {
    console.warn(
      "Convex URL not configured. Set NEXT_PUBLIC_CONVEX_URL to connect to your deployment.",
    );
  }

  const client = useMemo(() => createClient(convexUrl), [convexUrl]);

  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
