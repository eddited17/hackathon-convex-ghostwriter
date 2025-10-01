import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

const NOTE_TYPE = v.union(
  v.literal("fact"),
  v.literal("story"),
  v.literal("style"),
  v.literal("voice"),
  v.literal("todo"),
  v.literal("summary"),
);

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const sorted = notes.sort((a, b) => b.createdAt - a.createdAt);
    if (typeof args.limit === "number" && args.limit > 0) {
      return sorted.slice(0, args.limit);
    }
    return sorted;
  },
});

export const createNote = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.optional(v.id("sessions")),
    noteType: NOTE_TYPE,
    content: v.string(),
    sourceMessageIds: v.optional(v.array(v.id("messages"))),
    confidence: v.optional(v.number()),
    resolved: v.optional(v.boolean()),
    todoStatus: v.optional(
      v.union(v.literal("open"), v.literal("in_review"), v.literal("resolved")),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      projectId: args.projectId,
      sessionId: args.sessionId,
      noteType: args.noteType,
      content: args.content,
      sourceMessageIds: args.sourceMessageIds,
      confidence: args.confidence,
      resolved:
        typeof args.resolved === "boolean"
          ? args.resolved
          : args.noteType === "todo"
            ? false
            : undefined,
      createdAt: now,
    });

    const note = await ctx.db.get(noteId);
    if (!note) {
      throw new Error("Failed to load note after insert");
    }

    let todo: Doc<"todos"> | null = null;
    if (note.noteType === "todo") {
      const status = args.todoStatus ?? "open";
      const todoId = await ctx.db.insert("todos", {
        projectId: args.projectId,
        label: note.content,
        status,
        createdAt: now,
        resolvedAt: status === "resolved" ? now : undefined,
        noteId,
      });
      todo = await ctx.db.get(todoId);
    }

    return { note, todo };
  },
});

export const updateNoteResolution = mutation({
  args: {
    noteId: v.id("notes"),
    resolved: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, {
      resolved: args.resolved,
    });
    const updated = await ctx.db.get(args.noteId);
    if (!updated) {
      throw new Error("Note not found after resolution update");
    }
    return updated;
  },
});
