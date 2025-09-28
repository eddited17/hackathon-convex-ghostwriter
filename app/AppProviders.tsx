"use client";

import type { ReactNode } from "react";

import { ConvexClientProvider } from "@/components/ConvexClientProvider";

import { RealtimeSessionProvider } from "./(session)/realtime-session/RealtimeSessionProvider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConvexClientProvider>
      <RealtimeSessionProvider>{children}</RealtimeSessionProvider>
    </ConvexClientProvider>
  );
}
