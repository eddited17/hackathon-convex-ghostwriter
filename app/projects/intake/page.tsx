import type { Metadata } from "next";
import { ProjectIntakeFlow } from "../../../components/intake/ProjectIntakeFlow";

export const metadata: Metadata = {
  title: "Project definition intake",
  description:
    "Guided onboarding that captures goals, audience, publishing plan, and voice guardrails before the first realtime session."
};

export default async function ProjectIntakePage({
  searchParams
}: PageProps<"/projects/intake">) {
  const resolvedSearchParams = await searchParams;
  const projectIdParam = resolvedSearchParams.projectId;
  const projectId = Array.isArray(projectIdParam)
    ? projectIdParam[0]
    : projectIdParam ?? undefined;

  return (
    <main className="container">
      <ProjectIntakeFlow projectId={projectId} />
    </main>
  );
}
