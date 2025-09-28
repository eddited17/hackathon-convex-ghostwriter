import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

type SectionStatus = "drafting" | "needs_detail" | "complete";

type DocumentSectionInput = {
  heading: string;
  content: string;
  status?: SectionStatus;
  order?: number;
};

const SECTION_INPUT_VALIDATOR = v.object({
  heading: v.string(),
  content: v.string(),
  status: v.optional(
    v.union(
      v.literal("drafting"),
      v.literal("needs_detail"),
      v.literal("complete"),
    ),
  ),
  order: v.optional(v.number()),
});

export const getWorkspace = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!document) {
      return {
        document: null,
        sections: [],
        progress: {
          wordCount: 0,
          sectionStatuses: [],
        },
      };
    }

    const sections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    const sorted = [...sections].sort((a, b) => a.order - b.order);
    const wordCount = (document.latestDraftMarkdown ?? "")
      .split(/\s+/)
      .filter(Boolean).length;

    const sectionStatuses = sorted.map((section) => ({
      sectionId: section._id,
      heading: section.heading,
      status: section.status,
      order: section.order,
    }));

    return {
      document,
      sections: sorted,
      progress: {
        wordCount,
        sectionStatuses,
      },
    };
  },
});

const resolveDocumentStatus = (sections: DocumentSectionInput[]) => {
  if (sections.length === 0) return "drafting" as const;
  const statuses = sections.map((section) => section.status ?? "drafting");
  if (statuses.every((status) => status === "complete")) {
    return "complete" as const;
  }
  if (statuses.some((status) => status === "needs_detail")) {
    return "needs_detail" as const;
  }
  return "drafting" as const;
};

export const applyEdits = mutation({
  args: {
    projectId: v.id("projects"),
    markdown: v.string(),
    sections: v.optional(v.array(SECTION_INPUT_VALIDATOR)),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sections = args.sections ?? [];
    const normalizedSections: DocumentSectionInput[] = sections.map((section, index) => ({
      heading: section.heading.trim(),
      content: section.content,
      status: section.status ?? "drafting",
      order: typeof section.order === "number" ? section.order : index,
    }));

    const existingDocument = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    let document: Doc<"documents">;
    if (existingDocument) {
      document = existingDocument;
    } else {
      const documentId = await ctx.db.insert("documents", {
        projectId: args.projectId,
        latestDraftMarkdown: "",
        status: "drafting",
        lockedSections: [],
        updatedAt: now,
      });
      const created = await ctx.db.get(documentId);
      if (!created) {
        throw new Error("Failed to load document after creation");
      }
      document = created;
    }

    await ctx.db.patch(document._id, {
      latestDraftMarkdown: args.markdown,
      status: resolveDocumentStatus(normalizedSections),
      updatedAt: now,
    });

    const existingSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    const existingByHeading = new Map<string, Doc<"documentSections">>();
    for (const section of existingSections) {
      existingByHeading.set(section.heading.toLowerCase(), section);
    }

    const seenKeys = new Set<string>();

    for (const [index, section] of normalizedSections.entries()) {
      const key = section.heading.toLowerCase();
      seenKeys.add(key);
      const existing = existingByHeading.get(key);
      const orderValue = section.order ?? index;
      if (existing) {
        await ctx.db.patch(existing._id, {
          heading: section.heading,
          content: section.content,
          order: orderValue,
          status: section.status ?? "drafting",
          version: existing.version + 1,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("documentSections", {
          documentId: document._id,
          heading: section.heading,
          content: section.content,
          order: orderValue,
          status: section.status ?? "drafting",
          version: 1,
          locked: false,
          updatedAt: now,
        });
      }
    }

    for (const section of existingSections) {
      const key = section.heading.toLowerCase();
      if (!seenKeys.has(key)) {
        await ctx.db.delete(section._id);
      }
    }

    const updatedDocument = await ctx.db.get(document._id);
    if (!updatedDocument) {
      throw new Error("Document not found after update");
    }

    const updatedSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    const sorted = [...updatedSections].sort((a, b) => a.order - b.order);

    return {
      document: updatedDocument,
      sections: sorted,
    };
  },
});
