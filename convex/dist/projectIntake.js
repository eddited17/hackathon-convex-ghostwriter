"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProjectBlueprint = exports.createProjectWithBlueprint = exports.getProjectSummary = exports.listProjectSummaries = void 0;
const server_1 = require("convex/server");
const values_1 = require("convex/values");
const voiceGuardrailsValidator = values_1.v.object({
    tone: values_1.v.optional(values_1.v.string()),
    structure: values_1.v.optional(values_1.v.string()),
    content: values_1.v.optional(values_1.v.string())
});
const blueprintValidator = values_1.v.object({
    desiredOutcome: values_1.v.string(),
    targetAudience: values_1.v.string(),
    publishingPlan: values_1.v.string(),
    timeline: values_1.v.string(),
    materialsInventory: values_1.v.string(),
    communicationPreferences: values_1.v.string(),
    availability: values_1.v.string(),
    budgetRange: values_1.v.optional(values_1.v.string()),
    voiceGuardrails: values_1.v.optional(voiceGuardrailsValidator)
});
const projectInputValidator = values_1.v.object({
    title: values_1.v.string(),
    contentType: values_1.v.string(),
    goal: values_1.v.optional(values_1.v.string()),
    status: values_1.v.optional(values_1.v.string())
});
exports.listProjectSummaries = (0, server_1.queryGeneric)({
    args: {},
    handler: async (ctx) => {
        const projects = (await ctx.db
            .query("projects")
            .order("desc")
            .collect());
        const summaries = await Promise.all(projects.map(async (project) => {
            const latestBlueprint = await getLatestBlueprint(ctx, project._id);
            return {
                ...project,
                latestBlueprint
            };
        }));
        return summaries;
    }
});
exports.getProjectSummary = (0, server_1.queryGeneric)({
    args: { projectId: values_1.v.id("projects") },
    handler: async (ctx, { projectId }) => {
        const project = (await ctx.db.get(projectId));
        if (!project) {
            return null;
        }
        const blueprintHistory = (await ctx.db
            .query("projectBlueprints")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .order("desc")
            .collect());
        const latestBlueprint = blueprintHistory[0] ?? null;
        const sessions = (await ctx.db
            .query("sessions")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .order("desc")
            .collect());
        return {
            project,
            latestBlueprint,
            blueprintHistory,
            sessions
        };
    }
});
exports.createProjectWithBlueprint = (0, server_1.mutationGeneric)({
    args: {
        ownerExternalId: values_1.v.string(),
        ownerName: values_1.v.optional(values_1.v.string()),
        project: projectInputValidator,
        blueprint: blueprintValidator
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const owner = (await ctx.db
            .query("users")
            .withIndex("by_external_id", (q) => q.eq("externalId", args.ownerExternalId))
            .unique());
        const ownerId = owner
            ? owner._id
            : await ctx.db.insert("users", {
                externalId: args.ownerExternalId,
                displayName: args.ownerName,
                createdAt: now
            });
        const projectId = await ctx.db.insert("projects", {
            ownerId,
            title: args.project.title,
            contentType: args.project.contentType,
            goal: args.project.goal ?? args.blueprint.desiredOutcome,
            status: args.project.status ?? "planning",
            createdAt: now,
            updatedAt: now
        });
        const blueprintId = await ctx.db.insert("projectBlueprints", {
            ...args.blueprint,
            projectId,
            createdAt: now
        });
        const sessionId = await ctx.db.insert("sessions", {
            projectId,
            startedAt: now,
            status: "not_started",
            blueprintId,
            realtimeSessionId: undefined,
            endedAt: undefined,
            summary: undefined
        });
        return { projectId, blueprintId, sessionId };
    }
});
exports.updateProjectBlueprint = (0, server_1.mutationGeneric)({
    args: {
        projectId: values_1.v.id("projects"),
        project: projectInputValidator,
        blueprint: blueprintValidator
    },
    handler: async (ctx, args) => {
        const project = (await ctx.db.get(args.projectId));
        if (!project) {
            throw new Error("Project not found");
        }
        const now = Date.now();
        await ctx.db.patch(args.projectId, {
            title: args.project.title,
            contentType: args.project.contentType,
            goal: args.project.goal ?? project.goal,
            status: args.project.status ?? project.status,
            updatedAt: now
        });
        const blueprintId = await ctx.db.insert("projectBlueprints", {
            ...args.blueprint,
            projectId: args.projectId,
            createdAt: now
        });
        const sessions = (await ctx.db
            .query("sessions")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
            .collect());
        await Promise.all(sessions
            .filter((session) => session.status === "not_started" || session.status === "scheduled")
            .map((session) => ctx.db.patch(session._id, { blueprintId })));
        return { projectId: args.projectId, blueprintId };
    }
});
async function getLatestBlueprint(ctx, projectId) {
    const [latest] = (await ctx.db
        .query("projectBlueprints")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .take(1));
    return latest ?? null;
}
