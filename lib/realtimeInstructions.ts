import { findLanguageOption, type LanguageOption } from "./languages";

export type SessionInstructionMode =
  | "intake"
  | "blueprint"
  | "ghostwriting";

export interface SessionInstructionOptions {
  language: LanguageOption | string;
  hasProjectContext: boolean;
  mode?: SessionInstructionMode;
  blueprintSummary?: {
    missingFields: string[];
    status?: string;
  };
  draftingSnapshot?: {
    todoCount?: number;
    sections?: Array<{
      title: string;
      status: "drafting" | "needs_detail" | "complete";
    }>;
  };
}

const describeMissingFields = (missingFields: string[] | undefined) => {
  if (!missingFields || missingFields.length === 0) return null;
  if (missingFields.length === 1) {
    return missingFields[0];
  }
  const [last, ...rest] = [...missingFields].reverse();
  return `${rest.reverse().join(", ")} and ${last}`;
};

type DraftSnapshotSection = {
  title: string;
  status: "drafting" | "needs_detail" | "complete";
};

const describeSectionSnapshot = (
  sections: DraftSnapshotSection[] | undefined,
) => {
  if (!sections || sections.length === 0) return null;
  const grouped = sections.reduce<Record<string, string[]>>(
    (accumulator, section) => {
      const bucket = accumulator[section.status] ?? [];
      bucket.push(section.title);
      accumulator[section.status] = bucket;
      return accumulator;
    },
    {},
  );

  const order: Array<keyof typeof grouped> = [
    "needs_detail",
    "drafting",
    "complete",
  ];

  const parts: string[] = [];
  for (const key of order) {
    const labels = grouped[key];
    if (!labels || labels.length === 0) continue;
    const labelText = labels.length === 1 ? labels[0] : labels.join(", ");
    switch (key) {
      case "needs_detail":
        parts.push(`needs detail on ${labelText}`);
        break;
      case "drafting":
        parts.push(`actively drafting ${labelText}`);
        break;
      case "complete":
        parts.push(`complete: ${labelText}`);
        break;
      default:
        break;
    }
  }

  return parts.length > 0 ? parts.join("; ") : null;
};

export function buildSessionInstructions({
  language,
  hasProjectContext,
  mode,
  blueprintSummary,
  draftingSnapshot,
}: SessionInstructionOptions) {
  const option = typeof language === "string" ? findLanguageOption(language) : language;
  const resolvedMode: SessionInstructionMode = mode
    ? mode
    : hasProjectContext
      ? "blueprint"
      : "intake";

  const lines: string[] = [];

  if (resolvedMode === "ghostwriting") {
    lines.push(
      "Role: You are Stream’s Ghostwriting co-pilot working inside an active project. Interview like a pro while steering the live draft.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Lead the curiosity loop: paraphrase the user, press for proof points and anecdotes, and confirm understanding against the committed blueprint.",
    );
    lines.push(
      "- Maintain the drafting loop: after meaningful insight, queue or apply whole-document edits via apply_document_edits and summarise what changed.",
    );
    lines.push(
      "- Run the memory loop: capture facts/stories/style cues with create_note (noteType=fact|story|style) and log outstanding items as TODO notes.",
    );
    lines.push(
      "- Whenever you reference a transcript moment, call record_transcript_pointer so UI links can jump back to the quote.",
    );
    lines.push(
      "- Keep TODOs fresh: use create_note with noteType=todo for new follow-ups and update_todo_status to mark them resolved or in_review when addressed.",
    );
    lines.push(
      "Tool usage rules:");
    lines.push(
      "- Stay within the assigned project. Use get_project for context refresh, apply_document_edits for Markdown updates, record_transcript_pointer for anchoring, create_note for memory capture, and update_todo_status when closing loops.",
    );
    lines.push(
      "- Do not call list_projects or create_project in this mode; the project is already locked.",
    );
  } else if (resolvedMode === "blueprint") {
    lines.push(
      "Role: You are Stream’s Voice Intake assistant working inside an already-selected project. Close out the blueprint so drafting can begin.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Acknowledge the active project context and remind the user which blueprint items remain.",
    );
    lines.push(
      "- Ask focused follow-ups for each missing field, paraphrase the answer, and confirm before moving on.",
    );
    lines.push(
      "- Summarise the filled blueprint and invite the user to continue into drafting once everything is captured.",
    );
    lines.push("Tool usage rules:");
    lines.push(
      "- A project is already assigned. Avoid list_projects. Use get_project for refreshes, update_project_metadata for title/goal/contentType changes, sync_blueprint_field for blueprint entries, and commit_blueprint when everything is confirmed.",
    );
  } else {
    lines.push(
      "Role: You are Stream’s Voice Intake assistant. Greet warmly, gather project intent, and keep the session moving toward a usable blueprint.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Confirm whether the user wants a new project or to reopen an existing one before diving into details.",
    );
    lines.push(
      "- When details are missing or unclear, ask targeted follow-ups and reflect back what you heard.",
    );
    lines.push(
      "- Summarise progress and confirm key facts before committing the blueprint.",
    );
    lines.push("Tool usage rules:");
    lines.push(
      "- Call list_projects before describing available work so you reflect the live state. Use the projectId from tool results when making follow-up calls.",
    );
    lines.push(
      "- Create and update project records via create_project, update_project_metadata, sync_blueprint_field, and commit_blueprint—never promise changes without the tool call.",
    );
  }

  if (resolvedMode === "ghostwriting") {
    const todoCount = draftingSnapshot?.todoCount ?? 0;
    const todoLine = todoCount > 0 ? `${todoCount} open TODO${todoCount === 1 ? "" : "s"}` : "no active TODOs";
    const sectionSummary = describeSectionSnapshot(draftingSnapshot?.sections);
    lines.push(
      `Progress cues: ${todoLine}${sectionSummary ? `; sections: ${sectionSummary}` : ""}. Keep users informed as you close gaps.`,
    );
  } else if (resolvedMode === "blueprint") {
    const missing = describeMissingFields(blueprintSummary?.missingFields);
    if (missing) {
      lines.push(`Blueprint gaps remaining: ${missing}.`);
    }
  }

  lines.push(
    "- Never fabricate tool results; wait for the TOOL_RESULT::<json> system message after every call before continuing.",
  );
  lines.push(
    "Variety: Keep tone friendly and confident. Avoid repeating the same phrasing in consecutive turns.",
  );

  return `${lines.join("\n")}\nLanguage: Always respond in ${option.label}.`;
}
