export type ContentType = "blog_post" | "article" | "biography";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  blog_post: "Blog post",
  article: "Article",
  biography: "Biography"
};

export const CONTENT_TYPE_DESCRIPTIONS: Record<ContentType, string> = {
  blog_post:
    "Great for timely insights, thought leadership, and building recurring readership around a central theme.",
  article:
    "Suited for in-depth reporting or analysis pieces that need a strong narrative spine and supporting research.",
  biography:
    "Captures a person’s life arc, signature stories, and turning points with a collaborative, interview-driven process."
};

export interface VoiceGuardrails {
  tone?: string;
  structure?: string;
  content?: string;
}

export interface ProjectBlueprintPayload {
  desiredOutcome: string;
  targetAudience: string;
  publishingPlan: string;
  timeline: string;
  materialsInventory: string;
  communicationPreferences: string;
  availability: string;
  budgetRange?: string;
  voiceGuardrails?: VoiceGuardrails;
}

export interface ProjectIntakeFormState {
  title: string;
  contentType: ContentType;
  desiredOutcome: string;
  targetAudience: string;
  publishingPlan: string;
  timeline: string;
  materialsInventory: string;
  communicationPreferences: string;
  availability: string;
  budgetRange: string;
  voiceTone: string;
  voiceStructure: string;
  voiceContent: string;
}

export interface ProjectSummaryRecord {
  _id: string;
  title: string;
  contentType: ContentType;
  goal?: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  latestBlueprint?: ProjectBlueprintSnapshot | null;
}

export interface ProjectBlueprintSnapshot extends ProjectBlueprintPayload {
  _id: string;
  projectId: string;
  createdAt: number;
}

export interface SessionSummaryRecord {
  _id: string;
  projectId: string;
  blueprintId?: string;
  startedAt: number;
  endedAt?: number;
  realtimeSessionId?: string;
  summary?: string;
  status: string;
}

export interface ProjectSummaryQueryResult {
  project: ProjectSummaryRecord;
  latestBlueprint: ProjectBlueprintSnapshot | null;
  blueprintHistory: ProjectBlueprintSnapshot[];
  sessions: SessionSummaryRecord[];
}

export interface ProjectMutationInput extends Record<string, unknown> {
  title: string;
  contentType: ContentType;
  goal?: string;
  status?: string;
}

export interface CreateProjectWithBlueprintArgs extends Record<string, unknown> {
  ownerExternalId: string;
  ownerName?: string;
  project: ProjectMutationInput;
  blueprint: ProjectBlueprintPayload;
}

export interface UpdateProjectBlueprintArgs extends Record<string, unknown> {
  projectId: string;
  project: ProjectMutationInput;
  blueprint: ProjectBlueprintPayload;
}

export interface CreateProjectWithBlueprintResult {
  projectId: string;
  blueprintId: string;
  sessionId: string;
}

export interface UpdateProjectBlueprintResult {
  projectId: string;
  blueprintId: string;
}
