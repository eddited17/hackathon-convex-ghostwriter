import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

import {
  ensureLocalUser,
  ensureProjectBlueprint,
  ensureSandboxProject,
  loadLocalUser,
} from "./utils";

const BLUEPRINT_FIELDS = [
  "desiredOutcome",
  "targetAudience",
  "publishingPlan",
  "timeline",
  "materialsInventory",
  "communicationPreferences",
  "budgetRange",
] as const;

type BlueprintField = (typeof BLUEPRINT_FIELDS)[number];

const VOICE_GUARDRAILS = v.object({
  tone: v.optional(v.string()),
  structure: v.optional(v.string()),
  content: v.optional(v.string()),
});

type BlueprintResponse = {
  project: Doc<"projects">;
  blueprint: Doc<"projectBlueprints"> | null;
};

const sortProjects = (projects: Doc<"projects">[]) => {
  return [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
};

async function loadBlueprintForProject(
  ctx: { db: MutationCtx["db"] | QueryCtx["db"] },
  projectId: Id<"projects">,
) {
  return ctx.db
    .query("projectBlueprints")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
}

export const listProjects = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<BlueprintResponse[]> => {
    const user = await loadLocalUser(ctx);
    if (!user) return [];

    const collected = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();

    const sorted = sortProjects(collected);
    const limit = args.limit ?? 20;
    const trimmed = sorted.slice(0, Math.max(limit, 0));

    const results: BlueprintResponse[] = [];
    for (const project of trimmed) {
      const blueprint = await loadBlueprintForProject(ctx, project._id);
      results.push({ project, blueprint: blueprint ?? null });
    }
    return results;
  },
});

export const getProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<BlueprintResponse | null> => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;

    const blueprint = await loadBlueprintForProject(ctx, project._id);
    return { project, blueprint: blueprint ?? null };
  },
});

export const bootstrapSandbox = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const user = await ensureLocalUser(ctx, now);
    const project = await ensureSandboxProject(ctx, user._id, now);

    return { userId: user._id, projectId: project._id };
  },
});

export const createProject = mutation({
  args: {
    title: v.string(),
    contentType: v.string(),
    goal: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BlueprintResponse> => {
    const now = Date.now();
    const user = await ensureLocalUser(ctx, now);

    const projectId = await ctx.db.insert("projects", {
      ownerId: user._id,
      title: args.title,
      contentType: args.contentType,
      goal: args.goal,
      status: "intake",
      createdAt: now,
      updatedAt: now,
    });

    const project = await ctx.db.get(projectId);
    if (!project) {
      throw new Error("Failed to load project after insert");
    }

    const blueprint = await ensureProjectBlueprint(ctx, projectId, now, {
      status: "draft",
    });

    return { project, blueprint };
  },
});

export const updateProjectMetadata = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    contentType: v.optional(v.string()),
    goal: v.optional(v.string()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("archived"),
        v.literal("intake"),
      ),
    ),
  },
  handler: async (ctx, args): Promise<Doc<"projects">> => {
    const now = Date.now();
    const updates: Partial<Doc<"projects">> = { updatedAt: now };

    if (typeof args.title === "string") updates.title = args.title;
    if (typeof args.contentType === "string")
      updates.contentType = args.contentType;
    if (typeof args.goal !== "undefined") updates.goal = args.goal;
    if (args.status) updates.status = args.status;

    await ctx.db.patch(args.projectId, updates);
    const updated = await ctx.db.get(args.projectId);
    if (!updated) {
      throw new Error("Project not found after update");
    }
    return updated;
  },
});

export const syncBlueprintField = mutation({
  args: {
    projectId: v.id("projects"),
    field: v.union(
      v.literal("desiredOutcome"),
      v.literal("targetAudience"),
      v.literal("publishingPlan"),
      v.literal("timeline"),
      v.literal("materialsInventory"),
      v.literal("communicationPreferences"),
      v.literal("budgetRange"),
      v.literal("voiceGuardrails"),
    ),
    value: v.union(v.string(), VOICE_GUARDRAILS, v.null()),
    sessionId: v.optional(v.id("sessions")),
    messageId: v.optional(v.id("messages")),
  },
  handler: async (ctx, args): Promise<Doc<"projectBlueprints">> => {
    const now = Date.now();
    const blueprint = await ensureProjectBlueprint(ctx, args.projectId, now);

    const patch: Partial<Doc<"projectBlueprints">> = {
      updatedAt: now,
      status: "draft",
    };

    if (args.field === "voiceGuardrails") {
      patch.voiceGuardrails =
        args.value && typeof args.value === "object" && !Array.isArray(args.value)
          ? (args.value as Doc<"projectBlueprints">["voiceGuardrails"])
          : undefined;
    } else if (BLUEPRINT_FIELDS.includes(args.field as BlueprintField)) {
      const incoming = typeof args.value === "string" ? args.value.trim() : null;
      patch[args.field as BlueprintField] = incoming ?? undefined;
    }

    if (args.sessionId) {
      patch.intakeSessionId = args.sessionId;
    }
    if (typeof args.messageId !== "undefined") {
      patch.intakeTranscriptMessageId = args.messageId;
    }

    await ctx.db.patch(blueprint._id, patch);

    const updated = await ctx.db.get(blueprint._id);
    if (!updated) {
      throw new Error("Blueprint not found after update");
    }

    const project = await ctx.db.get(args.projectId);
    if (project) {
      await ctx.db.patch(project._id, { updatedAt: now });
    }

    return updated;
  },
});

export const recordTranscriptPointer = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.id("sessions"),
    messageId: v.union(v.id("messages"), v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"projectBlueprints">> => {
    const now = Date.now();
    const blueprint = await ensureProjectBlueprint(ctx, args.projectId, now);

    const normalizedMessageId =
      typeof args.messageId === "string"
        ? ctx.db.normalizeId("messages", args.messageId)
        : args.messageId;

    if (!normalizedMessageId) {
      throw new Error("Unable to resolve messageId for transcript pointer");
    }

    await ctx.db.patch(blueprint._id, {
      intakeSessionId: args.sessionId,
      intakeTranscriptMessageId: normalizedMessageId,
      updatedAt: now,
    });

    const updated = await ctx.db.get(blueprint._id);
    if (!updated) {
      throw new Error("Blueprint not found after transcript pointer update");
    }
    return updated;
  },
});

export const commitBlueprint = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args): Promise<BlueprintResponse> => {
    const now = Date.now();
    const blueprint = await ensureProjectBlueprint(ctx, args.projectId, now);

    await ctx.db.patch(blueprint._id, {
      status: "committed",
      intakeSessionId: args.sessionId ?? blueprint.intakeSessionId,
      updatedAt: now,
    });

    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found during blueprint commit");
    }

    const updates: Partial<Doc<"projects">> = {
      status: "active",
      updatedAt: now,
    };

    if (!project.goal && blueprint.desiredOutcome) {
      updates.goal = blueprint.desiredOutcome;
    }

    await ctx.db.patch(project._id, updates);

    const refreshedProject = await ctx.db.get(args.projectId);
    const refreshedBlueprint = await ctx.db.get(blueprint._id);

    if (!refreshedProject || !refreshedBlueprint) {
      throw new Error("Failed to reload project blueprint after commit");
    }

    return { project: refreshedProject, blueprint: refreshedBlueprint };
  },
});
