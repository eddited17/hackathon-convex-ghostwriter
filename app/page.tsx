import Link from "next/link";
import { Suspense } from "react";
import { ProjectListPanel } from "../components/projects/project-list";

export default function HomePage() {
  return (
    <main className="container page-grid">
      <section className="card">
        <h1>AI Ghostwriter Realtime Assistant</h1>
        <p>
          Kick off a project with a structured definition interview before the first
          realtime session. Capture your goals, audience, publishing expectations, and
          voice guardrails so downstream drafting feels intentional.
        </p>
        <p>
          The intake flow mirrors the blueprint requirements in the PRD and stores data
          in Convex for later sessions. You can save a draft locally, review the
          summary, and edit without losing context.
        </p>
        <div className="button-row">
          <Link href="/projects/intake" className="button">
            Start project intake
          </Link>
          <a
            className="button ghost"
            href="/docs/prd/ai-ghostwriter-prd.md"
            target="_blank"
            rel="noreferrer"
          >
            Review the PRD
          </a>
        </div>
      </section>

      <Suspense
        fallback={
          <section className="card">
            <h2>Recent project blueprints</h2>
            <p className="muted">Loading projects…</p>
          </section>
        }
      >
        <ProjectListPanel />
      </Suspense>
    </main>
  );
}
