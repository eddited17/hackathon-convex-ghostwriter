import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    externalId: v.string(),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    voicePreferences: v.optional(v.any()),
    createdAt: v.number()
  }).index("by_external_id", ["externalId"]),

  projects: defineTable({
    ownerId: v.id("users"),
    title: v.string(),
    contentType: v.string(),
    goal: v.optional(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("archived"),
      v.literal("intake")
    ),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_owner", ["ownerId"]),

  projectBlueprints: defineTable({
    projectId: v.id("projects"),
    desiredOutcome: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
    publishingPlan: v.optional(v.string()),
    timeline: v.optional(v.string()),
    materialsInventory: v.optional(v.string()),
    communicationPreferences: v.optional(v.string()),
    budgetRange: v.optional(v.string()),
    voiceGuardrails: v.optional(
      v.object({
        tone: v.optional(v.string()),
        structure: v.optional(v.string()),
        content: v.optional(v.string())
      })
    ),
    status: v.union(v.literal("draft"), v.literal("committed")),
    intakeSessionId: v.optional(v.id("sessions")),
    intakeTranscriptMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
    updatedAt: v.number()
  }).index("by_project", ["projectId"]),

  sessions: defineTable({
    projectId: v.optional(v.id("projects")),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    realtimeSessionId: v.optional(v.string()),
    summary: v.optional(v.string()),
    status: v.string(),
    inputAudioNoiseReduction: v.optional(
      v.union(
        v.literal("default"),
        v.literal("near_field"),
        v.literal("far_field")
      )
    ),
    language: v.optional(v.string()),
    updatedAt: v.optional(v.number())
  }).index("by_project", ["projectId"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    speaker: v.string(),
    transcript: v.string(),
    timestamp: v.number(),
    tags: v.optional(v.array(v.string()))
  }).index("by_session", ["sessionId"]),

  notes: defineTable({
    projectId: v.id("projects"),
    sessionId: v.optional(v.id("sessions")),
    noteType: v.union(
      v.literal("fact"),
      v.literal("story"),
      v.literal("style"),
      v.literal("voice"),
      v.literal("todo"),
      v.literal("summary")
    ),
    content: v.string(),
    sourceMessageIds: v.optional(v.array(v.id("messages"))),
    confidence: v.optional(v.number()),
    resolved: v.optional(v.boolean()),
    createdAt: v.number()
  }).index("by_project", ["projectId"]).index("by_session", ["sessionId"]),

  documents: defineTable({
    projectId: v.id("projects"),
    latestDraftMarkdown: v.optional(v.string()),
    summary: v.optional(v.string()),
    status: v.string(),
    lockedSections: v.optional(v.array(v.string())),
    updatedAt: v.number()
  }).index("by_project", ["projectId"]),

  documentSections: defineTable({
    documentId: v.id("documents"),
    heading: v.string(),
    order: v.number(),
    content: v.string(),
    version: v.number(),
    locked: v.boolean(),
    status: v.union(
      v.literal("drafting"),
      v.literal("needs_detail"),
      v.literal("complete"),
    ),
    updatedAt: v.number()
  }).index("by_document", ["documentId", "order"]),

  todos: defineTable({
    projectId: v.id("projects"),
    label: v.string(),
    status: v.union(v.literal("open"), v.literal("in_review"), v.literal("resolved")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    noteId: v.optional(v.id("notes"))
  }).index("by_project", ["projectId"])
});
