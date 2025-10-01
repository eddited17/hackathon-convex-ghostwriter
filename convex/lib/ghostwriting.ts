import type { Doc, Id } from "../_generated/dataModel";

export type DraftingPromptTranscriptItem = {
  id: string;
  role?: string;
  status?: string;
  type?: string;
  previousItemId?: string;
  createdAt: number;
  messageId?: Id<"messages">;
  messageKey?: string;
  text?: string | null;
};

export type DraftingPromptInput = {
  project: Doc<"projects">;
  blueprint: Doc<"projectBlueprints"> | null;
  document: Doc<"documents"> | null;
  sections: Doc<"documentSections">[];
  notes: Doc<"notes">[];
  todos: Doc<"todos">[];
  transcriptItems: DraftingPromptTranscriptItem[];
  job: Doc<"draftJobs">;
  referencedMessages: Array<Doc<"messages">>;
};

export type DraftingPromptResult = {
  system: string;
  user: string;
  tokens: number;
};

const SECTION_STATUS_LABEL: Record<string, string> = {
  drafting: "Drafting",
  needs_detail: "Needs detail",
  complete: "Complete",
};

const MAX_EXISTING_DRAFT_CONTEXT_CHARS = 6000;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractSectionByHeading = (markdown: string, heading: string) => {
  const trimmedHeading = heading.trim();
  if (!trimmedHeading) return markdown;
  const pattern = new RegExp(
    `^#{1,6}\\s+${escapeRegExp(trimmedHeading)}\\s*$`,
    "i",
  );
  const sections = markdown.split(/(?=^#{1,6}\s+)/m);
  for (const section of sections) {
    const [firstLine] = section.split(/\n/);
    if (firstLine && pattern.test(firstLine.trim())) {
      return section.trim();
    }
  }
  return markdown;
};

const formatList = (items: string[], emptyLabel: string) => {
  if (items.length === 0) return emptyLabel;
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
};

const sanitizeText = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
};

const extractTranscriptText = (
  item: DraftingPromptTranscriptItem,
  fallback?: string | null,
) => {
  if (typeof item.text === "string" && item.text.trim()) {
    return sanitizeText(item.text);
  }
  if (fallback) {
    return sanitizeText(fallback);
  }
  return "";
};

const summarizeBlueprint = (blueprint: Doc<"projectBlueprints"> | null) => {
  if (!blueprint) return "Blueprint status: unavailable.";
  const fields: Array<[string, string | undefined]> = [
    ["Desired outcome", blueprint.desiredOutcome ?? undefined],
    ["Target audience", blueprint.targetAudience ?? undefined],
    ["Materials inventory", blueprint.materialsInventory ?? undefined],
    ["Communication preferences", blueprint.communicationPreferences ?? undefined],
  ];

  const complete = fields
    .filter(([, value]) => Boolean(value && value.trim()))
    .map(([label, value]) => `${label}: ${sanitizeText(value ?? "")}`);

  const guardrails = blueprint.voiceGuardrails
    ? [
        blueprint.voiceGuardrails.tone
          ? `Voice tone: ${sanitizeText(blueprint.voiceGuardrails.tone)}`
          : null,
        blueprint.voiceGuardrails.structure
          ? `Voice structure: ${sanitizeText(blueprint.voiceGuardrails.structure)}`
          : null,
        blueprint.voiceGuardrails.content
          ? `Voice content guardrails: ${sanitizeText(
              blueprint.voiceGuardrails.content,
            )}`
          : null,
      ].filter((entry): entry is string => Boolean(entry))
    : [];

  if (complete.length === 0 && guardrails.length === 0) {
    return "Blueprint captured but missing detailed fields.";
  }

  return [
    `Blueprint status: ${blueprint.status}.`,
    ...complete,
    ...guardrails,
  ].join("\n");
};

const summarizeTodos = (todos: Doc<"todos">[]) => {
  if (todos.length === 0) return "No open TODOs.";
  const open = todos.filter((todo) => todo.status !== "resolved");
  if (open.length === 0) return "All TODOs resolved.";
  return open
    .map((todo) => {
      const statusLabel =
        todo.status === "in_review" ? "needs-review" : todo.status;
      return `- (${statusLabel}) ${sanitizeText(todo.label)}`;
    })
    .join("\n");
};

const summarizeNotes = (notes: Doc<"notes">[]) => {
  if (notes.length === 0) return "No recent notes.";
  const ordered = [...notes].sort((a, b) => b.createdAt - a.createdAt);
  const limited = ordered.slice(0, 8);
  return limited
    .map((note) => {
      const tag = note.noteType;
      const header = tag === "todo" ? "TODO" : tag.toUpperCase();
      const body = sanitizeText(note.content);
      return `- [${header}] ${body}`;
    })
    .join("\n");
};

const summarizeSections = (sections: Doc<"documentSections">[]) => {
  if (sections.length === 0) return "No sections saved.";
  const ordered = [...sections].sort((a, b) => a.order - b.order);
  return ordered
    .map((section, index) => {
      const label = SECTION_STATUS_LABEL[section.status] ?? section.status;
      return `${index + 1}. ${section.heading} — ${label} (v${section.version})`;
    })
    .join("\n");
};

const collectTranscriptExcerpts = (
  items: DraftingPromptTranscriptItem[],
  referencedIds: Id<"messages">[] | null,
  anchors: string[] | null,
) => {
  if (items.length === 0) return "No transcript excerpts captured.";

  const validAnchors = new Set<string>((anchors ?? []).filter(Boolean));
  const referencedMessageIds = new Set<string>((referencedIds ?? []).map(String));

  const ordered = [...items].sort((a, b) => a.createdAt - b.createdAt);

  const roleScoped = ordered.filter((item) => {
    const role = (item.role ?? "").toLowerCase();
    const isAssistantRole = role.includes("assistant") || role === "system";
    if (!isAssistantRole) {
      return true;
    }
    if (
      (item.messageId && referencedMessageIds.has(String(item.messageId))) ||
      (item.id && validAnchors.has(item.id)) ||
      (item.previousItemId && validAnchors.has(item.previousItemId))
    ) {
      return true;
    }
    return false;
  });

  const scoped = roleScoped.length > 0 ? roleScoped : ordered;

  const filtered = scoped.filter((item) => {
    if (referencedMessageIds.size === 0 && validAnchors.size === 0) {
      return true;
    }
    if (item.messageId && referencedMessageIds.has(String(item.messageId))) {
      return true;
    }
    if (item.id && validAnchors.has(item.id)) {
      return true;
    }
    if (item.previousItemId && validAnchors.has(item.previousItemId)) {
      return true;
    }
    return false;
  });

  const toRender = filtered.length > 0 ? filtered.slice(-12) : scoped.slice(-8);

  return toRender
    .map((item) => {
      const speaker = item.role ?? "unknown";
      const text = extractTranscriptText(item);
      const ref = item.messageKey ?? item.id;
      return `- (${speaker}) ${text}${ref ? ` [ref:${ref}]` : ""}`;
    })
    .join("\n");
};

const collectReferencedMessages = (messages: Array<Doc<"messages">>) => {
  if (messages.length === 0) return [] as string[];
  const ordered = [...messages].sort((a, b) => b.timestamp - a.timestamp);
  const limited = ordered.slice(0, 5);
  return limited.map((message) => {
    const speaker = message.speaker === "assistant" ? "Assistant" : "Client";
    return `- (${speaker}) ${sanitizeText(message.transcript)}`;
  });
};

const estimatePromptTokens = (system: string, user: string) => {
  const wordCount = `${system}\n${user}`.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 0;
  return Math.max(64, Math.round(wordCount * 1.3));
};

export function buildDraftingPrompt(input: DraftingPromptInput): DraftingPromptResult {
  const { project, blueprint, document, sections, notes, todos, transcriptItems, job, referencedMessages } = input;

  const projectSummaryLines = [
    `Project: ${project.title} (${project.contentType})`,
    project.goal ? `Goal: ${sanitizeText(project.goal)}` : "Goal: —",
    `Status: ${project.status}`,
  ];

  const existingMarkdown = document?.latestDraftMarkdown ?? "";
  const trimmedMarkdown = existingMarkdown.trim();
  const rawPromptContext = job.promptContext ?? null;
  const activeSectionHeading = (() => {
    if (!rawPromptContext || typeof rawPromptContext !== "object") return null;
    const candidate = (rawPromptContext as Record<string, unknown>).activeSection;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    return null;
  })();
  const feedbackItems = (() => {
    if (!rawPromptContext || typeof rawPromptContext !== "object") return [] as string[];
    const feedback = (rawPromptContext as Record<string, unknown>).feedback;
    if (!feedback) return [] as string[];
    const coerce = (value: unknown): string | null => {
      if (typeof value === "string") {
        const text = sanitizeText(value);
        return text ? text : null;
      }
      if (Array.isArray(value)) {
        const combined = value
          .map((entry) => coerce(entry))
          .filter((entry): entry is string => Boolean(entry))
          .join("; ");
        const text = sanitizeText(combined);
        return text ? text : null;
      }
      if (value && typeof value === "object") {
        return sanitizeText(JSON.stringify(value));
      }
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      return null;
    };
    if (Array.isArray(feedback)) {
      return feedback
        .map((entry) => coerce(entry))
        .filter((entry): entry is string => Boolean(entry));
    }
    const single = coerce(feedback);
    return single ? [single] : [];
  })();
  const documentSummaryLines = [
    document?.summary ? `Previous summary: ${sanitizeText(document.summary)}` : "Previous summary: —",
    document?.latestDraftMarkdown
      ? `Existing draft length: ${document.latestDraftMarkdown.split(/\s+/).filter(Boolean).length} words`
      : "Existing draft length: 0 words",
  ];

  if (!trimmedMarkdown) {
    documentSummaryLines.push(
      "Draft status: empty — follow the transcript if the client asked for section planning; otherwise begin drafting the requested section immediately.",
    );
  }

  if (activeSectionHeading) {
    documentSummaryLines.push(
      `Active section focus: ${activeSectionHeading} (do not edit other sections).`,
    );
  }

  const requestSummary = sanitizeText(job.summary ?? "");
  if (requestSummary) {
    documentSummaryLines.push(`Most recent request: ${requestSummary}`);
  }

  if (job.urgency) {
    documentSummaryLines.push(`Urgency: ${sanitizeText(job.urgency)}`);
  }

  if (job.generatedSummary) {
    documentSummaryLines.push(`Last generated summary: ${sanitizeText(job.generatedSummary)}`);
  }

  const promptContext = rawPromptContext
    ? JSON.stringify(rawPromptContext, null, 2)
    : null;

  const transcriptExcerpt = collectTranscriptExcerpts(
    transcriptItems,
    job.messagePointers?.map((pointer) => pointer as Id<"messages">) ?? null,
    job.transcriptAnchors ?? null,
  );

  const referencedMessageSummaries = collectReferencedMessages(referencedMessages);

  const existingDraftExcerpt = (() => {
    if (!trimmedMarkdown) return null;
    // ALWAYS provide full document as context so model can see what exists
    // Model will return ONLY the active section, which we'll merge back
    if (trimmedMarkdown.length <= MAX_EXISTING_DRAFT_CONTEXT_CHARS) {
      return trimmedMarkdown;
    }
    // Provide full document but truncate for token budget
    const truncated = trimmedMarkdown.slice(0, MAX_EXISTING_DRAFT_CONTEXT_CHARS);
    return `${truncated}\n… existing draft truncated for incremental update.`;
  })();

  const userSections: string[] = [
    "## Project",
    projectSummaryLines.join("\n"),
    "\n## Blueprint",
    summarizeBlueprint(blueprint),
    "\n## Document",
    documentSummaryLines.join("\n"),
    "\n## Sections",
    summarizeSections(sections),
    "\n## TODOs",
    summarizeTodos(todos),
    "\n## Notes",
    summarizeNotes(notes),
    "\n## Transcript excerpts",
    transcriptExcerpt,
  ];

  if (referencedMessageSummaries.length > 0) {
    userSections.push("\n## Referenced messages");
    userSections.push(
      referencedMessageSummaries.slice(0, 2).join("\n"),
    );
  }

  if (feedbackItems.length > 0) {
    userSections.push("\n## Revision feedback to apply");
    userSections.push(feedbackItems.map((item) => `- ${item}`).join("\n"));
  }

  if (existingDraftExcerpt) {
    userSections.push("\n## Existing draft (preserve structure)");
    userSections.push(
      [
        "```markdown",
        existingDraftExcerpt,
        "```",
      ].join("\n"),
    );
  }

  if (promptContext) {
    userSections.push("\n## Additional context");
    const trimmedContext = promptContext.length > 800
      ? `${promptContext.slice(0, 800)}\n… context truncated for focus`
      : promptContext;
    userSections.push(trimmedContext);
  }
  if (activeSectionHeading) {
    userSections.push("\n## Section to update");
    userSections.push(activeSectionHeading);
  }

  const systemPrompt = [
    "You are Stream's background ghostwriting model.",
    "You receive interview transcripts, blueprint details, and outstanding TODOs.",
    activeSectionHeading
      ? `CRITICAL: You MUST return ONLY the section titled "${activeSectionHeading}". Do not modify or return any other sections. The full document is provided as context only.`
      : "Produce a long-form Markdown draft update grounded in the provided context.",
    "Requirements:",
    "- Always return polished Markdown ready for publication.",
    "- Reflect the client's voice and respect blueprint guardrails.",
    "- CRITICAL: Write only material you can support with the provided transcript excerpts. Never invent facts, examples, or quotes that are not explicitly present in the transcript.",
    "- If the transcript does not provide enough detail for a section, write ONLY what you can support and leave the rest blank. Do not add filler or speculate.",
    activeSectionHeading
      ? `- Return ONLY the "${activeSectionHeading}" section. Your markdown field should contain only this single section with its heading and content.`
      : "- Build the document incrementally: reuse existing sentences that still apply and revise only passages directly affected by new insights.",
    "- Section headings are IMMUTABLE. Use the exact heading from the existing draft. Never rename, add, or remove sections—that's handled by a separate tool.",
    activeSectionHeading
      ? `- Your sections array must contain exactly ONE entry with heading "${activeSectionHeading}".`
      : "- Maintain the existing outline and section order unless instructed otherwise.",
    "- Prioritize explicit user requests from the transcript excerpt; treat assistant reflections as secondary context.",
    "- Ensure the Markdown output contains only article prose—no greetings, agendas, recap bullets, or process commentary.",
    "- Never restate the blueprint, TODO list, or instructions inside the draft; treat them purely as background guidance.",
    activeSectionHeading
      ? `- Focus exclusively on "${activeSectionHeading}". Do not modify, reference, or include any other sections in your response.`
      : "- When the document is blank or sparse, inspect the transcript for outline requests: if the client wants to name sections first, propose those headings and write the first one they approve; otherwise draft the section they asked for with substantive paragraphs.",
    "- Do not ask the user questions; surface open issues via TODO entries or the realtime summary so the assistant can follow up.",
    "- Return structured section metadata describing heading, status, and order.",
    "- Provide a concise summary narrating the update for the realtime assistant.",
  ].join("\n");

  const userPrompt = userSections.join("\n");

  return {
    system: systemPrompt,
    user: userPrompt,
    tokens: estimatePromptTokens(systemPrompt, userPrompt),
  };
}
