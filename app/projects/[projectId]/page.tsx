import type { Id } from "@/convex/_generated/dataModel";

import ProjectDetailView from "./ProjectDetailView";

type RouteParams = {
  projectId: string;
};

export default async function ProjectDetailPage({
  params,
}: { params?: Promise<RouteParams> }) {
  const resolved = (await params) ?? null;
  if (!resolved?.projectId) {
    throw new Error("Missing projectId in route params");
  }
  return (
    <main className="page">
      <ProjectDetailView projectId={resolved.projectId as Id<"projects">} />
    </main>
  );
}
