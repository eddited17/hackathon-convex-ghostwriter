"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { useConvexAvailability } from "../../lib/convex-client-provider";
import {
  CONTENT_TYPE_LABELS,
  ProjectBlueprintSnapshot,
  ProjectSummaryRecord
} from "../../lib/types";
import { projectIntakeQueries } from "../../lib/convex";

export function ProjectListPanel() {
  const { isConfigured } = useConvexAvailability();

  if (!isConfigured) {
    return (
      <section className="card">
        <h2>Recent project blueprints</h2>
        <p className="muted">
          Configure <code>NEXT_PUBLIC_CONVEX_URL</code> to sync projects from your Convex
          deployment. Until then, drafts remain in local storage.
        </p>
      </section>
    );
  }

  return <ConnectedProjectListPanel />;
}

function ConnectedProjectListPanel() {
  const projects = useQuery(projectIntakeQueries.listProjectSummaries);

  if (projects === undefined) {
    return (
      <section className="card">
        <h2>Recent project blueprints</h2>
        <p className="muted">Loading projects…</p>
      </section>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <section className="card">
        <h2>Recent project blueprints</h2>
        <p className="muted">
          No projects yet. Start with the intake to capture your first blueprint.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Recent project blueprints</h2>
      <div className="grid-columns">
        {projects.map((project) => (
          <ProjectListCard key={project._id} project={project} />
        ))}
      </div>
    </section>
  );
}

function ProjectListCard({ project }: { project: ProjectSummaryRecord }) {
  const latestBlueprint = project.latestBlueprint;
  const blueprintHighlights = useMemo(() => mapBlueprintHighlights(latestBlueprint), [
    latestBlueprint
  ]);

  return (
    <article className="review-section">
      <header style={{ marginBottom: "0.75rem" }}>
        <h3 style={{ marginBottom: "0.35rem" }}>{project.title}</h3>
        <div className="status-pill">
          <span>{CONTENT_TYPE_LABELS[project.contentType]}</span>
          <span aria-hidden>•</span>
          <span className="muted">{project.status}</span>
        </div>
      </header>
      {latestBlueprint ? (
        <ul className="list-reset">
          {blueprintHighlights.map((item) => (
            <li key={item.label}>
              <strong>{item.label}:</strong> {item.value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Blueprint pending.</p>
      )}
      <div className="button-row" style={{ marginTop: "1rem" }}>
        <Link className="button secondary" href={`/projects/${project._id}`}>
          View summary
        </Link>
        <Link className="button ghost" href={`/projects/intake?projectId=${project._id}`}>
          Edit intake
        </Link>
      </div>
    </article>
  );
}

interface BlueprintHighlight {
  label: string;
  value: string;
}

function mapBlueprintHighlights(
  blueprint: ProjectBlueprintSnapshot | null | undefined
): BlueprintHighlight[] {
  if (!blueprint) {
    return [];
  }

  const highlights: BlueprintHighlight[] = [
    {
      label: "Desired outcome",
      value: blueprint.desiredOutcome
    },
    {
      label: "Target audience",
      value: blueprint.targetAudience
    },
    {
      label: "Timeline",
      value: blueprint.timeline
    },
    {
      label: "Materials",
      value: blueprint.materialsInventory
    },
    {
      label: "Availability",
      value: blueprint.availability
    }
  ];

  return highlights;
}
