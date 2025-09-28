"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

import RealtimeSessionShell from "../../(session)/realtime-session/RealtimeSessionShell";
import { useRealtimeSessionContext } from "../../(session)/realtime-session/RealtimeSessionProvider";

export default function ProjectDetailView({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const session = useRealtimeSessionContext();

  const projectDetail = useQuery(api.projects.getProject, {
    projectId,
  });

  const projectTitle = projectDetail?.project?.title ?? "Project";

  const breadcrumbs = useMemo(
    () => (
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/projects">Projects</Link>
          </li>
          <li aria-current="page">{projectTitle}</li>
        </ol>
      </nav>
    ),
    [projectTitle],
  );

  const { status, sessionRecord, assignProjectToSession } = session;

  useEffect(() => {
    const activeProjectId = sessionRecord?.projectId ?? null;

    if ((status === "connected" || status === "connecting") && activeProjectId !== projectId) {
      void assignProjectToSession(projectId);
    }
  }, [assignProjectToSession, projectId, sessionRecord?.projectId, status]);

  return (
    <div className="project-detail-layout">
      <RealtimeSessionShell
        projectId={projectId}
        breadcrumbs={breadcrumbs}
        projectTitle={projectTitle}
      />
    </div>
  );
}
