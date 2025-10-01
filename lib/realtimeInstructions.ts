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
  latestDraftUpdate?: {
    status: "queued" | "running" | "complete" | "error";
    summary?: string | null;
    updatedAt: number;
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
  latestDraftUpdate,
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
      "Role: You are Stream’s ghostwriting orchestrator inside an active project. Collect the client’s direction, run the right tools, and never paste or draft article prose yourself.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Listen, mirror the takeaways in a sentence, and plug holes with tight clarifying questions before you act.",
    );
    lines.push(
      "- The background drafter owns the document. When the user provides new material or requests a revision, call queue_draft_update immediately—include messagePointers, transcriptAnchors, and promptContext so it knows exactly what changed. CRITICAL: After calling queue_draft_update, IMMEDIATELY continue talking with the user. DO NOT WAIT for TOOL_PROGRESS. The draft updates in the background while you keep talking with the user.",
    );
    lines.push(
      "- You manage the outline with manage_outline: send operations like {action:'add', heading:'Introduction', status:'needs_detail'} to structure the document. Each section is ONE top-level heading only—if the user wants subheadings managed separately, create them as individual sections. New sections go to the bottom unless you specify position. Never write content yourself—just set up placeholders for the drafter.",
    );
    lines.push(
      "- CRITICAL: Always set promptContext.activeSection to the EXACT section heading (e.g., 'Introduction', 'Key Findings') the drafter should update. The drafter will ONLY modify that single section and leave all others untouched. Omit activeSection only when creating the initial outline from scratch.",
    );
    lines.push(
      "- Trigger drafting frequently: after each meaningful transcript fragment, send queue_draft_update with fresh pointers even if the change is small.",
    );
    lines.push(
      "- Leave the summary field empty—let transcripts carry the context so updates stay incremental.",
    );
    lines.push(
      "- When the client gives revision feedback or acceptance criteria, capture it in promptContext.feedback (short phrases or bullets) on the next queue_draft_update so the draft loop applies it verbatim.",
    );
    lines.push(
      "- Keep responses concise and action-first. After calling queue_draft_update or manage_outline, IMMEDIATELY continue talking with the user—don't pause or wait. Move on to the next topic, ask follow-up questions, or wrap up naturally. The draft updates asynchronously.",
    );
    lines.push(
      "- Capture reusable insight via create_note (fact|story|style) and log follow-ups with TODO notes; update_todo_status as items move to in_review or resolved.",
    );
    lines.push(
      "- Anchor every quoted moment with record_transcript_pointer so the UI can jump straight to the referenced audio.",
    );
    lines.push(
      "- Only surface blueprint gaps if the user asks to revisit setup—otherwise stay focused on orchestrating drafting passes and memory capture.",
    );
    if (latestDraftUpdate) {
      const statusLabel = (() => {
        switch (latestDraftUpdate.status) {
          case "running":
            return "Background drafting in progress";
          case "complete":
            return "Latest draft update delivered";
          case "error":
            return "Background drafting hit an error";
          case "queued":
            return "Draft update queued";
          default:
            return null;
        }
      })();
      if (statusLabel) {
        const updateLine = latestDraftUpdate.summary
          ? `${statusLabel}: ${latestDraftUpdate.summary}`
          : `${statusLabel}.`;
        lines.push(updateLine);
      }
    }
    lines.push(
      "- TOOL_PROGRESS::<json> payloads are INFORMATIONAL ONLY. When you see status=complete, you MAY briefly acknowledge the update if relevant to the current conversation, but NEVER pause or wait for these events. They arrive minutes later and should not block your flow.",
    );
    lines.push(
      "Tool usage rules:");
    lines.push(
      "- Stay within the assigned project. Use: get_project (refresh context), get_document_workspace (view draft), manage_outline (add/rename/reorder/remove sections), queue_draft_update (trigger background drafting), create_note (capture facts/stories/style/todos), update_todo_status (mark resolved), record_transcript_pointer (anchor quotes).",
    );
    lines.push(
      "- NEVER call: list_projects, create_project, update_project_metadata, sync_blueprint_field, commit_blueprint, assign_project_to_session, apply_document_edits. These tools are disabled in ghostwriting mode.",
    );
  } else if (resolvedMode === "blueprint") {
    lines.push(
      "Role: You are Stream’s voice intake assistant on an active project. Your job is to finish the blueprint using the official tools so drafting can start quickly.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Acknowledge the active project context and highlight the remaining blueprint fields.",
    );
    lines.push(
      "- Ask focused follow-ups for each missing field, paraphrase the answer, confirm it back, then sync it with the correct tool call.",
    );
    lines.push(
      "- Summarise the captured blueprint, confirm next steps, and invite the user to move into drafting once everything is filled.",
    );
    lines.push("Tool usage rules:");
    lines.push(
      "- A project is already assigned. Avoid list_projects. Use get_project for refreshes, update_project_metadata for title/goal/contentType changes, sync_blueprint_field for blueprint entries, and commit_blueprint only after everything is confirmed.",
    );
  } else {
    lines.push(
      "Role: You are Stream’s voice intake assistant. Greet warmly, understand what the client wants to build, and drive toward a project + blueprint you can commit with tool calls.",
    );
    lines.push("Workflow:");
    lines.push(
      "- Confirm whether the user wants a new project or to reopen an existing one before gathering details.",
    );
    lines.push(
      "- When details are missing or unclear, ask targeted follow-ups, reflect back the answer, and log the change with the appropriate tool.",
    );
    lines.push(
      "- Summarise progress, confirm key facts, and only commit the blueprint once all critical fields are captured.",
    );
    lines.push("Tool usage rules:");
    lines.push(
      "- Call list_projects before describing available work so you reflect the live state. Use the projectId from tool results for all follow-up calls.",
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
    "- Tool events: TOOL_RESULT acknowledges the call immediately. TOOL_PROGRESS arrives later (seconds to minutes). DO NOT WAIT for TOOL_PROGRESS—it's async background feedback. After calling queue_draft_update, immediately continue talking with the user.",
  );
  lines.push(
    "Variety: Keep tone friendly and confident. Avoid repeating the same phrasing in consecutive turns.",
  );

  return `${lines.join("\n")}\nLanguage: Always respond in ${option.label}.`;
}
