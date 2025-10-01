import { createHash } from "node:crypto";

import { action, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { api } from "./_generated/api";
import {
  buildDraftingPrompt,
  type DraftingPromptTranscriptItem,
} from "./lib/ghostwriting";
import {
  publishDraftJobMetrics,
  sendDraftingAlert,
} from "./lib/telemetry";

type SectionStatus = "drafting" | "needs_detail" | "complete";

type DocumentSectionInput = {
  heading: string;
  content: string;
  status?: SectionStatus;
  order?: number;
};

type DraftingModelSection = {
  heading: string;
  content: string;
  status?: SectionStatus;
  order?: number;
};

type DraftingModelResponse = {
  markdown: string;
  sections: DraftingModelSection[];
  summary?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

type DraftQueueProcessResult = {
  processed: boolean;
  reason?: string;
  jobId?: Id<"draftJobs">;
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

const MODEL_USAGE_VALIDATOR = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
});

const SECTION_PROGRESS_VALIDATOR = v.object({
  heading: v.string(),
  status: v.optional(v.string()),
  order: v.optional(v.number()),
});

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeSummary = (value: string | null | undefined) =>
  value && value.trim() ? value.trim().toLowerCase() : null;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const OPENAI_RESPONSES_ENDPOINT =
  process.env.OPENAI_RESPONSES_ENDPOINT ??
  "https://api.openai.com/v1/responses";
const DEFAULT_DRAFTING_MODEL =
  process.env.OPENAI_DRAFTING_MODEL ?? "gpt-5-nano";
const OPENAI_REALTIME_ENDPOINT =
  process.env.OPENAI_REALTIME_ENDPOINT ??
  "https://api.openai.com/v1/realtime/sessions";
const DEFAULT_SUMMARY_MODEL =
  process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5-nano";

const supportsReasoningControls = (model: string | undefined) =>
  typeof model === "string" && /^gpt-5(\b|[.\-]|$)/.test(model);

const safeJsonParse = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn("Failed to parse JSON response", error, value);
    return null;
  }
};

const coerceModelSection = (
  section: unknown,
  index: number,
): DraftingModelSection => {
  if (!section || typeof section !== "object") {
    return {
      heading: `Section ${index + 1}`,
      content: "",
      status: "drafting",
      order: index,
    };
  }

  const record = section as Record<string, unknown>;
  const heading = isNonEmptyString(record.heading)
    ? record.heading.trim()
    : `Section ${index + 1}`;
  const content = isNonEmptyString(record.content)
    ? record.content
    : "";
  const statusCandidate = isNonEmptyString(record.status)
    ? (record.status.trim() as SectionStatus)
    : "drafting";
  const status: SectionStatus = [
    "drafting",
    "needs_detail",
    "complete",
  ].includes(statusCandidate)
    ? statusCandidate
    : "drafting";
  const order =
    typeof record.order === "number" && Number.isFinite(record.order)
      ? record.order
      : index;

  return { heading, content, status, order };
};

const extractText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.join(" ") || null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.transcript === "string") return record.transcript;
    if ("content" in record) {
      return extractText(record.content);
    }
  }
  return null;
};

const extractDraftingPayload = (
  message: unknown,
): DraftingModelResponse | null => {
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const record = message as Record<string, unknown>;
    if (typeof record.markdown === "string") {
      const sectionsValue = Array.isArray(record.sections)
        ? record.sections.map((section, index) => coerceModelSection(section, index))
        : [];
      const summaryValue = isNonEmptyString(record.summary as string | undefined)
        ? (record.summary as string).trim()
        : undefined;
      return {
        markdown: (record.markdown as string).trim(),
        sections: sectionsValue,
        summary: summaryValue,
      };
    }
  }

  if (!message || typeof message !== "object") return null;
  const record = message as Record<string, unknown>;
  const content = record.content;

  const tryParse = (value: unknown): DraftingModelResponse | null => {
    if (typeof value !== "string") return null;
    const parsed = safeJsonParse<Record<string, unknown>>(value);
    if (!parsed) return null;
    if (!isNonEmptyString(parsed.markdown as string | undefined)) return null;
    const sectionsValue = Array.isArray(parsed.sections)
      ? parsed.sections.map((section, index) => coerceModelSection(section, index))
      : [];
    const summary = isNonEmptyString(parsed.summary as string | undefined)
      ? (parsed.summary as string).trim()
      : undefined;
    return {
      markdown: (parsed.markdown as string).trim(),
      sections: sectionsValue,
      summary,
    };
  };

  if (typeof content === "string") {
    return tryParse(content);
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === "string") {
        const parsed = tryParse(item);
        if (parsed) return parsed;
        continue;
      }
      if (item && typeof item === "object") {
        const part = item as Record<string, unknown>;
        if (typeof part.text === "string") {
          const parsed = tryParse(part.text);
          if (parsed) return parsed;
        }
        if (part.type === "json_schema" && part.data) {
          const dataRecord = part.data as Record<string, unknown>;
          if (isNonEmptyString(dataRecord.markdown as string | undefined)) {
            const sectionsValue = Array.isArray(dataRecord.sections)
              ? dataRecord.sections.map((section, index) =>
                  coerceModelSection(section, index),
                )
              : [];
            const summary = isNonEmptyString(
              dataRecord.summary as string | undefined,
            )
              ? (dataRecord.summary as string).trim()
              : undefined;
            return {
              markdown: (dataRecord.markdown as string).trim(),
              sections: sectionsValue,
              summary,
            };
          }
        }
      }
    }
  }

  return null;
};

type OpenAIResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
};

const normalizeResponseUsage = (usage: unknown) => {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined };
  }
  const record = usage as Record<string, unknown>;
  return {
    inputTokens: typeof record.input_tokens === "number" ? record.input_tokens : undefined,
    outputTokens: typeof record.output_tokens === "number" ? record.output_tokens : undefined,
    totalTokens: typeof record.total_tokens === "number" ? record.total_tokens : undefined,
  };
};

const extractResponseJson = (data: unknown): Record<string, unknown> | null => {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const outputs = (() => {
    const value = record.output ?? record.outputs;
    return Array.isArray(value) ? value : [];
  })();

  const tryParse = (value: unknown) => {
    if (!value) return null;
    if (typeof value === "object" && value !== null) {
      const vRecord = value as Record<string, unknown>;
      if (vRecord.json && typeof vRecord.json === "object") {
        return vRecord.json as Record<string, unknown>;
      }
      if (typeof vRecord.text === "string") {
        try {
          return JSON.parse(vRecord.text) as Record<string, unknown>;
        } catch (error) {
          return null;
        }
      }
      if (typeof vRecord.json_schema === "object" && vRecord.json_schema !== null) {
        const schemaRecord = vRecord.json_schema as Record<string, unknown>;
        if (schemaRecord.output && typeof schemaRecord.output === "object") {
          return schemaRecord.output as Record<string, unknown>;
        }
      }
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as Record<string, unknown>;
      } catch (error) {
        return null;
      }
    }
    return null;
  };

  for (const item of outputs) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const entry of content) {
        const parsed = tryParse(entry);
        if (parsed) return parsed;
      }
    }
    const parsed = tryParse(item);
    if (parsed) return parsed;
  }

  if (typeof record.output_text === "string") {
    try {
      return JSON.parse(record.output_text) as Record<string, unknown>;
    } catch (error) {
      return null;
    }
  }

  return null;
};

const extractResponseText = (data: unknown): string | null => {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const outputs = (() => {
    const value = record.output ?? record.outputs;
    return Array.isArray(value) ? value : [];
  })();

  for (const item of outputs) {
    if (!item || typeof item !== "object") continue;
    const content = (item as Record<string, unknown>).content;
    if (Array.isArray(content)) {
      for (const entry of content) {
        if (entry && typeof entry === "object") {
          const text = (entry as Record<string, unknown>).text;
          if (typeof text === "string" && text.trim()) {
            return text.trim();
          }
        }
        if (typeof entry === "string" && entry.trim()) {
          return entry.trim();
        }
      }
    }
  }

  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  return null;
};

export const callDraftingModel = action({
  args: {
    prompt: v.object({
      system: v.string(),
      user: v.string(),
    }),
    model: v.optional(v.string()),
    temperature: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!isNonEmptyString(apiKey)) {
      throw new Error("OPENAI_API_KEY not configured for drafting");
    }

    const model = isNonEmptyString(args.model)
      ? args.model.trim()
      : DEFAULT_DRAFTING_MODEL;
    const temperature =
      typeof args.temperature === "number" && Number.isFinite(args.temperature)
        ? args.temperature
        : undefined;

    const jsonSchemaResponseFormat = {
      type: "json_schema",
      name: "ghostwriting_draft",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["markdown", "sections", "summary"],
        properties: {
          markdown: { type: "string" },
          summary: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["heading", "content", "status", "order"],
              properties: {
                heading: { type: "string" },
                content: { type: "string" },
                status: {
                  anyOf: [
                    {
                      type: "string",
                      enum: ["drafting", "needs_detail", "complete"],
                    },
                    { type: "null" },
                  ],
                },
                order: {
                  anyOf: [{ type: "number" }, { type: "null" }],
                },
              },
            },
          },
        },
      },
    } as const;

    const baseBody: Record<string, unknown> = {
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: args.prompt.system }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: args.prompt.user }],
        },
      ],
      text: { format: jsonSchemaResponseFormat },
    };

    if (supportsReasoningControls(model)) {
      baseBody.reasoning = { effort: "minimal" };
    }

    if (typeof temperature === "number" && temperature !== 1) {
      baseBody.temperature = temperature;
    }

    const maxAttempts = 3;
    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < maxAttempts) {
      try {
        const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ ...baseBody, stream: false }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Drafting model request failed (${response.status}): ${errorText}`,
          );
        }

        const json = await response.json();
        const payloadRecord = extractResponseJson(json);
        if (!payloadRecord) {
          throw new Error("Drafting model returned an empty payload");
        }

        const payload = extractDraftingPayload(payloadRecord);
        if (!payload) {
          throw new Error("Drafting model payload missing required fields");
        }

        const usageRecord = normalizeResponseUsage(json?.usage);
        const result: DraftingModelResponse = {
          markdown: payload.markdown,
          sections: payload.sections,
          summary: payload.summary,
          usage: {
            inputTokens: usageRecord.inputTokens,
            outputTokens: usageRecord.outputTokens,
            totalTokens: usageRecord.totalTokens,
          },
        };
        return result;
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= maxAttempts) {
          if (error instanceof Error) {
            throw error;
          }
          throw new Error(String(error));
        }
        const delay = 500 * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Drafting model failed after retries");
  },
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
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sections = args.sections ?? [];
    const normalizedSections: DocumentSectionInput[] = sections.map((section, index) => {
      const heading = section.heading.trim();
      const content = section.content;
      const contentIsEmpty = content.trim().length === 0;
      const statusValue =
        section.status ?? (contentIsEmpty ? "needs_detail" : "drafting");
      return {
        heading,
        content,
        status: statusValue,
        order: typeof section.order === "number" ? section.order : index,
      };
    });

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
        summary: args.summary ?? undefined,
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
      summary: typeof args.summary === "string" ? args.summary : document.summary,
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

/**
 * Surgically merge a single section update back into the full document.
 * Preserves all other sections exactly as they were.
 * Section headings are immutable - we match by heading and only update content.
 */
export const applySectionEdit = mutation({
  args: {
    projectId: v.id("projects"),
    sectionHeading: v.string(),
    sectionMarkdown: v.string(),
    sectionStatus: v.optional(
      v.union(
        v.literal("drafting"),
        v.literal("needs_detail"),
        v.literal("complete"),
      ),
    ),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const targetHeading = args.sectionHeading.trim();

    const existingDocument = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!existingDocument) {
      throw new Error("Document not found for surgical section edit");
    }

    const existingSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", existingDocument._id))
      .collect();

    const sortedSections = [...existingSections].sort((a, b) => a.order - b.order);
    const targetSection = sortedSections.find(
      (s) => s.heading.toLowerCase() === targetHeading.toLowerCase(),
    );

    if (!targetSection) {
      throw new Error(
        `Section "${targetHeading}" not found. Use manage_outline to add new sections first.`,
      );
    }

    // Parse the existing full document to extract all sections
    const existingMarkdown = existingDocument.latestDraftMarkdown ?? "";
    const sectionPattern = /^(#{1,6}\s+.+)$/gm;
    const sections = existingMarkdown.split(sectionPattern).filter(Boolean);

    // Rebuild the full document with the updated section
    const updatedParts: string[] = [];
    let foundTarget = false;

    for (let i = 0; i < sections.length; i += 2) {
      const heading = sections[i];
      const content = sections[i + 1] ?? "";

      if (!heading) continue;

      // Check if this is the section we're updating
      const headingMatch = heading.match(/^#{1,6}\s+(.+)$/);
      const headingText = headingMatch?.[1]?.trim();

      if (
        headingText &&
        headingText.toLowerCase() === targetHeading.toLowerCase()
      ) {
        // Replace with updated section markdown
        updatedParts.push(args.sectionMarkdown.trim());
        foundTarget = true;
      } else {
        // Keep existing section unchanged
        updatedParts.push(`${heading}${content}`);
      }
    }

    // If target wasn't found in existing markdown, append it
    if (!foundTarget) {
      updatedParts.push(args.sectionMarkdown.trim());
    }

    const updatedMarkdown = updatedParts.join("\n\n").trim();

    // Update the document
    await ctx.db.patch(existingDocument._id, {
      latestDraftMarkdown: updatedMarkdown,
      summary: typeof args.summary === "string" ? args.summary : existingDocument.summary,
      updatedAt: now,
    });

    // Update only the target section metadata
    await ctx.db.patch(targetSection._id, {
      content: args.sectionMarkdown.trim(),
      status: args.sectionStatus ?? targetSection.status,
      version: targetSection.version + 1,
      updatedAt: now,
    });

    const refreshedDocument = await ctx.db.get(existingDocument._id);
    const refreshedSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", existingDocument._id))
      .collect();

    return {
      document: refreshedDocument,
      sections: [...refreshedSections].sort((a, b) => a.order - b.order),
    };
  },
});

export const setSummary = mutation({
  args: {
    projectId: v.id("projects"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const trimmed = args.summary.trim();

    let document = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!document) {
      const documentId = await ctx.db.insert("documents", {
        projectId: args.projectId,
        latestDraftMarkdown: "",
        summary: trimmed,
        status: "drafting",
        lockedSections: [],
        updatedAt: now,
      });
      document = await ctx.db.get(documentId);
    } else {
      await ctx.db.patch(document._id, {
        summary: trimmed,
        updatedAt: now,
      });
      document = await ctx.db.get(document._id);
    }

    if (!document) {
      throw new Error("Document not found after summary update");
    }

    return document;
  },
});

type OutlineOperation = {
  action: "add" | "rename" | "reorder" | "remove";
  heading: string;
  newHeading?: string;
  position?: number;
  status?: SectionStatus;
};

export const manageOutline = mutation({
  args: {
    projectId: v.id("projects"),
    operations: v.array(
      v.object({
        action: v.union(
          v.literal("add"),
          v.literal("rename"),
          v.literal("reorder"),
          v.literal("remove"),
        ),
        heading: v.string(),
        newHeading: v.optional(v.string()),
        position: v.optional(v.number()),
        status: v.optional(
          v.union(
            v.literal("drafting"),
            v.literal("needs_detail"),
            v.literal("complete"),
          ),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Ensure document exists
    let document = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!document) {
      const documentId = await ctx.db.insert("documents", {
        projectId: args.projectId,
        latestDraftMarkdown: "",
        summary: undefined,
        status: "drafting",
        lockedSections: [],
        updatedAt: now,
      });
      document = await ctx.db.get(documentId);
      if (!document) {
        throw new Error("Failed to create document");
      }
    }

    // Load existing sections
    const existingSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    const sections = existingSections.sort((a, b) => a.order - b.order);
    const sectionsByHeading = new Map<string, Doc<"documentSections">>();
    for (const section of sections) {
      sectionsByHeading.set(section.heading.toLowerCase(), section);
    }

    // Apply operations
    for (const op of args.operations) {
      const key = op.heading.toLowerCase();
      const existing = sectionsByHeading.get(key);

      switch (op.action) {
        case "add": {
          if (existing) {
            // Idempotent: if section exists, just update its status/position if provided
            const updates: Partial<Doc<"documentSections">> = { updatedAt: now };
            if (op.status) {
              updates.status = op.status;
            }
            if (typeof op.position === "number" && existing.order !== op.position) {
              // Move existing section to new position
              const currentIndex = sections.findIndex((s) => s._id === existing._id);
              if (currentIndex !== -1) {
                sections.splice(currentIndex, 1);
                sections.splice(op.position, 0, existing);
              }
            }
            if (Object.keys(updates).length > 1) {
              await ctx.db.patch(existing._id, updates);
            }
            break;
          }
          const targetPosition = typeof op.position === "number" ? op.position : sections.length;
          const sectionId = await ctx.db.insert("documentSections", {
            documentId: document._id,
            heading: op.heading,
            content: "",
            order: targetPosition,
            status: op.status ?? "needs_detail",
            version: 1,
            locked: false,
            updatedAt: now,
          });
          const newSection = await ctx.db.get(sectionId);
          if (newSection) {
            sections.splice(targetPosition, 0, newSection);
            sectionsByHeading.set(op.heading.toLowerCase(), newSection);
          }
          break;
        }

        case "rename": {
          if (!existing) {
            // Idempotent: silently skip if section doesn't exist
            console.warn(`[manageOutline] rename: section "${op.heading}" not found, skipping`);
            break;
          }
          if (!op.newHeading) {
            console.warn(`[manageOutline] rename: newHeading missing for "${op.heading}", skipping`);
            break;
          }
          const newKey = op.newHeading.toLowerCase();
          if (sectionsByHeading.has(newKey) && newKey !== key) {
            // Target name already exists and it's not the same section
            console.warn(`[manageOutline] rename: "${op.newHeading}" already exists, skipping`);
            break;
          }
          await ctx.db.patch(existing._id, {
            heading: op.newHeading,
            version: existing.version + 1,
            updatedAt: now,
          });
          sectionsByHeading.delete(key);
          const updated = await ctx.db.get(existing._id);
          if (updated) {
            sectionsByHeading.set(newKey, updated);
          }
          break;
        }

        case "reorder": {
          if (!existing) {
            // Idempotent: silently skip if section doesn't exist
            console.warn(`[manageOutline] reorder: section "${op.heading}" not found, skipping`);
            break;
          }
          if (typeof op.position !== "number") {
            console.warn(`[manageOutline] reorder: position missing for "${op.heading}", skipping`);
            break;
          }
          const currentIndex = sections.findIndex((s) => s._id === existing._id);
          if (currentIndex !== -1 && currentIndex !== op.position) {
            sections.splice(currentIndex, 1);
            sections.splice(op.position, 0, existing);
          }
          break;
        }

        case "remove": {
          if (!existing) {
            // Idempotent: silently skip if already removed
            break;
          }
          await ctx.db.delete(existing._id);
          sectionsByHeading.delete(key);
          const index = sections.findIndex((s) => s._id === existing._id);
          if (index !== -1) {
            sections.splice(index, 1);
          }
          break;
        }
      }
    }

    // Reindex all sections to ensure contiguous ordering
    for (let i = 0; i < sections.length; i++) {
      if (sections[i]!.order !== i) {
        await ctx.db.patch(sections[i]!._id, {
          order: i,
          updatedAt: now,
        });
      }
    }

    // Rebuild markdown from sections
    const refreshedSections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    const sortedSections = refreshedSections.sort((a, b) => a.order - b.order);
    const markdown = sortedSections
      .map((s) => `# ${s.heading}\n\n${s.content}`)
      .join("\n\n");

    await ctx.db.patch(document._id, {
      latestDraftMarkdown: markdown,
      updatedAt: now,
    });

    // Return workspace view
    const updatedDoc = await ctx.db.get(document._id);
    return {
      document: updatedDoc,
      sections: sortedSections,
      operations: args.operations.length,
    };
  },
});

export const enqueueDraftUpdate = mutation({
  args: {
    projectId: v.id("projects"),
    sessionId: v.id("sessions"),
    urgency: v.optional(v.string()),
    summary: v.optional(v.string()),
    messagePointers: v.optional(v.array(v.string())),
    transcriptAnchors: v.optional(v.array(v.string())),
    promptContext: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const summaryText = isNonEmptyString(args.summary)
      ? args.summary.trim()
      : undefined;
    const urgencyText = isNonEmptyString(args.urgency)
      ? args.urgency.trim()
      : undefined;
    const messagePointers = (args.messagePointers ?? []).filter(isNonEmptyString);
    const transcriptAnchors = (args.transcriptAnchors ?? []).filter(isNonEmptyString);
    const normalizedSummary = normalizeSummary(summaryText);

    const existingJobs = await ctx.db
      .query("draftJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const activeJob = existingJobs.find((job) =>
      job.status === "queued" || job.status === "running",
    );

    if (activeJob) {
      await ctx.db.patch(activeJob._id, {
        summary: summaryText ?? activeJob.summary,
        urgency: urgencyText ?? activeJob.urgency,
        messagePointers:
          messagePointers.length > 0 ? messagePointers : activeJob.messagePointers,
        transcriptAnchors:
          transcriptAnchors.length > 0
            ? transcriptAnchors
            : activeJob.transcriptAnchors,
        promptContext: args.promptContext ?? activeJob.promptContext,
        updatedAt: now,
      });
      const refreshed = await ctx.db.get(activeJob._id);
      return refreshed ?? activeJob;
    }

    if (normalizedSummary) {
      const duplicate = existingJobs.find((job) => {
        if (!isNonEmptyString(job.summary)) return false;
        if (now - job.createdAt > 90_000) return false;
        return normalizeSummary(job.summary) === normalizedSummary;
      });
      if (duplicate) {
        const existingUrgency = isNonEmptyString(duplicate.urgency)
          ? duplicate.urgency.trim()
          : "";
        const escalate = urgencyText && urgencyText !== existingUrgency;
        if (!escalate) {
          return duplicate;
        }
        await ctx.db.patch(duplicate._id, {
          urgency: urgencyText,
          updatedAt: now,
          messagePointers:
            messagePointers.length > 0
              ? messagePointers
              : duplicate.messagePointers ?? undefined,
          transcriptAnchors:
            transcriptAnchors.length > 0
              ? transcriptAnchors
              : duplicate.transcriptAnchors ?? undefined,
          promptContext: args.promptContext ?? duplicate.promptContext,
        });
        const refreshedDuplicate = await ctx.db.get(duplicate._id);
        return refreshedDuplicate ?? duplicate;
      }
    }

    const jobId = await ctx.db.insert("draftJobs", {
      projectId: args.projectId,
      sessionId: args.sessionId,
      status: "queued",
      summary: summaryText,
      urgency: urgencyText,
      messagePointers:
        messagePointers.length > 0 ? messagePointers : undefined,
      transcriptAnchors:
        transcriptAnchors.length > 0 ? transcriptAnchors : undefined,
      promptContext: args.promptContext ?? undefined,
      generatedSummary: undefined,
      modelUsage: undefined,
      createdAt: now,
      startedAt: undefined,
      completedAt: undefined,
      updatedAt: now,
      error: undefined,
      durationMs: undefined,
      attemptCount: 0,
    });

    const created = await ctx.db.get(jobId);
    return created;
  },
});

export const getDraftQueueState = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("draftJobs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const sortedJobs = [...jobs].sort((a, b) => b.createdAt - a.createdAt);
    const activeJob = sortedJobs.find((job) =>
      job.status === "queued" || job.status === "running",
    );

    const transcriptRecords = await ctx.db
      .query("projectTranscripts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const latestTranscript = transcriptRecords
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;

    return {
      activeJob: activeJob ?? null,
      jobs: sortedJobs.slice(0, 5),
      latestTranscript:
        latestTranscript
          ? {
              sessionId: latestTranscript.sessionId,
              updatedAt: latestTranscript.updatedAt,
              finalizedAt: latestTranscript.finalizedAt ?? null,
              itemCount: latestTranscript.items.length,
            }
          : null,
    } as const;
  },
});

export const claimNextDraftJob = mutation({
  args: {},
  handler: async (ctx) => {
    const queued = await ctx.db
      .query("draftJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();

    if (queued.length === 0) {
      return null;
    }

    const sorted = [...queued].sort((a, b) => a.createdAt - b.createdAt);
    const next = sorted[0]!;
    const now = Date.now();
    const attemptCount = (next.attemptCount ?? 0) + 1;

    await ctx.db.patch(next._id, {
      status: "running",
      startedAt: now,
      updatedAt: now,
      error: undefined,
      attemptCount,
    });

    const refreshed = await ctx.db.get(next._id);
    return (
      refreshed ?? {
        ...next,
        status: "running",
        startedAt: now,
        updatedAt: now,
        attemptCount,
      }
    );
  },
});

export const updateDraftJobStatus = mutation({
  args: {
    jobId: v.id("draftJobs"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    generatedSummary: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    modelUsage: v.optional(MODEL_USAGE_VALIDATOR),
    attemptCount: v.optional(v.number()),
    transcriptCursor: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Partial<Doc<"draftJobs">> = {
      status: args.status,
      updatedAt: now,
      error: args.error,
    };

    if (typeof args.summary === "string") {
      patch.summary = args.summary;
    }

    if (typeof args.generatedSummary === "string") {
      patch.generatedSummary = args.generatedSummary;
    }

    if (typeof args.durationMs === "number") {
      patch.durationMs = args.durationMs;
    }

    if (typeof args.attemptCount === "number") {
      patch.attemptCount = args.attemptCount;
    }

    if (args.modelUsage) {
      patch.modelUsage = args.modelUsage;
    }

    if (typeof args.transcriptCursor === "number") {
      patch.transcriptCursor = args.transcriptCursor;
    }

    if (args.status === "complete" || args.status === "error") {
      patch.completedAt = now;
    }

    if (args.status === "queued") {
      patch.startedAt = undefined;
      patch.completedAt = undefined;
      patch.durationMs = undefined;
      patch.error = undefined;
    }

    await ctx.db.patch(args.jobId, patch);
    return ctx.db.get(args.jobId);
  },
});

export const reportDraftProgress = mutation({
  args: {
    jobId: v.id("draftJobs"),
    projectId: v.id("projects"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("error"),
    ),
    summary: v.optional(v.string()),
    error: v.optional(v.string()),
    sections: v.optional(v.array(SECTION_PROGRESS_VALIDATOR)),
    attemptCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      return { ok: false, reason: "missing_job" } as const;
    }

    const session = await ctx.db.get(job.sessionId);
    if (!session?.realtimeSessionId) {
      return { ok: false, reason: "missing_session" } as const;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!isNonEmptyString(apiKey)) {
      console.warn("Draft progress emission skipped: OPENAI_API_KEY missing");
      return { ok: false, reason: "missing_api_key" } as const;
    }

    const sectionSummaries = (args.sections ?? []).map((section) => ({
      heading: section.heading,
      status: section.status ?? null,
      order: typeof section.order === "number" ? section.order : null,
    }));

    const payload = {
      tool: "queue_draft_update",
      jobId: args.jobId,
      projectId: args.projectId,
      status: args.status,
      summary: args.summary ?? null,
      error: args.error ?? null,
      sections: sectionSummaries,
      attemptCount: args.attemptCount ?? job.attemptCount ?? null,
      timestamp: Date.now(),
    } as const;

    const endpoint = `${OPENAI_REALTIME_ENDPOINT}/${session.realtimeSessionId}/events`;
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const serialized = JSON.stringify(payload);

    try {
      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "system",
            content: [{ type: "input_text", text: `TOOL_PROGRESS::${serialized}` }],
          },
        }),
      });

      await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "response.create" }),
      });

      return { ok: true } as const;
    } catch (error) {
      console.error("Failed to emit draft progress", error, payload);
      return { ok: false, reason: "network_error" } as const;
    }
  },
});

export const generateDraftSummary = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ generated: boolean; summary: string | null; reason?: string }> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!isNonEmptyString(apiKey)) {
      throw new Error("OPENAI_API_KEY not configured for summarization");
    }

    const workspace = await ctx.runQuery(api.documents.getWorkspace, {
      projectId: args.projectId,
    });

    const existingSummary = workspace.document?.summary?.trim();
    if (existingSummary) {
      return { generated: false, summary: existingSummary };
    }

    const markdown = workspace.document?.latestDraftMarkdown ?? "";
    const trimmedMarkdown = markdown.trim();
    if (!trimmedMarkdown) {
      return { generated: false, summary: null, reason: "empty_draft" };
    }

    const excerpt = trimmedMarkdown.length > 6000
      ? `${trimmedMarkdown.slice(0, 6000)}\n...`
      : trimmedMarkdown;

    const systemPrompt =
      "You are an editor producing factual summaries of long-form drafts. Summaries must only restate content already present and avoid commentary, instructions, or speculation.";
    const userPrompt = `Summarize the draft below in plain prose (2-3 sentences). Focus only on what the draft currently says and do not add analysis, recommendations, or next steps.\n\nDraft:\n"""\n${excerpt}\n"""`;

    const model = DEFAULT_SUMMARY_MODEL;
    const body: Record<string, unknown> = {
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: userPrompt }],
        },
      ],
      stream: false,
    };

    if (supportsReasoningControls(model)) {
      body.reasoning = { effort: "minimal" };
    }

    const maxAttempts = 3;
    let attempt = 0;
    let lastError: unknown = null;
    let summaryText: string | null = null;

    while (attempt < maxAttempts) {
      try {
        const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Draft summary request failed (${response.status}): ${errorText}`,
          );
        }

        const json = await response.json();
        const content = extractResponseText(json);
        if (!content) {
          throw new Error("Draft summary response did not include text content");
        }
        summaryText = content;
        break;
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= maxAttempts) {
          if (error instanceof Error) {
            throw error;
          }
          throw new Error(String(error));
        }
        const delay = 500 * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }

    if (!summaryText) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Failed to generate draft summary");
    }

    await ctx.runMutation(api.documents.setSummary, {
      projectId: args.projectId,
      summary: summaryText,
    });

    return { generated: true, summary: summaryText };
  },
});

export const processDraftQueue = action({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<DraftQueueProcessResult> => {
    const claimed = (await ctx.runMutation(api.documents.claimNextDraftJob, {})) as
      | Doc<"draftJobs">
      | null;
    if (!claimed) {
      return { processed: false, reason: "empty" } as const;
    }

    const jobId = claimed._id as Id<"draftJobs">;
    const projectId = claimed.projectId as Id<"projects">;

    if (args.dryRun) {
      await ctx.runMutation(api.documents.updateDraftJobStatus, {
        jobId,
        status: "queued",
        summary: claimed.summary ?? undefined,
        attemptCount: claimed.attemptCount ?? 0,
      });
      return { processed: false, reason: "dry-run" } as const;
    }

    const startedAt = Date.now();
    const logStage = (stage: string, started: number, extra: Record<string, unknown> = {}) => {
      console.log("[draft-queue] stage", {
        jobId,
        stage,
        durationMs: Date.now() - started,
        ...extra,
      });
    };
    const attemptCount = claimed.attemptCount ?? 1;
    let promptTokens: number | undefined;

    await ctx.runMutation(api.documents.reportDraftProgress, {
      jobId,
      projectId,
      status: "running",
      summary: claimed.summary ?? undefined,
      attemptCount,
    });

    let latestTranscriptUpdatedAt = 0;

    try {
      const fetchStart = Date.now();
      const workspace = await ctx.runQuery(api.documents.getWorkspace, {
        projectId,
      });
      const projectBundle = await ctx.runQuery(api.projects.getProject, {
        projectId,
      });
      const transcriptRecords = await ctx.runQuery(
        api.projects.getTranscriptForProject,
        { projectId },
      );
      const notes = await ctx.runQuery(api.notes.listForProject, {
        projectId,
        limit: 40,
      });
      const todos = await ctx.runQuery(api.todos.listForProject, { projectId });
      latestTranscriptUpdatedAt = transcriptRecords.reduce(
        (max, record) =>
          typeof record.updatedAt === "number" && record.updatedAt > max
            ? record.updatedAt
            : max,
        0,
      );
      const sessionMessages = await ctx.runQuery(
        api.messages.listForSession,
        {
          sessionId: claimed.sessionId,
        },
      );
      logStage("context_loaded", fetchStart, {
        notes: notes?.length ?? 0,
        todos: todos?.length ?? 0,
        transcriptRecords: transcriptRecords.length,
        attemptCount,
      });

      if (!projectBundle?.project) {
        throw new Error("Project not found during draft processing");
      }

      const messageMap = new Map<string, Doc<"messages">>();
      for (const message of (sessionMessages as Doc<"messages">[]) ?? []) {
        messageMap.set(message._id, message);
        for (const tag of message.tags ?? []) {
          messageMap.set(tag, message);
        }
      }

      const transcriptItems: DraftingPromptTranscriptItem[] = transcriptRecords
        .flatMap((record: { items?: unknown }) =>
          Array.isArray(record.items) ? record.items : [],
        )
        .map((raw: unknown, index: number) => {
          const item = raw as Record<string, unknown>;
          const idValue = isNonEmptyString(item.id as string | undefined)
            ? (item.id as string)
            : `item-${index}-${Date.now()}`;
          const messageIdValue =
            typeof item.messageId === "string"
              ? (item.messageId as Id<"messages">)
              : undefined;
          const previousValue =
            typeof item.previousItemId === "string"
              ? (item.previousItemId as string)
              : typeof (item as Record<string, unknown>).previous_item_id ===
                    "string"
                ? ((item as Record<string, unknown>).previous_item_id as string)
                : undefined;
          const createdAtValue =
            typeof item.createdAt === "number"
              ? item.createdAt
              : typeof (item as Record<string, unknown>).created_at ===
                  "number"
                ? ((item as Record<string, unknown>).created_at as number)
                : Date.now();
          const payloadText =
            extractText(item.payload) ?? extractText(item.content);
          const fallbackMessage = messageIdValue
            ? messageMap.get(messageIdValue)
            : undefined;
          const fallbackText = fallbackMessage?.transcript ?? null;
          const messageKeyValue = isNonEmptyString(
            item.messageKey as string | undefined,
          )
            ? (item.messageKey as string)
            : undefined;

          return {
            id: idValue,
            role: isNonEmptyString(item.role as string | undefined)
              ? (item.role as string)
              : undefined,
            status: isNonEmptyString(item.status as string | undefined)
              ? (item.status as string)
              : undefined,
            type: isNonEmptyString(item.type as string | undefined)
              ? (item.type as string)
              : undefined,
            previousItemId: previousValue,
            createdAt: createdAtValue,
            messageId: messageIdValue,
            messageKey: messageKeyValue ?? idValue,
            text: payloadText ?? fallbackText,
          } satisfies DraftingPromptTranscriptItem;
        });

      const hasContentfulTranscript = transcriptItems.some((item) =>
        isNonEmptyString(item.text),
      );
      const lastTranscriptCursor =
        typeof (claimed as { transcriptCursor?: number }).transcriptCursor ===
        "number"
          ? (claimed as { transcriptCursor?: number }).transcriptCursor
          : null;

      // PRAGMATIC FIX: Only skip if there's literally NO transcript content
      // The cursor check was too conservative and prevented processing
      if (!hasContentfulTranscript) {
        logStage("skipped_no_transcript", Date.now(), {
          transcriptItems: transcriptItems.length,
          latestTranscriptUpdatedAt,
          lastTranscriptCursor,
        });

        const restoredAttemptCount = Math.max((claimed.attemptCount ?? 1) - 1, 0);
        await ctx.runMutation(api.documents.updateDraftJobStatus, {
          jobId,
          status: "queued",
          summary: claimed.summary ?? undefined,
          attemptCount: restoredAttemptCount,
          transcriptCursor: lastTranscriptCursor ?? undefined,
        });

        await ctx.runMutation(api.documents.reportDraftProgress, {
          jobId,
          projectId,
          status: "queued",
          summary: claimed.summary ?? undefined,
          attemptCount: restoredAttemptCount,
        });

        return { processed: false, reason: "no_transcript", jobId } as const;
      }

      const referencedMessages = (claimed.messagePointers ?? [])
        .map((pointer: string) => messageMap.get(pointer))
        .filter((message): message is Doc<"messages"> => Boolean(message));

      const promptStart = Date.now();
      const prompt = buildDraftingPrompt({
        project: projectBundle.project,
        blueprint: projectBundle.blueprint ?? null,
        document: workspace.document ?? null,
        sections: workspace.sections ?? [],
        notes,
        todos,
        transcriptItems,
        job: claimed as Doc<"draftJobs">,
        referencedMessages,
      });
      logStage("prompt_ready", promptStart, {
        promptTokens: prompt.tokens,
        transcriptItems: transcriptItems.length,
        noteCount: notes.length,
      });

      promptTokens = prompt.tokens;

      const modelStart = Date.now();
      const modelResult = await ctx.runAction(api.documents.callDraftingModel, {
        prompt: {
          system: prompt.system,
          user: prompt.user,
        },
      });
      logStage("model_completed", modelStart, {
        usage: modelResult.usage ?? null,
      });

      const normalizedSections = modelResult.sections.map(
        (section: DraftingModelSection, index: number) => ({
          heading: section.heading,
          content: section.content,
          status: section.status ?? "drafting",
          order:
            typeof section.order === "number" ? section.order : index,
        }),
      );

      // Determine if this is a section-scoped update
      const rawPromptContext = claimed.promptContext ?? null;
      const activeSectionHeading = (() => {
        if (!rawPromptContext || typeof rawPromptContext !== "object") return null;
        const candidate = (rawPromptContext as Record<string, unknown>).activeSection;
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim();
        }
        return null;
      })();

      if (activeSectionHeading) {
        // SURGICAL UPDATE: Only update the specified section
        if (normalizedSections.length !== 1) {
          console.warn(
            `[draft-queue] Expected 1 section for activeSection="${activeSectionHeading}", got ${normalizedSections.length}. Using first section only.`,
          );
        }
        const targetSection = normalizedSections[0];
        if (!targetSection) {
          throw new Error(
            `Model did not return any sections for activeSection="${activeSectionHeading}"`,
          );
        }

        await ctx.runMutation(api.documents.applySectionEdit, {
          projectId,
          sectionHeading: activeSectionHeading, // Use the heading from promptContext (immutable)
          sectionMarkdown: modelResult.markdown.trim(),
          sectionStatus: targetSection.status,
          summary: modelResult.summary ?? workspace.document?.summary ?? undefined,
        });
      } else {
        // FULL DOCUMENT UPDATE: Apply all sections (e.g., initial outline creation)
        await ctx.runMutation(api.documents.applyEdits, {
          projectId,
          markdown: modelResult.markdown,
          sections: normalizedSections,
          summary:
            modelResult.summary ??
            workspace.document?.summary ??
            undefined,
        });
      }

      const durationMs = Date.now() - startedAt;

      await ctx.runMutation(api.documents.updateDraftJobStatus, {
        jobId,
        status: "complete",
        summary: claimed.summary ?? undefined,
        generatedSummary: modelResult.summary ?? undefined,
        durationMs,
        modelUsage: modelResult.usage,
        attemptCount,
        transcriptCursor:
          latestTranscriptUpdatedAt > 0 ? latestTranscriptUpdatedAt : undefined,
      });

      await ctx.runMutation(api.documents.reportDraftProgress, {
        jobId,
        projectId,
        status: "complete",
        summary: modelResult.summary ?? claimed.summary ?? undefined,
        sections: normalizedSections.map((section: DraftingModelSection) => ({
          heading: section.heading,
          status: section.status,
          order: section.order,
        })),
        attemptCount,
      });

      await publishDraftJobMetrics({
        jobId,
        projectId,
        sessionId: claimed.sessionId,
        status: "complete",
        durationMs,
        attempts: attemptCount,
        promptTokens,
        tokens: modelResult.usage
          ? {
              input: modelResult.usage.inputTokens,
              output: modelResult.usage.outputTokens,
              total: modelResult.usage.totalTokens,
            }
          : undefined,
        timestamp: Date.now(),
      });

      console.log("[draft-queue] completed", {
        jobId,
        durationMs,
        attempts: attemptCount,
        promptTokens,
        usage: modelResult.usage,
      });

      return { processed: true, jobId } as const;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const shouldRetry = attemptCount < 3;
      const message =
        error instanceof Error
          ? error.message
          : `Unexpected error: ${String(error)}`;

      console.error("[draft-queue] failed", error, { jobId, attemptCount });

      await ctx.runMutation(api.documents.updateDraftJobStatus, {
        jobId,
        status: shouldRetry ? "queued" : "error",
        error: message,
        durationMs,
        attemptCount,
        transcriptCursor:
          latestTranscriptUpdatedAt > 0 ? latestTranscriptUpdatedAt : undefined,
      });

      await ctx.runMutation(api.documents.reportDraftProgress, {
        jobId,
        projectId,
        status: "error",
        summary: claimed.summary ?? undefined,
        error: message,
        attemptCount,
      });

      await publishDraftJobMetrics({
        jobId,
        projectId,
        sessionId: claimed.sessionId,
        status: "error",
        durationMs,
        attempts: attemptCount,
        promptTokens,
        timestamp: Date.now(),
      });

      if (!shouldRetry) {
        await sendDraftingAlert({
          jobId,
          projectId,
          sessionId: claimed.sessionId,
          severity: "error",
          message,
          summary: claimed.summary ?? undefined,
        });
      }

      return {
        processed: false,
        reason: shouldRetry ? "retry" : "error",
        jobId,
      } as const;
    }
  },
});

export const processDraftQueueBatch = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 3, 10));
    const results: DraftQueueProcessResult[] = [];
    for (let index = 0; index < limit; index++) {
      const result = (await ctx.runAction(api.documents.processDraftQueue, {})) as DraftQueueProcessResult;
      results.push(result);
      if (!result.processed || result.reason === "empty") {
        break;
      }
    }
    return results;
  },
});

export const triggerDraftProcessing = action({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DraftQueueProcessResult[]> => {
    const limit = Math.max(1, Math.min(args.limit ?? 3, 10));
    return ctx.runAction(api.documents.processDraftQueueBatch, { limit });
  },
});

export const resetDraft = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const document = await ctx.db
      .query("documents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();

    if (!document) {
      return { document: null, sections: [] } as const;
    }

    const now = Date.now();

    await ctx.db.patch(document._id, {
      latestDraftMarkdown: "",
      summary: undefined,
      status: "drafting",
      updatedAt: now,
    });

    const sections = await ctx.db
      .query("documentSections")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();

    for (const section of sections) {
      await ctx.db.delete(section._id);
    }

    const refreshed = await ctx.db.get(document._id);

    return {
      document: refreshed,
      sections: [] as Doc<"documentSections">[],
    } as const;
  },
});
