"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listForSession = exports.appendMessage = void 0;
const server_1 = require("./_generated/server");
const values_1 = require("convex/values");
exports.appendMessage = (0, server_1.mutation)({
    args: {
        sessionId: values_1.v.id("sessions"),
        speaker: values_1.v.union(values_1.v.literal("user"), values_1.v.literal("assistant")),
        transcript: values_1.v.string(),
        timestamp: values_1.v.number(),
        eventId: values_1.v.optional(values_1.v.string()),
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
exports.listForSession = (0, server_1.query)({
    args: {
        sessionId: values_1.v.id("sessions"),
    },
    handler: async (ctx, args) => {
        const messages = await ctx.db
            .query("messages")
            .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
            .collect();
        const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
        return sorted;
    },
});
