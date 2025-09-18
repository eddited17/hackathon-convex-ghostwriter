// Example Convex functions (copy into a real module after running `npx convex codegen`).
//
// import { query, mutation } from "./_generated/server";
// import { v } from "convex/values";
//
// export const listNotes = query({
//   args: { projectId: v.id("projects") },
//   handler: async (ctx, args) => {
//     return ctx.db
//       .query("notes")
//       .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
//       .collect();
//   }
// });
//
// export const createNote = mutation({
//   args: {
//     projectId: v.id("projects"),
//     noteType: v.string(),
//     content: v.string()
//   },
//   handler: async (ctx, args) => {
//     return ctx.db.insert("notes", {
//       ...args,
//       createdAt: Date.now()
//     });
//   }
// });
