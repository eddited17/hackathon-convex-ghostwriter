import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

const TODO_STATUS = v.union(
  v.literal("open"),
  v.literal("in_review"),
  v.literal("resolved"),
);

const STATUS_ORDER: Record<Doc<"todos">["status"], number> = {
  open: 0,
  in_review: 1,
  resolved: 2,
};

export const listForProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const todos = await ctx.db
      .query("todos")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    return todos.sort((a, b) => {
      const statusCompare = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusCompare !== 0) return statusCompare;
      return b.createdAt - a.createdAt;
    });
  },
});

export const updateStatus = mutation({
  args: {
    todoId: v.id("todos"),
    status: TODO_STATUS,
  },
  handler: async (ctx, args) => {
    const todo = await ctx.db.get(args.todoId);
    if (!todo) {
      throw new Error("Todo not found");
    }

    const now = Date.now();
    const resolvedAt = args.status === "resolved" ? now : undefined;

    await ctx.db.patch(args.todoId, {
      status: args.status,
      resolvedAt,
    });

    if (todo.noteId) {
      await ctx.db.patch(todo.noteId, {
        resolved: args.status === "resolved",
      });
    }

    const updated = await ctx.db.get(args.todoId);
    if (!updated) {
      throw new Error("Todo not found after status update");
    }

    return updated;
  },
});
