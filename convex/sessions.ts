import { mutation } from "./_generated/server";
import { v } from "convex/values";

import {
  ensureLocalUser,
  ensureSandboxProject,
} from "./utils";

const NOISE_PROFILES = v.union(
  v.literal("default"),
  v.literal("near_field"),
  v.literal("far_field"),
);

const LANGUAGE_CODE = v.string();
const DEFAULT_LANGUAGE_CODE = "en-US";

export const createSession = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    noiseProfile: v.optional(NOISE_PROFILES),
    deferProject: v.optional(v.boolean()),
    language: v.optional(LANGUAGE_CODE),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const user = await ensureLocalUser(ctx, now);
    const shouldDefer = args.deferProject ?? false;

    let assignedProjectId = args.projectId ?? null;

    if (!assignedProjectId && !shouldDefer) {
      const project = await ensureSandboxProject(ctx, user._id, now);
      assignedProjectId = project._id;
    }

    const sessionId = await ctx.db.insert("sessions", {
      projectId: assignedProjectId ?? undefined,
      startedAt: now,
      endedAt: undefined,
      realtimeSessionId: undefined,
      summary: undefined,
      status: "active",
      inputAudioNoiseReduction: args.noiseProfile ?? "near_field",
      language: args.language ?? DEFAULT_LANGUAGE_CODE,
      updatedAt: now,
    });

    return {
      sessionId,
      projectId: assignedProjectId,
      startedAt: now,
      language: args.language ?? DEFAULT_LANGUAGE_CODE,
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

export const assignProjectContext = mutation({
  args: {
    sessionId: v.id("sessions"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      projectId: args.projectId,
      updatedAt: Date.now(),
    });
  },
});

export const setLanguagePreference = mutation({
  args: {
    sessionId: v.id("sessions"),
    language: LANGUAGE_CODE,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      language: args.language,
      updatedAt: Date.now(),
    });
  },
});
