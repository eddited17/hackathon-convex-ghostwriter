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
    itemId: v.optional(v.string()),
    role: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tags = new Set<string>();
    if (args.eventId) {
      tags.add(args.eventId);
    }
    if (args.itemId) {
      tags.add(args.itemId);
      const trimmed = args.itemId.trim();
      const hyphenIndex = trimmed.indexOf("-");
      if (hyphenIndex > 0 && hyphenIndex < trimmed.length - 1) {
        tags.add(trimmed.slice(hyphenIndex + 1));
      }
      if (!trimmed.startsWith("assistant-")) {
        tags.add(`assistant-${trimmed}`);
      }
      if (!trimmed.startsWith("user-")) {
        tags.add(`user-${trimmed}`);
      }
    }

    const messageId = await ctx.db.insert("messages", {
      sessionId: args.sessionId,
      speaker: args.speaker,
      transcript: args.transcript,
      timestamp: args.timestamp,
      tags: tags.size > 0 ? Array.from(tags) : undefined,
      role: args.role ?? args.speaker,
      text: args.text ?? args.transcript,
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
