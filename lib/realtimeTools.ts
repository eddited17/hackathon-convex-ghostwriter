import type { SessionInstructionMode } from "./realtimeInstructions";

export type RealtimeToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const NOTE_TYPE_ENUM = [
  "fact",
  "story",
  "style",
  "voice",
  "todo",
  "summary",
] as const;

const TODO_STATUS_ENUM = ["open", "in_review", "resolved"] as const;

const SECTION_STATUS_ENUM = [
  "drafting",
  "needs_detail",
  "complete",
] as const;

const TOOL_DEFINITIONS: Record<string, RealtimeToolDefinition> = {
  list_projects: {
    type: "function",
    name: "list_projects",
    description:
      "Return projects owned by the sandbox user (newest first). Each item includes `projectId`, full `project` metadata, optional `blueprint`, and a `summary.missingFields` array. Use the returned `projectId` when calling other project tools.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of projects to return (default 20).",
        },
      },
      additionalProperties: false,
    },
  },
  get_project: {
    type: "function",
    name: "get_project",
    description:
      "Load a single project and blueprint so you can continue with the latest data. Response mirrors `list_projects` with `projectId`, `project`, `blueprint`, and `summary` fields.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Convex document id for the project (e.g. project_...).",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  create_project: {
    type: "function",
    name: "create_project",
    description:
      "Create a brand-new project record and accompanying blueprint draft. Response mirrors `list_projects` so you can continue using the new `projectId` immediately.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Display name for the project.",
        },
        contentType: {
          type: "string",
          description:
            "Requested deliverable type (article, blog, newsletter, etc.).",
        },
        goal: {
          type: "string",
          description:
            "Optional short description of the user’s high-level objective.",
        },
      },
      required: ["title", "contentType"],
      additionalProperties: false,
    },
  },
  update_project_metadata: {
    type: "function",
    name: "update_project_metadata",
    description:
      "Update core project fields as the user clarifies title, content type, goal, or status. Returns the updated project bundle with `projectId`, `project`, `blueprint`, and `summary`.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id to update.",
        },
        title: {
          type: "string",
          description: "New project title, if changed.",
        },
        contentType: {
          type: "string",
          description: "New deliverable type.",
        },
        goal: {
          type: "string",
          description: "Updated goal statement.",
        },
        status: {
          type: "string",
          enum: ["draft", "active", "archived", "intake"],
          description: "Optional status override for the project lifecycle.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  sync_blueprint_field: {
    type: "function",
    name: "sync_blueprint_field",
    description:
      "Write an updated value for a single blueprint intake field after confirming details with the user. Returns the refreshed project bundle so you can confirm the change.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose blueprint should be patched.",
        },
        field: {
          type: "string",
          enum: [
            "desiredOutcome",
            "targetAudience",
            "publishingPlan",
            "timeline",
            "materialsInventory",
            "communicationPreferences",
            "budgetRange",
            "voiceGuardrails",
          ],
          description: "Blueprint field identifier to update.",
        },
        value: {
          description:
            "New value for the field. Use an object with tone/structure/content for voiceGuardrails; otherwise pass a string.",
          anyOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                tone: { type: "string" },
                structure: { type: "string" },
                content: { type: "string" },
              },
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
        transcriptId: {
          type: "string",
          description:
            "Optional transcript fragment identifier that produced this value.",
        },
      },
      required: ["projectId", "field"],
      additionalProperties: false,
    },
  },
  commit_blueprint: {
    type: "function",
    name: "commit_blueprint",
    description:
      "Mark the blueprint as committed once all required information is captured and ready for drafting. Returns the committed project bundle.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose blueprint should be committed.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  assign_project_to_session: {
    type: "function",
    name: "assign_project_to_session",
    description:
      "Associate the current realtime session with the selected project so future transcript events are tagged correctly.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id that should become active for the session.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  list_notes: {
    type: "function",
    name: "list_notes",
    description:
      "Fetch the most recent notes captured for a project so you can reference prior facts, stories, style cues, and TODOs.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose notes should be returned.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "Maximum number of notes to return (default 20).",
        },
      },
      additionalProperties: false,
    },
  },
  list_todos: {
    type: "function",
    name: "list_todos",
    description:
      "List TODO entries for the project so you can highlight outstanding follow-ups.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose TODOs should be listed.",
        },
      },
      additionalProperties: false,
    },
  },
  create_note: {
    type: "function",
    name: "create_note",
    description:
      "Capture a structured note tied to the current conversation (fact, story, style cue, TODO, etc.) with optional transcript anchors.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id that should own the note.",
        },
        noteType: {
          type: "string",
          enum: NOTE_TYPE_ENUM,
          description: "Classification for the note (fact, story, style, voice, todo, summary).",
        },
        content: {
          type: "string",
          description: "Human-readable content of the note.",
        },
        messageIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional transcript message ids already persisted.",
        },
        transcriptIds: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional realtime transcript fragment ids to map to messageIds before persistence.",
        },
        messageId: {
          type: "string",
          description: "Single message id anchor.",
        },
        transcriptId: {
          type: "string",
          description: "Single transcript fragment anchor.",
        },
        confidence: {
          type: "number",
          description: "Confidence score for the captured fact (0-1).",
        },
        resolved: {
          type: "boolean",
          description: "Mark TODO-style notes as already resolved.",
        },
        todoStatus: {
          type: "string",
          enum: TODO_STATUS_ENUM,
          description: "Initial status when the noteType is todo.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  update_todo_status: {
    type: "function",
    name: "update_todo_status",
    description:
      "Change the status of an existing TODO note (open, in_review, resolved).",
    parameters: {
      type: "object",
      properties: {
        todoId: {
          type: "string",
          description: "TODO document id being updated.",
        },
        status: {
          type: "string",
          enum: TODO_STATUS_ENUM,
          description: "New status for the TODO.",
        },
      },
      required: ["todoId", "status"],
      additionalProperties: false,
    },
  },
  record_transcript_pointer: {
    type: "function",
    name: "record_transcript_pointer",
    description:
      "Link a Convex message to the current transcript pointer so UI can jump straight to the quoted moment.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose transcript pointer should be recorded.",
        },
        messageId: {
          type: "string",
          description: "Existing message id to anchor.",
        },
        transcriptId: {
          type: "string",
          description: "Realtime transcript fragment id that maps to a message.",
        },
      },
      additionalProperties: false,
    },
  },
  get_document_workspace: {
    type: "function",
    name: "get_document_workspace",
    description:
      "Retrieve the project’s live drafting workspace, including Markdown, sections, and progress metadata.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose draft should be fetched.",
        },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
  },
  apply_document_edits: {
    type: "function",
    name: "apply_document_edits",
    description:
      "Persist a whole-document Markdown update plus ordered section metadata so the live draft stays in sync across clients.",
    parameters: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "Project id whose draft should be updated.",
        },
        markdown: {
          type: "string",
          description: "Full Markdown content representing the latest draft.",
        },
        sections: {
          type: "array",
          description: "Ordered section payload describing outline and status.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string" },
              content: { type: "string" },
              status: { type: "string", enum: SECTION_STATUS_ENUM },
              order: { type: "number" },
            },
            required: ["heading", "content"],
            additionalProperties: false,
          },
        },
        summary: {
          type: "string",
          description:
            "High-quality synopsis of the current draft. Provide the full summary; do not truncate for length.",
        },
      },
      required: ["projectId", "markdown"],
      additionalProperties: false,
    },
  },
};

const MODE_VALUES: SessionInstructionMode[] = [
  "intake",
  "blueprint",
  "ghostwriting",
];

const TOOLSET_BY_MODE: Record<SessionInstructionMode, string[]> = {
  intake: [
    "list_projects",
    "get_project",
    "create_project",
    "update_project_metadata",
    "sync_blueprint_field",
    "commit_blueprint",
    "assign_project_to_session",
  ],
  blueprint: [
    "get_project",
    "update_project_metadata",
    "sync_blueprint_field",
    "commit_blueprint",
    "assign_project_to_session",
    "list_notes",
    "list_todos",
    "create_note",
    "update_todo_status",
    "record_transcript_pointer",
    "get_document_workspace",
  ],
  ghostwriting: [
    "get_project",
    "update_project_metadata",
    "sync_blueprint_field",
    "list_notes",
    "list_todos",
    "create_note",
    "update_todo_status",
    "record_transcript_pointer",
    "get_document_workspace",
    "apply_document_edits",
  ],
};

const serializeToolList = (names: string[]) =>
  names.map((name) => TOOL_DEFINITIONS[name]).filter(Boolean);

export function getToolsForMode(mode: SessionInstructionMode) {
  return serializeToolList(TOOLSET_BY_MODE[mode] ?? TOOLSET_BY_MODE.intake);
}

export function getInitialToolList({
  mode,
  hasProjectContext,
}: {
  mode?: SessionInstructionMode;
  hasProjectContext?: boolean;
} = {}) {
  if (mode && MODE_VALUES.includes(mode)) {
    return getToolsForMode(mode);
  }
  if (hasProjectContext) {
    return getToolsForMode("blueprint");
  }
  return getToolsForMode("intake");
}

export function isSessionInstructionMode(
  value: unknown,
): value is SessionInstructionMode {
  return typeof value === "string" && (MODE_VALUES as string[]).includes(value);
}

export function toolsetSignature(mode: SessionInstructionMode) {
  const tools = getToolsForMode(mode);
  return JSON.stringify(tools);
}
