import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

export const appendMessage = mutation({
  args: {
    sessionId: v.id("sessions"),
    speaker: v.union(v.literal("user"), v.literal("assistant")),
    transcript: v.string(),
    timestamp: v.number(),
    eventId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      speaker: args.speaker,
      transcript: args.transcript,
      timestamp: args.timestamp,
      tags: args.eventId ? [args.eventId] : undefined,
    });
    return { messageId };
  },
});

export const listForSession = query({
  args: {
    sessionId: v.id("sessions"),
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const sorted = [...messages].sort(
      (a: Doc<"messages">, b: Doc<"messages">) => a.timestamp - b.timestamp,
    );
    return sorted;
  },
});
