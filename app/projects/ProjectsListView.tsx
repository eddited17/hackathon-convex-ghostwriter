"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useRealtimeSessionContext } from "../(session)/realtime-session/RealtimeSessionProvider";
import { useProjectIntakeFlow } from "../(session)/realtime-session/useProjectIntakeFlow";

export default function ProjectsListView() {
  const session = useRealtimeSessionContext();
  const router = useRouter();
  const lastRoutedProjectIdRef = useRef<string | null>(null);
  const [isStartingSession, setIsStartingSession] = useState(false);

  const {
    phase,
    projects,
    isLoadingProjects,
    beginConversation,
    chooseExistingMode,
  } = useProjectIntakeFlow({
    transcripts: session.transcripts,
    status: session.status,
    startSession: session.startSession,
    sendTextMessage: session.sendTextMessage,
    sessionRecord: session.sessionRecord,
    assignProjectToSession: session.assignProjectToSession,
    resolveMessageId: session.resolveMessageId,
    ingestProjects: session.ingestProjects,
    onNavigateToProject: (projectId) => {
      router.push(`/projects/${projectId}`);
    },
  });

  const isConnecting =
    session.status === "connecting" || session.status === "requesting-permissions";
  const isSessionActive = session.status === "connected" || session.status === "connecting";

  const handleStartSession = async () => {
    if (isSessionActive || isStartingSession) return;
    setIsStartingSession(true);
    try {
      if (phase === "idle") {
        await beginConversation();
      } else {
        await chooseExistingMode();
      }
    } catch (startError) {
      console.error("Failed to start session", startError);
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleEndSession = async () => {
    try {
      await session.stopSession("Session ended from project list");
    } catch (stopError) {
      console.error("Failed to end session", stopError);
    }
  };

  useEffect(() => {
    const activeProjectId = session.sessionRecord?.projectId ?? null;
    if (!activeProjectId) {
      lastRoutedProjectIdRef.current = null;
      return;
    }
    if (lastRoutedProjectIdRef.current === activeProjectId) return;
    lastRoutedProjectIdRef.current = activeProjectId;
    console.log("[projects] routing to active project", activeProjectId);
    router.push(`/projects/${activeProjectId}`);
  }, [router, session.sessionRecord?.projectId]);

  return (
    <div className="projects-layout">
      <header className="projects-header">
        <div>
          <h1>Projects</h1>
          <p>Select a project to review details or start a realtime intake session.</p>
        </div>
        <div className="projects-actions">
          {isSessionActive ? (
            <button type="button" className="danger" onClick={() => void handleEndSession()}>
              {session.status === "connected" ? "End session" : "Cancel connection"}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={isConnecting || isStartingSession}
              onClick={() => {
                void handleStartSession();
              }}
            >
              {isConnecting || isStartingSession ? "Connecting…" : "Start session"}
            </button>
          )}
        </div>
      </header>

      <section className="projects-list">
        {isLoadingProjects ? (
          <div className="card placeholder">Loading projects…</div>
        ) : projects?.length ? (
          projects.map((entry) => (
            <article key={entry.project._id} className="card project-card">
              <header>
                <h2>{entry.project.title}</h2>
                <span className="status">{entry.project.status}</span>
              </header>
              <dl>
                <div>
                  <dt>Content type</dt>
                  <dd>{entry.project.contentType}</dd>
                </div>
                {entry.project.goal ? (
                  <div>
                    <dt>Goal</dt>
                    <dd>{entry.project.goal}</dd>
                  </div>
                ) : null}
                {entry.project.updatedAt ? (
                  <div>
                    <dt>Updated</dt>
                    <dd>
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(entry.project.updatedAt)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <footer>
                <Link href={`/projects/${entry.project._id}`} className="secondary">
                  Open details
                </Link>
              </footer>
            </article>
          ))
        ) : (
          <div className="card placeholder">
            No projects yet. Start a new project to begin.
          </div>
        )}
      </section>
    </div>
  );
}
