import type { Metadata } from "next";
import { ProjectSummary } from "../../../components/projects/project-summary";

export const metadata: Metadata = {
  title: "Project summary",
  description: "Review project blueprint snapshots, history, and linked sessions."
};

export default async function ProjectSummaryPage({
  params
}: PageProps<"/projects/[projectId]">) {
  const resolvedParams = await params;
  return (
    <main className="container">
      <ProjectSummary projectId={resolvedParams.projectId} />
    </main>
  );
}
