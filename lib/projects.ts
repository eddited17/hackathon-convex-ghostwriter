import type { Doc } from "@/convex/_generated/dataModel";

export type ContentType = "blog_post" | "article" | "biography" | "sandbox";

export const CONTENT_TYPE_OPTIONS: Array<{
  value: ContentType;
  label: string;
  description: string;
}> = [
  {
    value: "blog_post",
    label: "Blog post",
    description: "Conversational, 800–1200 words, blog-ready",
  },
  {
    value: "article",
    label: "Article",
    description: "Reported or analytical piece with structured sections",
  },
  {
    value: "biography",
    label: "Biography",
    description: "Narrative profile highlighting milestones and stories",
  },
  {
    value: "sandbox",
    label: "Sandbox",
    description: "Internal testing project used for realtime diagnostics",
  },
];

export type BlueprintFieldKey =
  | "desiredOutcome"
  | "targetAudience"
  | "publishingPlan"
  | "timeline"
  | "materialsInventory"
  | "communicationPreferences"
  | "budgetRange"
  | "voiceGuardrails";

export type BlueprintFieldType = "text" | "longform" | "voice";

export interface BlueprintFieldDefinition {
  key: BlueprintFieldKey;
  label: string;
  helper: string;
  prompt: string;
  placeholder: string;
  type: BlueprintFieldType;
}

export const BLUEPRINT_FIELD_DEFINITIONS: BlueprintFieldDefinition[] = [
  {
    key: "desiredOutcome",
    label: "Desired outcome",
    helper: "What does success look like for this project?",
    prompt:
      "Capture the big win or change the user wants from this project (e.g., persuade investors, inspire a community).",
    placeholder: "e.g., A persuasive narrative that secures buy-in from new partners",
    type: "longform",
  },
  {
    key: "targetAudience",
    label: "Target audience",
    helper: "Who should this resonate with? Include demographic or mindset cues.",
    prompt:
      "Describe the core readers or listeners—their role, motivations, and what language will land best.",
    placeholder: "e.g., Mid-market COOs evaluating AI adoption for operations",
    type: "longform",
  },
  {
    key: "publishingPlan",
    label: "Publishing plan",
    helper: "Where will this appear and what format is expected?",
    prompt:
      "Note the primary channel (blog, LinkedIn, keynote) and any formatting expectations or cadence goals.",
    placeholder: "e.g., LinkedIn series over 4 weeks, cross-posted to company blog",
    type: "longform",
  },
  {
    key: "timeline",
    label: "Timeline",
    helper: "Key milestones, launch date, review moments.",
    prompt:
      "Summarize deadlines, launch windows, or checkpoints the assistant should plan around.",
    placeholder: "e.g., First draft by Oct 18, final approval Nov 2",
    type: "text",
  },
  {
    key: "materialsInventory",
    label: "Materials inventory",
    helper: "What research, notes, or interviews already exist?",
    prompt:
      "List any background material, existing drafts, transcripts, or links the assistant can lean on.",
    placeholder: "e.g., Deck from March earnings call, podcast interview transcript",
    type: "longform",
  },
  {
    key: "communicationPreferences",
    label: "Communication preferences",
    helper: "How should the assistant follow up? cadence, channel, working style.",
    prompt:
      "Capture how the user likes to collaborate—check-ins, tone when recapping, and review format.",
    placeholder: "e.g., Weekly Thursday check-ins via email with bullet recap",
    type: "longform",
  },
  {
    key: "budgetRange",
    label: "Budget range",
    helper: "Optional. Guardrails for external spend or ads.",
    prompt:
      "If relevant, note any spend ceilings or resource constraints tied to this project.",
    placeholder: "e.g., Up to $5k for external fact-checking and design polish",
    type: "text",
  },
  {
    key: "voiceGuardrails",
    label: "Voice guardrails",
    helper: "Tone, structure, and content boundaries to keep the writing aligned.",
    prompt:
      "Document tone words, structure cues, and any must-avoid topics so the draft mirrors the user’s voice.",
    placeholder: "Tone: candid and optimistic. Structure: short paragraphs, story-led intros.",
    type: "voice",
  },
];

export const BLUEPRINT_FIELD_ORDER: BlueprintFieldKey[] = BLUEPRINT_FIELD_DEFINITIONS.map(
  (definition) => definition.key,
);

export interface VoiceGuardrails {
  tone?: string;
  structure?: string;
  content?: string;
}

export type BlueprintDocument = Doc<"projectBlueprints">;

export const blueprintFieldDefinition = (key: BlueprintFieldKey) =>
  BLUEPRINT_FIELD_DEFINITIONS.find((definition) => definition.key === key);

export const blueprintFieldHasValue = (
  blueprint: BlueprintDocument | null | undefined,
  key: BlueprintFieldKey,
) => {
  if (!blueprint) return false;
  if (key === "voiceGuardrails") {
    const voice = blueprint.voiceGuardrails;
    if (!voice) return false;
    return Boolean(voice.tone || voice.structure || voice.content);
  }
  const value = blueprint[key];
  if (typeof value !== "string") return false;
  return value.trim().length > 0;
};

export const normalizeTextValue = (value: string | null | undefined) =>
  value?.trim() ?? "";

export const voiceGuardrailValue = (
  blueprint: BlueprintDocument | null | undefined,
): VoiceGuardrails => {
  return (
    blueprint?.voiceGuardrails ?? {
      tone: "",
      structure: "",
      content: "",
    }
  );
};
