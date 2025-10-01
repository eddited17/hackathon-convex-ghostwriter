"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  type RealtimeSessionState,
  useRealtimeSession,
} from "./useRealtimeSession";

const RealtimeSessionContext = createContext<RealtimeSessionState | null>(null);

export function RealtimeSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const session = useRealtimeSession();

  return (
    <RealtimeSessionContext.Provider value={session}>
      <SessionRouteSync />
      <SessionAudioBridge />
      {children}
    </RealtimeSessionContext.Provider>
  );
}

export function useRealtimeSessionContext() {
  const context = useContext(RealtimeSessionContext);
  if (!context) {
    throw new Error(
      "useRealtimeSessionContext must be used within a RealtimeSessionProvider",
    );
  }
  return context;
}

function SessionRouteSync() {
  const { sessionRecord } = useRealtimeSessionContext();
  const router = useRouter();
  const pathname = usePathname();
  const lastProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    const activeProjectId = sessionRecord?.projectId ?? null;
    const lastProjectId = lastProjectIdRef.current;
    console.log("[session-route-sync] projectId change", {
      activeProjectId,
      lastProjectId,
      pathname,
    });

    if (activeProjectId && activeProjectId !== lastProjectId) {
      lastProjectIdRef.current = activeProjectId;
      const targetPath = `/projects/${activeProjectId}`;
      if (pathname !== targetPath) {
        try {
          router.push(targetPath);
        } catch (navigationError) {
          console.error("Failed to navigate to active project", navigationError);
        }
      }
      return;
    }

    if (!activeProjectId) {
      lastProjectIdRef.current = null;
    }
  }, [pathname, router, sessionRecord?.projectId]);

  return null;
}

function SessionAudioBridge() {
  const { registerAudioElement } = useRealtimeSessionContext();
  const audioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      registerAudioElement(element);
    },
    [registerAudioElement],
  );

  return <audio ref={audioRef} hidden playsInline />;
}
