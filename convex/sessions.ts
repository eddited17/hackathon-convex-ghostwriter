import { mutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const NOISE_PROFILES = v.union(
  v.literal("default"),
  v.literal("near_field"),
  v.literal("far_field"),
);

const SANDBOX_EXTERNAL_ID = "local-dev";
const SANDBOX_PROJECT_TITLE = "Realtime Session Sandbox";

async function ensureLocalUser(
  ctx: MutationCtx,
  now: number,
): Promise<Doc<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", SANDBOX_EXTERNAL_ID))
    .unique();
  if (existing) return existing;

  const userId = await ctx.db.insert("users", {
    externalId: SANDBOX_EXTERNAL_ID,
    email: undefined,
    displayName: "Ghostwriter Sandbox",
    voicePreferences: undefined,
    createdAt: now,
  });
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("Failed to load sandbox user after insert");
  }
  return user;
}

async function ensureSandboxProject(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  now: number,
): Promise<Doc<"projects">> {
  const existingProjects = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();

  const sandbox = existingProjects.find(
    (project) => project.title === SANDBOX_PROJECT_TITLE,
  );
  if (sandbox) return sandbox;

  const projectId = await ctx.db.insert("projects", {
    ownerId,
    title: SANDBOX_PROJECT_TITLE,
    contentType: "sandbox",
    goal: "Local realtime session experiments",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error("Failed to load sandbox project after insert");
  }
  return project;
}

export const createSession = mutation({
  args: {
    noiseProfile: v.optional(NOISE_PROFILES),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const user = await ensureLocalUser(ctx, now);
    const project = await ensureSandboxProject(ctx, user._id, now);

    const sessionId = await ctx.db.insert("sessions", {
      projectId: project._id,
      startedAt: now,
      endedAt: undefined,
      realtimeSessionId: undefined,
      summary: undefined,
      status: "active",
      inputAudioNoiseReduction: args.noiseProfile ?? "near_field",
      updatedAt: now,
    });

    return {
      sessionId,
      projectId: project._id,
      startedAt: now,
    };
  },
});

export const updateRealtimeSessionId = mutation({
  args: {
    sessionId: v.id("sessions"),
    realtimeSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      realtimeSessionId: args.realtimeSessionId,
      updatedAt: Date.now(),
    });
  },
});

export const completeSession = mutation({
  args: {
    sessionId: v.id("sessions"),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    await ctx.db.patch(args.sessionId, {
      endedAt: Date.now(),
      status: "completed",
      summary: args.summary ?? session.summary,
      updatedAt: Date.now(),
    });
  },
});

export const setNoiseProfile = mutation({
  args: {
    sessionId: v.id("sessions"),
    noiseProfile: NOISE_PROFILES,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      inputAudioNoiseReduction: args.noiseProfile,
      updatedAt: Date.now(),
    });
  },
});
