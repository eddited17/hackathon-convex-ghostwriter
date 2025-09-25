import { makeFunctionReference } from "convex/server";
import type {
  CreateProjectWithBlueprintArgs,
  CreateProjectWithBlueprintResult,
  ProjectSummaryQueryResult,
  ProjectSummaryRecord,
  UpdateProjectBlueprintArgs,
  UpdateProjectBlueprintResult
} from "./types";

export const projectIntakeQueries = {
  listProjectSummaries: makeFunctionReference<
    "query",
    Record<string, never>,
    ProjectSummaryRecord[]
  >("projectIntake:listProjectSummaries"),
  getProjectSummary: makeFunctionReference<
    "query",
    { projectId: string },
    ProjectSummaryQueryResult | null
  >("projectIntake:getProjectSummary")
};

export const projectIntakeMutations = {
  createProjectWithBlueprint: makeFunctionReference<
    "mutation",
    CreateProjectWithBlueprintArgs,
    CreateProjectWithBlueprintResult
  >("projectIntake:createProjectWithBlueprint"),
  updateProjectBlueprint: makeFunctionReference<
    "mutation",
    UpdateProjectBlueprintArgs,
    UpdateProjectBlueprintResult
  >("projectIntake:updateProjectBlueprint")
};
