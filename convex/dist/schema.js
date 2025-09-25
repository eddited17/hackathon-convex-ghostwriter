"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("convex/server");
const values_1 = require("convex/values");
exports.default = (0, server_1.defineSchema)({
    users: (0, server_1.defineTable)({
        externalId: values_1.v.string(),
        email: values_1.v.optional(values_1.v.string()),
        displayName: values_1.v.optional(values_1.v.string()),
        voicePreferences: values_1.v.optional(values_1.v.any()),
        createdAt: values_1.v.number()
    }).index("by_external_id", ["externalId"]),
    projects: (0, server_1.defineTable)({
        ownerId: values_1.v.id("users"),
        title: values_1.v.string(),
        contentType: values_1.v.string(),
        goal: values_1.v.optional(values_1.v.string()),
        status: values_1.v.string(),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number()
    }).index("by_owner", ["ownerId"]),
    projectBlueprints: (0, server_1.defineTable)({
        projectId: values_1.v.id("projects"),
        desiredOutcome: values_1.v.string(),
        targetAudience: values_1.v.string(),
        publishingPlan: values_1.v.string(),
        timeline: values_1.v.string(),
        materialsInventory: values_1.v.string(),
        communicationPreferences: values_1.v.string(),
        availability: values_1.v.string(),
        budgetRange: values_1.v.optional(values_1.v.string()),
        voiceGuardrails: values_1.v.optional(values_1.v.object({
            tone: values_1.v.optional(values_1.v.string()),
            structure: values_1.v.optional(values_1.v.string()),
            content: values_1.v.optional(values_1.v.string())
        })),
        createdAt: values_1.v.number()
    }).index("by_project", ["projectId"]),
    sessions: (0, server_1.defineTable)({
        projectId: values_1.v.id("projects"),
        startedAt: values_1.v.number(),
        endedAt: values_1.v.optional(values_1.v.number()),
        realtimeSessionId: values_1.v.optional(values_1.v.string()),
        summary: values_1.v.optional(values_1.v.string()),
        status: values_1.v.string(),
        blueprintId: values_1.v.optional(values_1.v.id("projectBlueprints"))
    }).index("by_project", ["projectId"]),
    messages: (0, server_1.defineTable)({
        sessionId: values_1.v.id("sessions"),
        speaker: values_1.v.string(),
        transcript: values_1.v.string(),
        timestamp: values_1.v.number(),
        tags: values_1.v.optional(values_1.v.array(values_1.v.string()))
    }).index("by_session", ["sessionId"]),
    notes: (0, server_1.defineTable)({
        projectId: values_1.v.id("projects"),
        sessionId: values_1.v.optional(values_1.v.id("sessions")),
        noteType: values_1.v.union(values_1.v.literal("fact"), values_1.v.literal("story"), values_1.v.literal("style"), values_1.v.literal("voice"), values_1.v.literal("todo"), values_1.v.literal("summary")),
        content: values_1.v.string(),
        sourceMessageIds: values_1.v.optional(values_1.v.array(values_1.v.id("messages"))),
        confidence: values_1.v.optional(values_1.v.number()),
        resolved: values_1.v.optional(values_1.v.boolean()),
        createdAt: values_1.v.number()
    }).index("by_project", ["projectId"]).index("by_session", ["sessionId"]),
    documents: (0, server_1.defineTable)({
        projectId: values_1.v.id("projects"),
        latestDraftMarkdown: values_1.v.optional(values_1.v.string()),
        status: values_1.v.string(),
        lockedSections: values_1.v.optional(values_1.v.array(values_1.v.string())),
        updatedAt: values_1.v.number()
    }).index("by_project", ["projectId"]),
    documentSections: (0, server_1.defineTable)({
        documentId: values_1.v.id("documents"),
        heading: values_1.v.string(),
        order: values_1.v.number(),
        content: values_1.v.string(),
        version: values_1.v.number(),
        locked: values_1.v.boolean(),
        updatedAt: values_1.v.number()
    }).index("by_document", ["documentId", "order"]),
    todos: (0, server_1.defineTable)({
        projectId: values_1.v.id("projects"),
        label: values_1.v.string(),
        status: values_1.v.union(values_1.v.literal("open"), values_1.v.literal("in_review"), values_1.v.literal("resolved")),
        createdAt: values_1.v.number(),
        resolvedAt: values_1.v.optional(values_1.v.number())
    }).index("by_project", ["projectId"])
});
