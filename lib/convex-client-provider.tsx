"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexProvider } from "convex/react";
import { createContext, useContext, useState } from "react";

interface ConvexAvailabilityContextValue {
  isConfigured: boolean;
}

const ConvexAvailabilityContext = createContext<ConvexAvailabilityContextValue>({
  isConfigured: false
});

export function useConvexAvailability() {
  return useContext(ConvexAvailabilityContext);
}

export function ConvexClientProvider({
  children
}: {
  children: React.ReactNode;
}) {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const [client] = useState(() => {
    const targetUrl = convexUrl ?? "https://example.convex.cloud";
    return new ConvexReactClient(targetUrl, {
      // Disable the unsaved changes dialog so intake drafts can rely on local storage.
      unsavedChangesWarning: false
    });
  });

  return (
    <ConvexAvailabilityContext.Provider
      value={{ isConfigured: Boolean(convexUrl) }}
    >
      <ConvexProvider client={client}>{children}</ConvexProvider>
    </ConvexAvailabilityContext.Provider>
  );
}
