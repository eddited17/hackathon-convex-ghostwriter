import { action, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

import {
  ensureLocalUser,
  ensureProjectBlueprint,
  ensureSandboxProject,
  loadLocalUser,
} from "./utils";
import { api } from "./_generated/api";

const BLUEPRINT_FIELDS = [
  "desiredOutcome",
  "targetAudience",
  "materialsInventory",
  "communicationPreferences",
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

type TranscriptItem = {
  id: string;
  type?: string;
  role?: string;
  status?: string;
  previousItemId?: string;
  createdAt: number;
  messageId?: Id<"messages">;
  messageKey?: string;
  text?: string;
  payload?: unknown;
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

async function loadTranscriptRecord(
  ctx: { db: MutationCtx["db"] | QueryCtx["db"] },
  projectId: Id<"projects">,
  sessionId: Id<"sessions">,
) {
  return ctx.db
    .query("projectTranscripts")
    .withIndex("by_project_session", (q) =>
      q.eq("projectId", projectId).eq("sessionId", sessionId),
    )
    .unique();
}

const mergeTranscriptItem = (
  existing: TranscriptItem | undefined,
  incoming: TranscriptItem,
): TranscriptItem => {
  if (!existing) return incoming;
  const createdAt =
    typeof existing.createdAt === "number"
      ? Math.min(existing.createdAt, incoming.createdAt)
      : incoming.createdAt;
  return {
    ...existing,
    ...incoming,
    createdAt,
    messageId: incoming.messageId ?? existing.messageId,
    messageKey: incoming.messageKey ?? existing.messageKey ?? existing.id,
    text: incoming.text ?? existing.text,
    payload:
      typeof incoming.payload !== "undefined"
        ? incoming.payload
        : existing.payload,
  };
};

const extractTranscriptText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractTranscriptText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.join(" ") || null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.transcript === "string") return record.transcript;
    if (typeof record.value === "string") return record.value;
    if ("content" in record) {
      return extractTranscriptText(record.content);
    }
  }
  return null;
};

const sanitizeTranscriptPayload = (value: unknown): unknown => {
  if (
    value === null ||
    typeof value === "undefined" ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeTranscriptPayload(entry))
      .filter((entry) => typeof entry !== "undefined");
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const typed = new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    );
    return Array.from(typed);
  }
  if (value instanceof ArrayBuffer) {
    return undefined;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(record)) {
      const normalized = sanitizeTranscriptPayload(inner);
      if (typeof normalized !== "undefined") {
        sanitized[key] = normalized;
      }
    }
    return sanitized;
  }
  return undefined;
};

const orderTranscriptItems = (items: TranscriptItem[]): TranscriptItem[] => {
  if (items.length <= 1) return [...items];

  const byId = new Map<string, TranscriptItem>();
  const nextByPrevious = new Map<string, TranscriptItem>();

  for (const item of items) {
    byId.set(item.id, item);
    if (item.previousItemId) {
      nextByPrevious.set(item.previousItemId, item);
    }
  }

  const visited = new Set<string>();
  const ordered: TranscriptItem[] = [];

  const pushChain = (start: TranscriptItem | undefined) => {
    let current = start;
    while (current && !visited.has(current.id)) {
      ordered.push(current);
      visited.add(current.id);
      current = nextByPrevious.get(current.id);
    }
  };

  const startingNode = items.find(
    (item) => !item.previousItemId || !byId.has(item.previousItemId),
  );

  if (startingNode) {
    pushChain(startingNode);
  }

  for (const item of items) {
    if (!visited.has(item.id)) {
      pushChain(item);
    }
  }

  if (ordered.length === items.length) {
    return ordered;
  }

  const fallback = [...ordered];
  for (const item of items) {
    if (!visited.has(item.id)) {
      fallback.push(item);
    }
  }
  return fallback;
};

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
      v.literal("materialsInventory"),
      v.literal("communicationPreferences"),
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
    itemId: v.optional(v.string()),
    messageId: v.optional(v.union(v.id("messages"), v.string())),
  },
  handler: async (ctx, args): Promise<Doc<"projectBlueprints">> => {
    const now = Date.now();
    const blueprint = await ensureProjectBlueprint(ctx, args.projectId, now);

    const normalizeMessageId = (value: unknown) => {
      if (typeof value === "string") {
        return ctx.db.normalizeId("messages", value) ?? null;
      }
      return value ?? null;
    };

    let resolvedMessageId = normalizeMessageId(args.messageId);

    const pointer = args.itemId?.trim();
    if (!resolvedMessageId && pointer) {
      const transcriptRecord = await loadTranscriptRecord(
        ctx,
        args.projectId,
        args.sessionId,
      );
      const candidates = new Set<string>([pointer]);
      if (transcriptRecord) {
        const match = transcriptRecord.items.find(
          (item) => item.id === pointer || item.messageKey === pointer,
        );
        if (match?.messageId) {
          resolvedMessageId = match.messageId;
        }
        if (match?.messageKey) {
          candidates.add(match.messageKey);
        }
      }

      if (!resolvedMessageId) {
        for (const candidate of candidates) {
          const normalized = ctx.db.normalizeId("messages", candidate);
          if (normalized) {
            resolvedMessageId = normalized;
            break;
          }
        }
      }

      if (!resolvedMessageId) {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
          .collect();

        for (const message of messages) {
          if (message.tags?.some((tag) => candidates.has(tag))) {
            resolvedMessageId = message._id;
            break;
          }
        }
      }
    }

    // Only update the blueprint anchor if we successfully resolved a message ID
    // This prevents errors when the AI calls record_transcript_pointer with
    // transcript IDs that haven't been persisted to messages yet
    if (resolvedMessageId) {
      const messageId = resolvedMessageId as Id<"messages">;

      await ctx.db.patch(blueprint._id, {
        intakeSessionId: args.sessionId,
        intakeTranscriptMessageId: messageId,
        updatedAt: now,
      });
    } else {
      // Normal case: transcript ID hasn't been persisted yet (async)
      // Still update the session association; pointer will be linkable later
      await ctx.db.patch(blueprint._id, {
        intakeSessionId: args.sessionId,
        updatedAt: now,
      });
      // Note: Client-side tool handler logs this if needed
    }

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

export const saveTranscriptChunk = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.id("sessions"),
    item: v.object({
      id: v.string(),
      type: v.optional(v.string()),
      role: v.optional(v.string()),
      status: v.optional(v.string()),
      previousItemId: v.optional(v.string()),
      createdAt: v.optional(v.number()),
      messageId: v.optional(v.id("messages")),
      messageKey: v.optional(v.string()),
      payload: v.optional(v.any()),
      text: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await loadTranscriptRecord(
      ctx,
      args.projectId,
      args.sessionId,
    );

    const payloadText = extractTranscriptText(args.item.payload);
    const directText = extractTranscriptText(args.item);
    const incomingText = payloadText ?? directText ?? null;
    const sanitizedPayload = sanitizeTranscriptPayload(args.item.payload);

    const incoming: TranscriptItem = {
      id: args.item.id,
      type: args.item.type ?? undefined,
      role: args.item.role ?? undefined,
      status: args.item.status ?? undefined,
      previousItemId: args.item.previousItemId ?? undefined,
      createdAt: args.item.createdAt ?? now,
      messageId: args.item.messageId ?? undefined,
      messageKey: args.item.messageKey ?? undefined,
      text:
        typeof args.item.text === "string" && args.item.text.trim()
          ? args.item.text.trim()
          : incomingText ?? undefined,
      payload: sanitizedPayload,
    };

    if (!existing) {
      const transcriptId = await ctx.db.insert("projectTranscripts", {
        projectId: args.projectId,
        sessionId: args.sessionId,
        items: orderTranscriptItems([incoming]),
        updatedAt: now,
        finalizedAt: undefined,
      });
      const inserted = await ctx.db.get(transcriptId);
      return inserted ?? null;
    }

    const mergedItems = Array.isArray(existing.items)
      ? [...(existing.items as TranscriptItem[])]
      : ([] as TranscriptItem[]);
    const index = mergedItems.findIndex((item) => item.id === incoming.id);
    if (index >= 0) {
      mergedItems[index] = mergeTranscriptItem(
        mergedItems[index] as TranscriptItem,
        incoming,
      );
    } else {
      mergedItems.push(incoming);
    }

    const ordered = orderTranscriptItems(
      mergedItems as TranscriptItem[],
    ) as TranscriptItem[];

    await ctx.db.patch(existing._id, {
      items: ordered,
      updatedAt: now,
    });

    return { ...existing, items: ordered, updatedAt: now };
  },
});

export const finalizeTranscript = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await loadTranscriptRecord(
      ctx,
      args.projectId,
      args.sessionId,
    );

    if (!existing) {
      const transcriptId = await ctx.db.insert("projectTranscripts", {
        projectId: args.projectId,
        sessionId: args.sessionId,
        items: [],
        updatedAt: now,
        finalizedAt: now,
      });
      return ctx.db.get(transcriptId);
    }

    const ordered = orderTranscriptItems(existing.items as TranscriptItem[]);
    await ctx.db.patch(existing._id, {
      items: ordered,
      updatedAt: now,
      finalizedAt: now,
    });

    return { ...existing, items: ordered, updatedAt: now, finalizedAt: now };
  },
});

export const getTranscriptForProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("projectTranscripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    if (records.length === 0) {
      return [] as const;
    }

    const sorted = [...records].sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted.map((record) => ({
      ...record,
      items: orderTranscriptItems(record.items as TranscriptItem[]),
    }));
  },
});

export const verifyTranscriptIntegrity = action({
  args: {
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const projectsToCheck: Doc<"projects">[] = [];

    if (args.projectId) {
      const single = await ctx.runQuery(api.projects.getProject, {
        projectId: args.projectId,
      });
      if (single?.project) {
        projectsToCheck.push(single.project);
      }
    } else {
      const limit = Math.max(1, args.limit ?? 25);
      const listed = await ctx.runQuery(api.projects.listProjects, {
        limit,
      });
      for (const entry of listed) {
        projectsToCheck.push(entry.project);
      }
    }

    const anomalies: Array<{
      projectId: Id<"projects">;
      sessionId: Id<"sessions">;
      issues: string[];
    }> = [];
    let checkedRecords = 0;

    for (const project of projectsToCheck) {
      const transcripts = await ctx.runQuery(
        api.projects.getTranscriptForProject,
        { projectId: project._id },
      );

      for (const record of transcripts) {
        checkedRecords += 1;
        const issues: string[] = [];
        const items = Array.isArray(record.items)
          ? (record.items as TranscriptItem[])
          : [];
        const seenIds = new Set<string>();
        const idToItem = new Map<string, TranscriptItem>();
        let lastTimestamp = -Infinity;

        for (const item of items as TranscriptItem[]) {
          const id = typeof item.id === "string" && item.id.trim() ? item.id : "";
          if (!id) {
            issues.push("missing item id");
            continue;
          }
          if (seenIds.has(id)) {
            issues.push(`duplicate item id ${id}`);
          }
          seenIds.add(id);
          idToItem.set(id, item);

          if (typeof item.createdAt === "number") {
            if (item.createdAt < lastTimestamp) {
              issues.push(`createdAt regression at ${id}`);
            }
            lastTimestamp = item.createdAt;
          }
        }

        for (const item of items as TranscriptItem[]) {
          if (
            item.previousItemId &&
            !seenIds.has(item.previousItemId) &&
            !idToItem.has(item.previousItemId)
          ) {
            issues.push(
              `missing previousItemId ${item.previousItemId} referenced by ${item.id}`,
            );
          }
        }

        if (issues.length > 0) {
          anomalies.push({
            projectId: project._id,
            sessionId: record.sessionId,
            issues,
          });
        }
      }
    }

    if (anomalies.length > 0) {
      console.warn("[transcripts] integrity anomalies detected", anomalies);
    } else {
      console.log("[transcripts] integrity check passed", {
        checkedRecords,
      });
    }

    return { checked: checkedRecords, anomalies } as const;
  },
});
