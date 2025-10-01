import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const SANDBOX_EXTERNAL_ID = "local-dev";
export const SANDBOX_PROJECT_TITLE = "Realtime Session Sandbox";

async function getUserByExternalId<Ctx extends MutationCtx | QueryCtx>(
  ctx: Ctx,
  externalId: string,
) {
  return ctx.db
    .query("users")
    .withIndex("by_external_id", (q) => q.eq("externalId", externalId))
    .unique();
}

export async function ensureLocalUser(
  ctx: MutationCtx,
  now: number,
): Promise<Doc<"users">> {
  const existing = await getUserByExternalId(ctx, SANDBOX_EXTERNAL_ID);
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

export async function loadLocalUser(
  ctx: MutationCtx | QueryCtx,
): Promise<Doc<"users"> | null> {
  const user = await getUserByExternalId(ctx, SANDBOX_EXTERNAL_ID);
  return user ?? null;
}

export async function ensureProjectBlueprint(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  now: number,
  defaults?: Partial<Doc<"projectBlueprints">>,
): Promise<Doc<"projectBlueprints">> {
  const existing = await ctx.db
    .query("projectBlueprints")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .unique();
  if (existing) return existing;

  const blueprintId = await ctx.db.insert("projectBlueprints", {
    projectId,
    desiredOutcome: defaults?.desiredOutcome,
    targetAudience: defaults?.targetAudience,
    materialsInventory: defaults?.materialsInventory,
    communicationPreferences: defaults?.communicationPreferences,
    voiceGuardrails: defaults?.voiceGuardrails,
    status: defaults?.status ?? "draft",
    intakeSessionId: defaults?.intakeSessionId,
    intakeTranscriptMessageId: defaults?.intakeTranscriptMessageId,
    createdAt: now,
    updatedAt: now,
  });

  const blueprint = await ctx.db.get(blueprintId);
  if (!blueprint) {
    throw new Error("Failed to load blueprint after insert");
  }
  return blueprint;
}

export async function ensureSandboxProject(
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
  if (sandbox) {
    await ensureProjectBlueprint(ctx, sandbox._id, now);
    return sandbox;
  }

  const projectId = await ctx.db.insert("projects", {
    ownerId,
    title: SANDBOX_PROJECT_TITLE,
    contentType: "sandbox",
    goal: "Local realtime session experiments",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await ensureProjectBlueprint(ctx, projectId, now, {
    desiredOutcome: "Explore realtime audio integration and diagnostics",
    targetAudience: "Developers running the local sandbox",
    materialsInventory: "Sample prompts and transcripts",
    communicationPreferences: "Voice-first, optionally text overrides",
    voiceGuardrails: {
      tone: "Friendly and technical",
      structure: "Step-by-step guidance",
      content: "Focus on debugging and configuration",
    },
    status: "committed",
  });

  const project = await ctx.db.get(projectId);
  if (!project) {
    throw new Error("Failed to load sandbox project after insert");
  }
  return project;
}
