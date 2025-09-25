"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { useConvexAvailability } from "../../lib/convex-client-provider";
import { CONTENT_TYPE_LABELS, ProjectBlueprintSnapshot } from "../../lib/types";
import { projectIntakeQueries } from "../../lib/convex";

export function ProjectSummary({ projectId }: { projectId: string }) {
  const { isConfigured } = useConvexAvailability();

  if (!isConfigured) {
    return (
      <section className="card">
        <h2>Project summary</h2>
        <p className="muted">
          Configure <code>NEXT_PUBLIC_CONVEX_URL</code> to load saved project blueprints and
          session history.
        </p>
      </section>
    );
  }

  return <ConfiguredProjectSummary projectId={projectId} />;
}

function ConfiguredProjectSummary({
  projectId
}: {
  projectId: string;
}) {
  const project = useQuery(projectIntakeQueries.getProjectSummary, { projectId });

  if (project === undefined) {
    return (
      <section className="card">
        <h2>Project summary</h2>
        <p className="muted">Loading project…</p>
      </section>
    );
  }

  if (!project) {
    return (
      <section className="card">
        <h2>Project not found</h2>
        <p className="muted">No project matches this identifier.</p>
        <div className="button-row">
          <Link className="button secondary" href="/">
            Back home
          </Link>
        </div>
      </section>
    );
  }

  const { latestBlueprint } = project;

  return (
    <div className="page-grid">
      <section className="card">
        <header style={{ marginBottom: "1rem" }}>
          <h1 style={{ margin: 0 }}>{project.project.title}</h1>
          <p className="muted" style={{ marginTop: "0.5rem" }}>
            {CONTENT_TYPE_LABELS[project.project.contentType]} • Updated {formatTimestamp(project.project.updatedAt)}
          </p>
        </header>
        {project.project.goal && (
          <p style={{ marginTop: "0.5rem" }}>{project.project.goal}</p>
        )}
        <div className="button-row" style={{ marginTop: "1.5rem" }}>
          <Link className="button" href={`/projects/intake?projectId=${project.project._id}`}>
            Edit blueprint
          </Link>
          <Link className="button ghost" href="/">
            Home
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Blueprint snapshot</h2>
        {latestBlueprint ? (
          <BlueprintDetails blueprint={latestBlueprint} />
        ) : (
          <p className="muted">No blueprint captured yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Blueprint history</h2>
        {project.blueprintHistory.length === 0 ? (
          <p className="muted">History will appear after the first intake submission.</p>
        ) : (
          <ul className="list-reset">
            {project.blueprintHistory.map((entry) => (
              <li key={entry._id}>
                {formatTimestamp(entry.createdAt)} — {entry.desiredOutcome}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Sessions</h2>
        {project.sessions.length === 0 ? (
          <p className="muted">
            Sessions will be linked here. New sessions automatically receive the latest
            blueprint metadata.
          </p>
        ) : (
          <div className="session-list">
            {project.sessions.map((session) => (
              <div key={session._id} className="session-card">
                <p style={{ margin: "0 0 0.35rem" }}>
                  <strong>Status:</strong> {session.status}
                </p>
                <p className="muted" style={{ margin: 0 }}>
                  Started {formatTimestamp(session.startedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BlueprintDetails({ blueprint }: { blueprint: ProjectBlueprintSnapshot }) {
  return (
    <div className="grid-columns">
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Desired outcome</h3>
        <p>{blueprint.desiredOutcome}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Target audience</h3>
        <p>{blueprint.targetAudience}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Publishing plan</h3>
        <p>{blueprint.publishingPlan}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Timeline expectations</h3>
        <p>{blueprint.timeline}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Materials inventory</h3>
        <p>{blueprint.materialsInventory}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Communication preferences</h3>
        <p>{blueprint.communicationPreferences}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Availability</h3>
        <p>{blueprint.availability}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Budget guardrails</h3>
        <p>{blueprint.budgetRange || "Not provided"}</p>
      </div>
      <div className="review-section">
        <h3 style={{ marginTop: 0 }}>Voice guardrails</h3>
        <ul className="list-reset">
          <li>
            <strong>Tone:</strong> {blueprint.voiceGuardrails?.tone || "Not provided"}
          </li>
          <li>
            <strong>Structure:</strong> {blueprint.voiceGuardrails?.structure || "Not provided"}
          </li>
          <li>
            <strong>Content:</strong> {blueprint.voiceGuardrails?.content || "Not provided"}
          </li>
        </ul>
      </div>
    </div>
  );
}

function formatTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}
