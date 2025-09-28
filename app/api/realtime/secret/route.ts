import { NextResponse } from "next/server";

import {
  DEFAULT_LANGUAGE_OPTION,
  findLanguageOption,
} from "@/lib/languages";
import { buildSessionInstructions } from "@/lib/realtimeInstructions";

type NoiseReduction = "default" | "near_field" | "far_field";

type SecretRequest = {
  noiseReduction?: NoiseReduction;
  voice?: string;
  language?: string;
  hasProjectContext?: boolean;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const DEFAULT_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";

const TOOL_DEFINITIONS = [
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
  {
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
];

const isValidNoiseReduction = (
  value: unknown,
): value is NoiseReduction =>
  value === "default" || value === "near_field" || value === "far_field";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY not configured",
      },
      { status: 500 },
    );
  }

  const payload: SecretRequest = {};
  try {
    const body = await request.json();
    if (isValidNoiseReduction(body?.noiseReduction)) {
      payload.noiseReduction = body.noiseReduction;
    }
    if (typeof body?.voice === "string") {
      payload.voice = body.voice;
    }
    if (typeof body?.language === "string") {
      payload.language = body.language;
    }
    if (typeof body?.hasProjectContext === "boolean") {
      payload.hasProjectContext = body.hasProjectContext;
    }
  } catch (parseError) {
    // Ignore malformed JSON; fall back to defaults.
  }

  const selectedLanguage = findLanguageOption(
    payload.language ?? DEFAULT_LANGUAGE_OPTION.value,
  );
  const sessionConfig: Record<string, unknown> = {
    type: "realtime",
    model: DEFAULT_MODEL,
    audio: {
      output: {
        voice: payload.voice ?? DEFAULT_VOICE,
      },
    },
    instructions: buildSessionInstructions({
      language: selectedLanguage,
      hasProjectContext: Boolean(payload.hasProjectContext),
    }),
    tools: TOOL_DEFINITIONS,
  };

  if (payload.noiseReduction && payload.noiseReduction !== "default") {
    (sessionConfig.audio as Record<string, unknown>).input = {
      noise_reduction: { type: payload.noiseReduction },
    };
  }

  const requestBody: Record<string, unknown> = {
    session: sessionConfig,
  };

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        {
          error: "Failed to create realtime client secret",
          detail,
        },
        { status: response.status },
      );
    }

    const secret = await response.json();
    return NextResponse.json(secret);
  } catch (error) {
    console.error("Failed to request realtime client secret", error);
    return NextResponse.json(
      {
        error: "Unexpected error requesting realtime client secret",
      },
      { status: 500 },
    );
  }
}
