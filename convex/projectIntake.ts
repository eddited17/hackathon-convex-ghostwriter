import {
  mutationGeneric as mutation,
  queryGeneric as query,
  type GenericMutationCtx,
  type GenericQueryCtx
} from "convex/server";
import { v } from "convex/values";
import type { GenericId } from "convex/values";

type Id<TableName extends string> = GenericId<TableName>;
type QueryCtx = GenericQueryCtx<any>;
type MutationCtx = GenericMutationCtx<any>;

type ProjectDocument = {
  _id: Id<"projects">;
  ownerId: Id<"users">;
  title: string;
  contentType: string;
  goal?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
};

type BlueprintDocument = {
  _id: Id<"projectBlueprints">;
  projectId: Id<"projects">;
  desiredOutcome: string;
  targetAudience: string;
  publishingPlan: string;
  timeline: string;
  materialsInventory: string;
  communicationPreferences: string;
  availability: string;
  budgetRange?: string;
  voiceGuardrails?: {
    tone?: string;
    structure?: string;
    content?: string;
  };
  createdAt: number;
};

type SessionDocument = {
  _id: Id<"sessions">;
  projectId: Id<"projects">;
  startedAt: number;
  endedAt?: number;
  realtimeSessionId?: string;
  summary?: string;
  status: string;
  blueprintId?: Id<"projectBlueprints">;
};

const voiceGuardrailsValidator = v.object({
  tone: v.optional(v.string()),
  structure: v.optional(v.string()),
  content: v.optional(v.string())
});

const blueprintValidator = v.object({
  desiredOutcome: v.string(),
  targetAudience: v.string(),
  publishingPlan: v.string(),
  timeline: v.string(),
  materialsInventory: v.string(),
  communicationPreferences: v.string(),
  availability: v.string(),
  budgetRange: v.optional(v.string()),
  voiceGuardrails: v.optional(voiceGuardrailsValidator)
});

const projectInputValidator = v.object({
  title: v.string(),
  contentType: v.string(),
  goal: v.optional(v.string()),
  status: v.optional(v.string())
});

type ProjectInputArgs = {
  title: string;
  contentType: string;
  goal?: string;
  status?: string;
};

type BlueprintInputArgs = {
  desiredOutcome: string;
  targetAudience: string;
  publishingPlan: string;
  timeline: string;
  materialsInventory: string;
  communicationPreferences: string;
  availability: string;
  budgetRange?: string;
  voiceGuardrails?: {
    tone?: string;
    structure?: string;
    content?: string;
  };
};

type CreateProjectArgs = {
  ownerExternalId: string;
  ownerName?: string;
  project: ProjectInputArgs;
  blueprint: BlueprintInputArgs;
};

type UpdateProjectArgs = {
  projectId: Id<"projects">;
  project: ProjectInputArgs;
  blueprint: BlueprintInputArgs;
};

export const listProjectSummaries = query({
  args: {},
  handler: async (ctx: QueryCtx) => {
    const projects = (await ctx.db
      .query("projects")
      .order("desc")
      .collect()) as ProjectDocument[];
    const summaries = await Promise.all(
      projects.map(async (project) => {
        const latestBlueprint = await getLatestBlueprint(ctx, project._id);
        return {
          ...project,
          latestBlueprint
        };
      })
    );

    return summaries;
  }
});

export const getProjectSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx: QueryCtx, { projectId }: { projectId: Id<"projects"> }) => {
    const project = (await ctx.db.get(projectId)) as ProjectDocument | null;
    if (!project) {
      return null;
    }

    const blueprintHistory = (await ctx.db
      .query("projectBlueprints")
      .withIndex("by_project", (q: any) => q.eq("projectId", projectId))
      .order("desc")
      .collect()) as BlueprintDocument[];

    const latestBlueprint = blueprintHistory[0] ?? null;

    const sessions = (await ctx.db
      .query("sessions")
      .withIndex("by_project", (q: any) => q.eq("projectId", projectId))
      .order("desc")
      .collect()) as SessionDocument[];

    return {
      project,
      latestBlueprint,
      blueprintHistory,
      sessions
    };
  }
});

export const createProjectWithBlueprint = mutation({
  args: {
    ownerExternalId: v.string(),
    ownerName: v.optional(v.string()),
    project: projectInputValidator,
    blueprint: blueprintValidator
  },
  handler: async (ctx: MutationCtx, args: CreateProjectArgs) => {
    const now = Date.now();
    const owner = (await ctx.db
      .query("users")
      .withIndex("by_external_id", (q: any) =>
        q.eq("externalId", args.ownerExternalId)
      )
      .unique()) as { _id: Id<"users"> } | null;

    const ownerId = owner
      ? owner._id
      : await ctx.db.insert("users", {
          externalId: args.ownerExternalId,
          displayName: args.ownerName,
          createdAt: now
        });

    const projectId = await ctx.db.insert("projects", {
      ownerId,
      title: args.project.title,
      contentType: args.project.contentType,
      goal: args.project.goal ?? args.blueprint.desiredOutcome,
      status: args.project.status ?? "planning",
      createdAt: now,
      updatedAt: now
    });

    const blueprintId = await ctx.db.insert("projectBlueprints", {
      ...args.blueprint,
      projectId,
      createdAt: now
    });

    const sessionId = await ctx.db.insert("sessions", {
      projectId,
      startedAt: now,
      status: "not_started",
      blueprintId,
      realtimeSessionId: undefined,
      endedAt: undefined,
      summary: undefined
    });

    return { projectId, blueprintId, sessionId };
  }
});

export const updateProjectBlueprint = mutation({
  args: {
    projectId: v.id("projects"),
    project: projectInputValidator,
    blueprint: blueprintValidator
  },
  handler: async (ctx: MutationCtx, args: UpdateProjectArgs) => {
    const project = (await ctx.db.get(args.projectId)) as ProjectDocument | null;
    if (!project) {
      throw new Error("Project not found");
    }

    const now = Date.now();

    await ctx.db.patch(args.projectId, {
      title: args.project.title,
      contentType: args.project.contentType,
      goal: args.project.goal ?? project.goal,
      status: args.project.status ?? project.status,
      updatedAt: now
    });

    const blueprintId = await ctx.db.insert("projectBlueprints", {
      ...args.blueprint,
      projectId: args.projectId,
      createdAt: now
    });

    const sessions = (await ctx.db
      .query("sessions")
      .withIndex("by_project", (q: any) => q.eq("projectId", args.projectId))
      .collect()) as SessionDocument[];

    await Promise.all(
      sessions
        .filter((session) =>
          session.status === "not_started" || session.status === "scheduled"
        )
        .map((session) => ctx.db.patch(session._id, { blueprintId }))
    );

    return { projectId: args.projectId, blueprintId };
  }
});

async function getLatestBlueprint(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const [latest] = (await ctx.db
    .query("projectBlueprints")
    .withIndex("by_project", (q: any) => q.eq("projectId", projectId))
    .order("desc")
    .take(1)) as BlueprintDocument[];
  return latest ?? null;
}
