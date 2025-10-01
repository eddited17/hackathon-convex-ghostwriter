"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";

import {
  AudioLevelMonitor,
  DEFAULT_TURN_DETECTION_PRESET,
  NOISE_REDUCTION_OPTIONS,
  NoiseReductionProfile,
  TranscriptionFragment,
  TURN_DETECTION_OPTIONS,
  TurnDetectionConfig,
  TurnDetectionPreset,
  VoiceActivityState,
  applySinkId,
  createPeerConnection,
  getTurnDetectionConfig,
} from "@/lib/realtimeAudio";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_LANGUAGE_OPTION,
  LANGUAGE_OPTIONS,
  findLanguageOption,
  type LanguageOption,
} from "@/lib/languages";
import {
  buildSessionInstructions,
  type SessionInstructionMode,
  type SessionInstructionOptions,
} from "@/lib/realtimeInstructions";
import { getToolsForMode } from "@/lib/realtimeTools";
import {
  REQUIRED_BLUEPRINT_FIELDS,
  blueprintFieldHasValue,
} from "@/lib/projects";

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export type SessionStatus =
  | "idle"
  | "requesting-permissions"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

type ConnectionEvent = {
  id: string;
  message: string;
  timestamp: number;
};

type ServerEventLog = {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
};

type SessionBootstrap = {
  sessionId: Id<"sessions">;
  projectId: Id<"projects"> | null;
  startedAt: number;
  language: string | null;
};

export type StartSessionOptions = {
  projectId?: Id<"projects">;
  deferProject?: boolean;
};

type ServerMessage = {
  type?: string;
  event_id?: string;
  session?: { id?: string; model?: string };
  response_id?: string;
  response?: {
    id?: string;
    model?: string;
    output?: unknown;
    required_action?: unknown;
    required_actions?: unknown;
  };
  item_id?: string;
  item?: {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
    response_id?: string;
  };
  delta?: unknown;
  transcript?: unknown;
  text?: unknown;
  output_text?: unknown;
  participant?: string;
  required_action?: unknown;
  required_actions?: unknown;
};

type ManualMessageOptions = {
  skipPersist?: boolean;
};

export interface RealtimeSessionState {
  status: SessionStatus;
  statusMessage: string | null;
  isConnected: boolean;
  startSession: (options?: StartSessionOptions) => Promise<void>;
  stopSession: (reason?: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  selectedInputDeviceId?: string;
  selectInputDevice: (deviceId: string) => Promise<void>;
  selectedOutputDeviceId?: string;
  selectOutputDevice: (deviceId: string) => Promise<void>;
  noiseReduction: NoiseReductionProfile;
  setNoiseReduction: (profile: NoiseReductionProfile) => void;
  turnDetection: TurnDetectionConfig;
  turnDetectionPreset: TurnDetectionPreset;
  setTurnDetectionPreset: (preset: TurnDetectionPreset) => void;
  language: string;
  setLanguage: (language: string) => Promise<void>;
  languageOptions: LanguageOption[];
  microphoneLevel: number;
  assistantLevel: number;
  voiceActivity: VoiceActivityState;
  isMuted: boolean;
  toggleMute: () => void;
  transcripts: TranscriptionFragment[];
  partialUserTranscript: string | null;
  partialAssistantTranscript: string | null;
  connectionLog: ConnectionEvent[];
  serverEvents: ServerEventLog[];
  draftProgress: DraftProgressState;
  error: string | null;
  sendTextMessage: (message: string, options?: ManualMessageOptions) => Promise<void>;
  registerAudioElement: (element: HTMLAudioElement | null) => void;
  sessionRecord: SessionBootstrap | null;
  assignProjectToSession: (projectId: Id<"projects">) => Promise<void>;
  resolveMessageId: (transcriptId: string) => Id<"messages"> | null;
  ingestProjects: (
    entries: Array<{ project: ProjectDoc; blueprint: BlueprintDoc | null }>,
  ) => void;
  instructionContext: InstructionContext;
  updateInstructionContext: (updates: Partial<InstructionContext>) => void;
  resetInstructionContext: () => void;
}

const extractText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");
    return joined || null;
  }
  if (typeof value === "object") {
    if (
      "text" in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).text === "string"
    ) {
      return (value as Record<string, unknown>).text as string;
    }
    if (
      "transcript" in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).transcript === "string"
    ) {
      return (value as Record<string, unknown>).transcript as string;
    }
    if ("content" in (value as Record<string, unknown>)) {
      return extractText((value as Record<string, unknown>).content);
    }
  }
  return null;
};

const sanitizeTranscript = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim() ?? "";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type ToolCallArguments = Record<string, unknown>;

type ToolCallInvocation = {
  id: string;
  name: string;
  arguments?: ToolCallArguments;
  rawArguments?: unknown;
  responseId?: string | null;
};

type InstructionContext = {
  mode: SessionInstructionMode;
  blueprintSummary?: SessionInstructionOptions["blueprintSummary"];
  draftingSnapshot?: SessionInstructionOptions["draftingSnapshot"];
  latestDraftUpdate?: {
    status: Exclude<DraftProgressStateStatus, "idle">;
    summary: string | null;
    updatedAt: number;
  } | null;
};

type DraftProgressStateStatus =
  | "idle"
  | "queued"
  | "running"
  | "complete"
  | "error";

type DraftProgressState = {
  status: DraftProgressStateStatus;
  jobId: string | null;
  summary: string | null;
  error: string | null;
  updatedAt: number | null;
};

type NoteTypeValue = "fact" | "story" | "style" | "voice" | "todo" | "summary";
type TodoStatusValue = "open" | "in_review" | "resolved";
type DocumentSectionStatus = "drafting" | "needs_detail" | "complete";

const normalizeToolName = (value: string): string =>
  value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();

const TOOLS_ALLOWING_EMPTY_ARGS = new Set([
  "list_projects",
  "queue_draft_update",
  "get_project",
  "get_document_workspace",
].map(normalizeToolName));

const parseToolCallArguments = (
  value: unknown,
): ToolCallArguments | undefined => {
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(value);
      return isRecord(parsed) ? (parsed as ToolCallArguments) : {};
    } catch (parseError) {
      console.warn("Failed to parse tool arguments", parseError);
      return undefined;
    }
  }
  if (isRecord(value)) {
    return value as ToolCallArguments;
  }
  return undefined;
};

const collectToolCallInvocationsFromValue = (
  value: unknown,
  inheritedResponseId: string | null,
): ToolCallInvocation[] => {
  const collected: ToolCallInvocation[] = [];
  const visited = new WeakSet<object>();

  const visit = (node: unknown, responseContext: string | null) => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, responseContext);
      }
      return;
    }

    if (!isRecord(node)) return;

    const reference = node as Record<string, unknown>;
    if (visited.has(reference)) return;
    visited.add(reference);

    const responseId =
      typeof reference.response_id === "string"
        ? (reference.response_id as string)
        : responseContext;

    const type =
      typeof reference.type === "string"
        ? (reference.type as string)
        : typeof reference.kind === "string"
          ? (reference.kind as string)
          : null;

    const name =
      typeof reference.name === "string"
        ? (reference.name as string)
        : typeof reference.tool_name === "string"
          ? (reference.tool_name as string)
          : null;

    const id =
      typeof reference.id === "string"
        ? (reference.id as string)
        : typeof reference.tool_call_id === "string"
          ? (reference.tool_call_id as string)
          : null;

    if ((type === "tool_call" || name) && id && name) {
      let argsSource: unknown =
        reference.arguments ??
        reference.args ??
        (isRecord(reference.input) ? reference.input : undefined);

      if (typeof argsSource === "undefined" && isRecord(reference.parameters)) {
        argsSource = reference.parameters.arguments ?? reference.parameters;
      }

      const args = parseToolCallArguments(argsSource);
      collected.push({
        id,
        name,
        arguments: args,
        responseId,
        rawArguments: argsSource,
      });
    }

    if (Array.isArray(reference.tool_calls)) {
      for (const entry of reference.tool_calls) {
        visit(entry, responseId);
      }
    }

    for (const [key, child] of Object.entries(reference)) {
      if (key === "tool_calls") continue;
      visit(child, responseId);
    }
  };

  visit(value, inheritedResponseId);
  return collected;
};

const extractToolCallsFromResponseOutput = (
  output: unknown,
  responseId: string | null,
): ToolCallInvocation[] => {
  if (typeof output === "undefined") return [];
  return collectToolCallInvocationsFromValue(output, responseId);
};

const collectToolCallInvocations = (event: ServerMessage): ToolCallInvocation[] => {
  const responseId =
    typeof event.response?.id === "string"
      ? event.response.id
      : typeof event.response_id === "string"
        ? event.response_id
        : null;

  const unique = new Map<string, ToolCallInvocation>();

  const push = (calls: ToolCallInvocation[]) => {
    for (const call of calls) {
      if (!call.id) continue;
      if (!unique.has(call.id)) {
        unique.set(call.id, call);
      }
    }
  };

  push(extractToolCallsFromResponseOutput(event.response?.output, responseId));

  push(
    collectToolCallInvocationsFromValue(
      event.response?.required_action,
      responseId,
    ),
  );

  push(
    collectToolCallInvocationsFromValue(
      event.response?.required_actions,
      responseId,
    ),
  );

  push(collectToolCallInvocationsFromValue(event.required_action, responseId));

  push(collectToolCallInvocationsFromValue(event.required_actions, responseId));

  const itemResponseId =
    isRecord(event.item) && typeof event.item.response_id === "string"
      ? event.item.response_id
      : responseId;

  push(collectToolCallInvocationsFromValue(event.item, itemResponseId));

  const deltaResponseId =
    isRecord(event.delta) && typeof event.delta.response_id === "string"
      ? event.delta.response_id
      : responseId;

  push(collectToolCallInvocationsFromValue(event.delta, deltaResponseId));

  return Array.from(unique.values());
};

const safeJsonStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, (_key, inner) => {
      if (typeof inner === "bigint") {
        return Number(inner);
      }
      return inner;
    });
  } catch (stringifyError) {
    console.warn("Failed to stringify tool payload", stringifyError);
    return '"[unserializable]"';
  }
};

const clampInteger = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const integer = Math.floor(value);
  return Math.min(maximum, Math.max(minimum, integer));
};

const coerceOptionalString = (
  value: unknown,
): string | null | undefined => {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const flattened = value
      .map((entry) => coerceOptionalString(entry))
      .filter((entry): entry is string => typeof entry === "string");
    if (flattened.length === 0) {
      return null;
    }
    return flattened.join(", ");
  }
  if (isRecord(value)) {
    return safeJsonStringify(value);
  }
  return undefined;
};

const coerceStringArray = (value: unknown): string[] | null => {
  if (typeof value === "undefined" || value === null) return null;
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => coerceOptionalString(entry))
      .filter((entry): entry is string => typeof entry === "string");
    return entries.length > 0 ? entries : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const entries = parsed
          .map((entry) => coerceOptionalString(entry))
          .filter((entry): entry is string => typeof entry === "string");
        return entries.length > 0 ? entries : null;
      }
    } catch (error) {
      // ignore JSON parse error; treat as raw string
    }
    return [trimmed];
  }
  return null;
};

const coercePromptContext = (value: unknown): unknown => {
  if (typeof value === "undefined" || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return trimmed;
    }
  }
  if (typeof value === "object") {
    return value;
  }
  return value;
};

const coerceIdString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return null;
};

const NOTE_TYPE_VALUES = new Set<NoteTypeValue>([
  "fact",
  "story",
  "style",
  "voice",
  "todo",
  "summary",
]);

const TODO_STATUS_VALUES = new Set<TodoStatusValue>([
  "open",
  "in_review",
  "resolved",
]);

const SECTION_STATUS_VALUES = new Set<DocumentSectionStatus>([
  "drafting",
  "needs_detail",
  "complete",
]);

const coerceNoteTypeValue = (value: unknown): NoteTypeValue | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as NoteTypeValue;
  return NOTE_TYPE_VALUES.has(normalized) ? normalized : null;
};

const coerceTodoStatusValue = (value: unknown): TodoStatusValue | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase() as TodoStatusValue;
  return TODO_STATUS_VALUES.has(normalized) ? normalized : null;
};

const coerceSectionStatusValue = (
  value: unknown,
): DocumentSectionStatus | undefined => {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase() as DocumentSectionStatus;
  return SECTION_STATUS_VALUES.has(normalized) ? normalized : undefined;
};

type DocumentEditSectionPayload = {
  heading: string;
  content: string;
  status?: DocumentSectionStatus;
  order?: number;
};

const coerceDocumentSectionsPayload = (
  value: unknown,
): DocumentEditSectionPayload[] => {
  if (!Array.isArray(value)) return [];
  const sections: DocumentEditSectionPayload[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const headingValue = coerceOptionalString(entry.heading);
    if (typeof headingValue !== "string" || headingValue.length === 0) {
      continue;
    }
    const contentValue = coerceOptionalString(entry.content);
    const statusValue = coerceSectionStatusValue(entry.status);
    const orderValue =
      typeof entry.order === "number" && Number.isFinite(entry.order)
        ? entry.order
        : undefined;
    sections.push({
      heading: headingValue,
      content: typeof contentValue === "string" ? contentValue : "",
      status: statusValue,
      order: orderValue,
    });
  }
  return sections;
};

const findIdInValue = (
  value: unknown,
  visited: WeakSet<object>,
): string | null => {
  const direct = coerceIdString(value);
  if (direct) return direct;

  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = findIdInValue(entry, visited);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  if (isRecord(value)) {
    return extractIdFromRecord(value, visited);
  }

  return null;
};

const extractIdFromRecord = (
  record: Record<string, unknown>,
  visited: WeakSet<object>,
): string | null => {
  if (visited.has(record)) return null;
  visited.add(record);

  const idKeys = [
    "projectId",
    "project_id",
    "projectID",
    "id",
    "_id",
    "documentId",
    "docId",
    "valueId",
    "value_id",
  ];

  for (const key of idKeys) {
    if (!(key in record)) continue;
    const candidate = findIdInValue(record[key], visited);
    if (candidate) return candidate;
  }

  const containerKeys = [
    "project",
    "selection",
    "selected",
    "target",
    "data",
    "payload",
    "item",
    "value",
    "values",
    "option",
    "options",
  ];

  for (const key of containerKeys) {
    if (!(key in record)) continue;
    const candidate = findIdInValue(record[key], visited);
    if (candidate) return candidate;
  }

  for (const value of Object.values(record)) {
    const candidate = findIdInValue(value, visited);
    if (candidate) return candidate;
  }

  return null;
};

type ProjectDoc = Doc<"projects">;
type BlueprintDoc = Doc<"projectBlueprints">;

type ProjectToolResult = {
  projectId: string;
  project?: ProjectDoc;
  blueprint?: BlueprintDoc | null;
  summary?: {
    status: string;
    missingFields: string[];
    updatedAt?: number;
  };
};

const summarizeBlueprint = (blueprint: BlueprintDoc | null | undefined) => {
  if (!blueprint) {
    return {
      status: "missing",
      missingFields: [...REQUIRED_BLUEPRINT_FIELDS],
    };
  }

  const missingFields = REQUIRED_BLUEPRINT_FIELDS.filter(
    (field) => !blueprintFieldHasValue(blueprint, field),
  );

  return {
    status: blueprint.status ?? "draft",
    missingFields,
    updatedAt: blueprint.updatedAt,
  };
};

const makeProjectToolResult = ({
  project,
  blueprint,
  fallbackId,
}: {
  project?: ProjectDoc | null;
  blueprint?: BlueprintDoc | null;
  fallbackId?: string | Id<"projects"> | null;
}): ProjectToolResult => {
  const projectId =
    project?._id ??
    (typeof fallbackId === "string" ? fallbackId : fallbackId ?? undefined) ??
    (blueprint?.projectId as string | undefined);

  if (!projectId) {
    throw new Error("Unable to determine projectId for tool result");
  }

  return {
    projectId,
    project: project ?? undefined,
    blueprint: typeof blueprint === "undefined" ? undefined : blueprint ?? null,
    summary:
      typeof blueprint === "undefined"
        ? undefined
        : summarizeBlueprint(blueprint ?? null),
  };
};

const makeProjectListResult = (
  entries: Array<{ project: ProjectDoc; blueprint: BlueprintDoc | null }>,
): ProjectToolResult[] => entries.map((entry) => makeProjectToolResult(entry));

type VoiceGuardrailsValue = {
  tone?: string;
  structure?: string;
  content?: string;
};

const coerceVoiceGuardrailsValue = (
  value: unknown,
): VoiceGuardrailsValue | null | undefined => {
  if (typeof value === "undefined") return undefined;
  if (value === null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? { tone: trimmed } : null;
  }
  if (!isRecord(value)) return null;

  const guardrails: VoiceGuardrailsValue = {};
  if (typeof value.tone === "string" && value.tone.trim()) {
    guardrails.tone = value.tone.trim();
  }
  if (typeof value.structure === "string" && value.structure.trim()) {
    guardrails.structure = value.structure.trim();
  }
  if (typeof value.content === "string" && value.content.trim()) {
    guardrails.content = value.content.trim();
  }

  return Object.keys(guardrails).length > 0 ? guardrails : null;
};

export function useRealtimeSession(): RealtimeSessionState {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>();
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] =
    useState<string>();
  const [noiseReduction, setNoiseReduction] =
    useState<NoiseReductionProfile>("near_field");
  const [turnDetectionPreset, setTurnDetectionPreset] =
    useState<TurnDetectionPreset>(DEFAULT_TURN_DETECTION_PRESET);
  const turnDetection = useMemo(
    () => getTurnDetectionConfig(turnDetectionPreset),
    [turnDetectionPreset],
  );
  const [language, setLanguageState] = useState<string>(
    DEFAULT_LANGUAGE_OPTION.value,
  );
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivityState>({
    user: false,
    assistant: false,
  });
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptionFragment[]>([]);
  const [partialUserTranscript, setPartialUserTranscript] =
    useState<string | null>(null);
  const [partialAssistantTranscript, setPartialAssistantTranscript] =
    useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<ConnectionEvent[]>([]);
  const [serverEvents, setServerEvents] = useState<ServerEventLog[]>([]);
  const [draftProgress, setDraftProgress] = useState<DraftProgressState>({
    status: "idle",
    jobId: null,
    summary: null,
    error: null,
    updatedAt: null,
  });
  const [sessionRecord, setSessionRecord] =
    useState<SessionBootstrap | null>(null);
  const [instructionContext, setInstructionContextState] =
    useState<InstructionContext>({ mode: "intake" });

  const convex = useConvex();
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micMonitorRef = useRef<AudioLevelMonitor | null>(null);
  const assistantMonitorRef = useRef<AudioLevelMonitor | null>(null);
  const userFragmentsRef = useRef<Map<string, string>>(new Map());
  const assistantFragmentsRef = useRef<Map<string, string>>(new Map());
  const persistedMessageIdsRef = useRef<Set<string>>(new Set());
  const transcriptMessageIdsRef = useRef<Map<string, Id<"messages">>>(new Map());
  const handledToolCallIdsRef = useRef<Set<string>>(new Set());
  const lastProgressEventRef = useRef<string | null>(null);
  const completeOnceRef = useRef(false);
  const lastInstructionRef = useRef<string | null>(null);
  const lastToolSignatureRef = useRef<string | null>(null);
  const lastProjectResultsRef = useRef<ProjectToolResult[]>([]);
  const sessionIdRef = useRef<Id<"sessions"> | null>(null);
  const projectIdRef = useRef<Id<"projects"> | null>(null);

  const registerMessagePointer = useCallback(
    (pointer: string | null | undefined, messageId: Id<"messages">) => {
      if (!pointer) return;
      const trimmed = pointer.trim();
      if (!trimmed) return;
      transcriptMessageIdsRef.current.set(trimmed, messageId);
    },
    [],
  );

  const ingestProjects = useCallback(
    (entries: Array<{ project: ProjectDoc; blueprint: BlueprintDoc | null }>) => {
      console.log(
        "[realtime] ingestProjects",
        entries.map((entry, index) => ({
          index,
          projectId: entry.project._id,
          title: entry.project.title,
          status: entry.project.status,
        })),
      );
      lastProjectResultsRef.current = makeProjectListResult(entries);
    },
    [],
  );

  const updateInstructionContext = useCallback(
    (updates: Partial<InstructionContext>) => {
      setInstructionContextState((previous) => ({
        ...previous,
        ...updates,
      }));
    },
    [],
  );

  const resetInstructionContext = useCallback(() => {
    setInstructionContextState({ mode: "intake" });
    setDraftProgress({
      status: "idle",
      jobId: null,
      summary: null,
      error: null,
      updatedAt: null,
    });
    lastProgressEventRef.current = null;
  }, [setDraftProgress]);

  const createSessionMutation = useMutation(api.sessions.createSession);
  const updateRealtimeMutation = useMutation(
    api.sessions.updateRealtimeSessionId,
  );
  const completeSessionMutation = useMutation(api.sessions.completeSession);
  const setNoiseProfileMutation = useMutation(api.sessions.setNoiseProfile);
  const assignProjectMutation = useMutation(
    api.sessions.assignProjectContext,
  );
  const appendMessageMutation = useMutation(api.messages.appendMessage);
  const setLanguagePreferenceMutation = useMutation(
    api.sessions.setLanguagePreference,
  );
  const createProjectToolMutation = useMutation(api.projects.createProject);
  const updateProjectMetadataMutation = useMutation(
    api.projects.updateProjectMetadata,
  );
  const syncBlueprintFieldMutation = useMutation(
    api.projects.syncBlueprintField,
  );
  const commitBlueprintMutation = useMutation(api.projects.commitBlueprint);
  const recordTranscriptPointerMutation = useMutation(
    api.projects.recordTranscriptPointer,
  );
  const createNoteMutation = useMutation(api.notes.createNote);
  const updateTodoStatusMutation = useMutation(api.todos.updateStatus);
  const applyDocumentEditsMutation = useMutation(api.documents.applyEdits);
  const enqueueDraftUpdateMutation = useMutation(
    api.documents.enqueueDraftUpdate,
  );
  const saveTranscriptChunkMutation = useMutation(
    api.projects.saveTranscriptChunk,
  );
  const finalizeProjectTranscriptMutation = useMutation(
    api.projects.finalizeTranscript,
  );

const resolveProjectId = useCallback(
  (args?: ToolCallArguments): string => {
    const source = args ?? {};
    const visited = new WeakSet<object>();
    const direct = findIdInValue(source, visited);
    if (direct) {
      console.log("[realtime] resolveProjectId direct", { args: source, projectId: direct });
      return direct;
    }

      const numericKeys = [
        "index",
        "projectIndex",
        "selectionIndex",
        "choice",
        "option",
      ];
      for (const key of numericKeys) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          const index = Math.max(0, Math.floor(value));
          const candidate = lastProjectResultsRef.current[index];
          if (candidate) {
            console.log("[realtime] resolveProjectId index match", {
              key,
              value,
              projectId: candidate.projectId,
              project: candidate.project?.title,
            });
            return candidate.projectId;
          }
        }
      }

      const stringKeys = [
        "title",
        "projectTitle",
        "name",
        "projectName",
      ];
      for (const key of stringKeys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) {
          const lowered = value.trim().toLowerCase();
          const titleMatch = lastProjectResultsRef.current.find((entry) => {
            const title = entry.project?.title?.toLowerCase();
            return title ? title === lowered || title.includes(lowered) : false;
          });
          if (titleMatch) {
            console.log("[realtime] resolveProjectId title match", {
              key,
              value,
              projectId: titleMatch.projectId,
              project: titleMatch.project?.title,
            });
            return titleMatch.projectId;
          }
        }
      }

      const fallbackProjectId = sessionRecord?.projectId ?? projectIdRef.current;
      if (fallbackProjectId) {
        // Normal case: use active session project (no logging needed)
        return fallbackProjectId;
      }

      if (lastProjectResultsRef.current.length > 0) {
        const [first] = lastProjectResultsRef.current;
        console.log("[realtime] resolveProjectId defaulting to first cached project", {
          projectId: first.projectId,
          project: first.project?.title,
        });
        return first.projectId;
      }

      console.warn("Tool call missing explicit projectId", source, {
        lastProjects: lastProjectResultsRef.current,
        sessionProjectId: sessionRecord?.projectId ?? null,
      });
      throw new Error("projectId is required");
    },
    [sessionRecord?.projectId],
  );

  const logConnection = useCallback((message: string) => {
    setConnectionLog((previous) => {
      const entry: ConnectionEvent = {
        id: randomId(),
        message,
        timestamp: Date.now(),
      };
      const next = [...previous, entry];
      return next.slice(-40);
    });
  }, []);

  const resetMonitors = useCallback(() => {
    micMonitorRef.current?.disconnect();
    assistantMonitorRef.current?.disconnect();
    micMonitorRef.current = null;
    assistantMonitorRef.current = null;
    setMicrophoneLevel(0);
    setAssistantLevel(0);
  }, []);

  const resetFragments = useCallback(() => {
    userFragmentsRef.current.clear();
    assistantFragmentsRef.current.clear();
    persistedMessageIdsRef.current.clear();
    transcriptMessageIdsRef.current.clear();
    setPartialUserTranscript(null);
    setPartialAssistantTranscript(null);
  }, []);

  const registerAudioElement = useCallback(
    (element: HTMLAudioElement | null) => {
      audioElementRef.current = element;
      if (element) {
        element.autoplay = true;
        element.muted = false;
        element.setAttribute("playsinline", "true");
      }
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const outputs = devices.filter(
        (device) => device.kind === "audiooutput",
      );

      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (!selectedInputDeviceId && inputs.length > 0) {
        const defaultInput = inputs.find(
          (d) => d.deviceId === "default" || d.label.toLowerCase().includes("default")
        ) || inputs[0]!;
        setSelectedInputDeviceId(defaultInput.deviceId);
      }

      if (!selectedOutputDeviceId && outputs.length > 0) {
        const defaultOutput = outputs.find(
          (d) => d.deviceId === "default" || d.label.toLowerCase().includes("default")
        ) || outputs[0]!;
        setSelectedOutputDeviceId(defaultOutput.deviceId);
      }
    } catch (deviceError) {
      console.error("Failed to enumerate devices", deviceError);
    }
  }, [selectedInputDeviceId, selectedOutputDeviceId]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator?.mediaDevices?.addEventListener) return;
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [refreshDevices]);

  const finalizeTranscript = useCallback(
    async (
      speaker: "user" | "assistant",
      key: string,
      rawText: string | null | undefined,
      options?: {
        itemId?: string | null;
        itemType?: string | null;
        itemStatus?: string | null;
        previousItemId?: string | null;
        payload?: unknown;
        createdAt?: number;
      },
    ) => {
      const text = sanitizeTranscript(rawText);
      if (!text || persistedMessageIdsRef.current.has(key)) {
        return;
      }

      const message: TranscriptionFragment = {
        id: key,
        speaker,
        text,
        timestamp: Date.now(),
      };

      persistedMessageIdsRef.current.add(key);
      setTranscripts((previous) => {
        const filtered = previous.filter((entry) => entry.id !== key);
        const next = [...filtered, message];
        next.sort((a, b) => a.timestamp - b.timestamp);
        return next;
      });

      if (speaker === "user") {
        setPartialUserTranscript(null);
        setVoiceActivity((current) => ({ ...current, user: false }));
      } else {
        setPartialAssistantTranscript(null);
        setVoiceActivity((current) => ({ ...current, assistant: false }));
      }

      let savedMessageId: Id<"messages"> | null = null;
      const conversationPayload = options?.payload;
      const conversationText = sanitizeTranscript(
        extractText(conversationPayload) ?? rawText,
      );
      const sessionIdValue = sessionRecord?.sessionId ?? sessionIdRef.current;
      if (sessionIdValue) {
        try {
          const persisted = await appendMessageMutation({
            sessionId: sessionIdValue,
            speaker,
            transcript: text,
            timestamp: message.timestamp,
            eventId: key,
            itemId: options?.itemId ?? key,
            role: options?.itemType ?? speaker,
            text: conversationText || text,
          });
          if (persisted?.messageId) {
            registerMessagePointer(key, persisted.messageId);
            const hyphenIndex = key.indexOf("-");
            if (hyphenIndex !== -1 && hyphenIndex < key.length - 1) {
              registerMessagePointer(
                key.slice(hyphenIndex + 1),
                persisted.messageId,
              );
            }
            registerMessagePointer(persisted.messageId, persisted.messageId);
            savedMessageId = persisted.messageId;
          }
        } catch (persistError) {
          console.error("Failed to persist transcript", persistError);
        }
      }

      const projectIdValue = sessionRecord?.projectId ?? projectIdRef.current;
      if (
        projectIdValue &&
        sessionIdValue &&
        (options?.itemId || options?.payload)
      ) {
        try {
          await saveTranscriptChunkMutation({
            projectId: projectIdValue,
            sessionId: sessionIdValue,
            item: {
              id: options?.itemId ?? key,
              type: options?.itemType ?? undefined,
              status: options?.itemStatus ?? undefined,
              role: speaker,
              previousItemId: options?.previousItemId ?? undefined,
              payload: conversationPayload,
              createdAt: options?.createdAt ?? message.timestamp,
              messageId: savedMessageId ?? undefined,
              messageKey: key,
              text: conversationText || text || undefined,
            },
          });
        } catch (chunkError) {
          console.error("Failed to persist transcript chunk", chunkError, {
            itemId: options?.itemId ?? key,
          });
        }
      }
    },
    [
      appendMessageMutation,
      registerMessagePointer,
      saveTranscriptChunkMutation,
      sessionRecord,
    ],
  );

  const resolveMessagePointer = useCallback(
    (value: string | null | undefined): Id<"messages"> | null => {
      if (!value) return null;
      const trimmed = value.trim();
      if (!trimmed) return null;

      const candidates = new Set<string>([trimmed]);
      const hyphenIndex = trimmed.indexOf("-");
      if (hyphenIndex > 0 && hyphenIndex < trimmed.length - 1) {
        candidates.add(trimmed.slice(hyphenIndex + 1));
      }
      if (!trimmed.startsWith("assistant-")) {
        candidates.add(`assistant-${trimmed}`);
      }
      if (!trimmed.startsWith("user-")) {
        candidates.add(`user-${trimmed}`);
      }

      for (const candidate of candidates) {
        const mapped = transcriptMessageIdsRef.current.get(candidate);
        if (mapped) {
          return mapped;
        }
      }

      // CRITICAL: Only return IDs we've explicitly mapped
      // Do NOT guess - transcript IDs look like Convex IDs but aren't valid
      return null;
    },
    [],
  );


  const tearDownConnection = useCallback(async () => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    resetMonitors();
    resetFragments();
    setVoiceActivity({ user: false, assistant: false });
    setIsMuted(false);
  }, [resetFragments, resetMonitors]);


  const stopSession = useCallback(
    async (reason?: string) => {
      if (status === "idle") return;
      await tearDownConnection();
      if (reason) {
        setStatusMessage(reason);
      }
      if (sessionRecord?.sessionId && !completeOnceRef.current) {
        try {
          await completeSessionMutation({
            sessionId: sessionRecord.sessionId,
          });
          completeOnceRef.current = true;
        } catch (completionError) {
          console.error("Failed to mark session complete", completionError);
        }
      }
      const sessionIdValue = sessionRecord?.sessionId ?? sessionIdRef.current;
      const projectIdValue = sessionRecord?.projectId ?? projectIdRef.current;
      if (projectIdValue && sessionIdValue) {
        try {
          await finalizeProjectTranscriptMutation({
            projectId: projectIdValue,
            sessionId: sessionIdValue,
          });
        } catch (finalizeError) {
          console.error(
            "Failed to finalize project transcript",
            finalizeError,
          );
        }
      }
      setSessionRecord(null);
      projectIdRef.current = null;
      lastInstructionRef.current = null;
      lastToolSignatureRef.current = null;
      setStatus("ended");
    },
    [
      completeSessionMutation,
      finalizeProjectTranscriptMutation,
      sessionRecord,
      status,
      tearDownConnection,
    ],
  );

  const stopSessionRef = useRef(stopSession);
  useEffect(() => {
    stopSessionRef.current = stopSession;
  }, [stopSession]);

  useEffect(() => {
    return () => {
      const cleanup = stopSessionRef.current;
      void cleanup();
    };
  }, []);

  const selectInputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedInputDeviceId(deviceId);
      if (!peerConnectionRef.current) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        const [newTrack] = newStream.getAudioTracks();
        const sender = peerConnectionRef.current
          .getSenders()
          .find((candidate) => candidate.track?.kind === "audio");
        if (sender && newTrack) {
          await sender.replaceTrack(newTrack);
        }
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = newStream;
        if (micMonitorRef.current) {
          micMonitorRef.current.connect(newStream);
        }
        logConnection("Switched microphone input");
      } catch (deviceError) {
        console.error("Failed to switch microphone", deviceError);
        setError("Unable to access selected microphone");
      }
    },
    [logConnection],
  );

  const selectOutputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedOutputDeviceId(deviceId);
      if (audioElementRef.current) {
        await applySinkId(audioElementRef.current, deviceId);
        logConnection("Routed audio to selected output");
      }
    },
    [logConnection],
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      console.warn("[realtime] Cannot toggle mute: no active stream");
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.warn("[realtime] Cannot toggle mute: no audio tracks");
      return;
    }

    const nextMuted = !isMuted;
    audioTracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    logConnection(nextMuted ? "Microphone muted" : "Microphone unmuted");
  }, [isMuted, logConnection]);

  const assignProjectToSession = useCallback(
    async (projectId: Id<"projects">) => {
      const sessionId = sessionRecord?.sessionId ?? sessionIdRef.current;
      if (!sessionId) {
        console.warn("[realtime] assignProjectToSession missing sessionId", {
          projectId,
          sessionRecord,
        });
        return;
      }
      try {
        console.log("[realtime] assignProjectToSession start", {
          projectId,
          sessionId,
        });
        await assignProjectMutation({
          sessionId,
          projectId,
        });
        projectIdRef.current = projectId;
        setSessionRecord((previous) =>
          previous
            ? {
                ...previous,
                projectId,
              }
            : {
                sessionId,
                projectId,
                startedAt: Date.now(),
                language,
              },
        );
        sessionIdRef.current = sessionId;
        console.log("[realtime] assignProjectToSession set", projectId);

        try {
          const projectBundle = await convex.query(api.projects.getProject, {
            projectId: projectId as Id<"projects">,
          });
          if (projectBundle?.project) {
            ingestProjects([
              {
                project: projectBundle.project,
                blueprint: projectBundle.blueprint ?? null,
              },
            ]);
          }
        } catch (projectError) {
          console.error(
            "[realtime] assignProjectToSession getProject failed",
            projectError,
          );
        }
      } catch (assignError) {
        console.error("Failed to assign project to session", assignError);
        throw assignError;
      }
    },
    [assignProjectMutation, convex, ingestProjects, language, sessionRecord],
  );

  const resolveMessageId = useCallback(
    (transcriptId: string) => resolveMessagePointer(transcriptId) ?? null,
    [resolveMessagePointer],
  );

  const waitForDataChannelOpen = useCallback(async () => {
    const channel = dataChannelRef.current;
    if (!channel) {
      throw new Error("Realtime connection not ready");
    }
    if (channel.readyState === "open") return;
    if (channel.readyState === "closing" || channel.readyState === "closed") {
      throw new Error("Realtime connection closed");
    }

    await new Promise<void>((resolve, reject) => {
      let timeoutId: number | undefined;

      const cleanup = () => {
        if (timeoutId !== undefined) {
          window.clearTimeout(timeoutId);
          timeoutId = undefined;
        }
        channel.removeEventListener("open", handleOpen);
        channel.removeEventListener("error", handleError);
        channel.removeEventListener("close", handleClose);
      };

      const handleOpen = () => {
        cleanup();
        resolve();
      };

      const handleError = (event: Event) => {
        cleanup();
        if (event instanceof ErrorEvent && event.message) {
          reject(new Error(event.message));
          return;
        }
        reject(new Error("Realtime data channel error"));
      };

      const handleClose = () => {
        cleanup();
        reject(new Error("Realtime connection closed"));
      };

      timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for realtime connection"));
      }, 5000);

      channel.addEventListener("open", handleOpen, { once: true });
      channel.addEventListener("error", handleError, { once: true });
      channel.addEventListener("close", handleClose, { once: true });
    });
  }, []);

  const setLanguage = useCallback(
    async (nextLanguage: string) => {
      const normalized = nextLanguage.trim();
      if (!normalized) return;
      setLanguageState(normalized);
      lastInstructionRef.current = null;
      setSessionRecord((previous) =>
        previous
          ? {
              ...previous,
              language: normalized,
            }
          : previous,
      );
      if (sessionRecord?.sessionId) {
        try {
          await setLanguagePreferenceMutation({
            sessionId: sessionRecord.sessionId,
            language: normalized,
          });
        } catch (mutationError) {
          console.error("Failed to persist language preference", mutationError);
        }
      }
    },
    [sessionRecord?.sessionId, setLanguagePreferenceMutation],
  );

  const submitToolResult = useCallback(
    async (payload: {
      tool: string;
      tool_call_id: string;
      response_id?: string | null;
      success: boolean;
      result?: unknown;
      error?: string;
    }): Promise<boolean> => {
      try {
        await waitForDataChannelOpen();
        const channel = dataChannelRef.current;
        if (!channel || channel.readyState !== "open") {
          throw new Error("Realtime connection not ready");
        }

        const outputPayload = {
          tool: payload.tool,
          tool_call_id: payload.tool_call_id,
          success: payload.success,
          result: payload.success ? payload.result ?? null : undefined,
          error: payload.success ? undefined : payload.error ?? "Unknown tool error",
        };
        const serialized = safeJsonStringify(outputPayload);

        if (payload.response_id) {
          channel.send(
            JSON.stringify({
              type: "response.submit_tool_outputs",
              response_id: payload.response_id,
              tool_outputs: [
                {
                  tool_call_id: payload.tool_call_id,
                  output: serialized,
                },
              ],
            }),
          );
        } else {
          console.log(
            `Deferring tool output for ${payload.tool} until response_id is available`,
            payload,
          );
          return false;
        }

        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: `TOOL_RESULT::${serialized}`,
                },
              ],
            },
          }),
        );
        channel.send(JSON.stringify({ type: "response.create" }));
      } catch (sendError) {
        console.error("Failed to submit tool result", sendError);
        return false;
      }
      return true;
    },
    [waitForDataChannelOpen],
  );

  const pushSystemMessage = useCallback(
    async (text: string) => {
      try {
        await waitForDataChannelOpen();
      } catch (connectionError) {
        console.error(
          "[realtime] failed to push system message (channel unavailable)",
          connectionError,
          { text },
        );
        return;
      }

      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open") {
        console.warn("[realtime] system message skipped (channel closed)", { text });
        return;
      }

      try {
        channel.send(
          JSON.stringify({
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "system",
              content: [
                {
                  type: "input_text",
                  text,
                },
              ],
            },
          }),
        );
      } catch (sendError) {
        console.error("[realtime] failed to send system message", sendError, {
          text,
        });
      }
    },
    [waitForDataChannelOpen],
  );

  const emitSystemJsonMessage = useCallback(
    async (tag: string, payload: Record<string, unknown>) => {
      const serialized = safeJsonStringify(payload);
      await pushSystemMessage(`${tag}::${serialized}`);
    },
    [pushSystemMessage],
  );

  const handleToolProgressEvent = useCallback(
    (payload: unknown) => {
      if (!payload || typeof payload !== "object") return;
      const record = payload as Record<string, unknown>;
      if (
        typeof record.tool === "string" &&
        record.tool !== "queue_draft_update"
      ) {
        return;
      }
      const summaryText = coerceOptionalString(record.summary) ?? null;
      const statusRaw = coerceOptionalString(record.status)?.toLowerCase() ?? "queued";
      const status: DraftProgressStateStatus = [
        "queued",
        "running",
        "complete",
        "error",
      ].includes(statusRaw)
        ? (statusRaw as DraftProgressStateStatus)
        : "queued";
      const jobIdValue = coerceOptionalString(record.jobId);
      const timestamp =
        typeof record.timestamp === "number" && Number.isFinite(record.timestamp)
          ? record.timestamp
          : Date.now();
      const errorText =
        status === "error" ? coerceOptionalString(record.error) ?? null : null;
      const eventKey = `${jobIdValue ?? "unknown"}:${status}:${summaryText ?? ""}:${timestamp}`;
      if (lastProgressEventRef.current === eventKey) {
        return;
      }
      lastProgressEventRef.current = eventKey;

      setDraftProgress({
        status,
        jobId: jobIdValue ?? null,
        summary: summaryText,
        error: errorText,
        updatedAt: timestamp,
      });

      const instructionStatus: Exclude<DraftProgressStateStatus, "idle"> =
        status === "idle" ? "queued" : (status as Exclude<DraftProgressStateStatus, "idle">);

      updateInstructionContext({
        latestDraftUpdate: {
          status: instructionStatus,
          summary: summaryText,
          updatedAt: timestamp,
        },
      });
    },
    [setDraftProgress, updateInstructionContext],
  );

  const handleToolCall = useCallback(
    async ({
      id: toolCallId,
      name,
      arguments: toolArgs,
      responseId,
      rawArguments,
    }: ToolCallInvocation): Promise<boolean> => {
      logConnection(`Tool call requested: ${name}`);

      const args = toolArgs ?? {};
      const argCount = Object.keys(args).length;

      const toolName = normalizeToolName(name);

      if (!TOOLS_ALLOWING_EMPTY_ARGS.has(toolName) && argCount === 0) {
        console.log(`[realtime] tool:${name} awaiting arguments`, {
          rawArguments,
        });
        return false;
      }

      if (toolName === "create_project") {
        const titleReady = typeof args.title === "string" && args.title.trim().length > 0;
        const typeReady =
          typeof args.contentType === "string" && args.contentType.trim().length > 0;
        if (!titleReady || !typeReady) {
          console.log("[realtime] tool:create_project awaiting title/contentType", {
            rawArguments,
            args,
          });
          return false;
        }
      }

      if (!responseId) {
        console.log(`[realtime] tool:${name} awaiting response_id`, {
          rawArguments,
          args,
        });
        return false;
      }

      const allowedTools = getToolsForMode(instructionContext.mode);
      const allowedToolNames = new Set(
        allowedTools.map((tool) => normalizeToolName(tool.name)),
      );

      if (!allowedToolNames.has(toolName)) {
        console.error(
          `[realtime] TOOL BLOCKED: ${name} in ${instructionContext.mode} mode`,
          {
            tool: name,
            mode: instructionContext.mode,
            allowedTools: allowedTools.map((t) => t.name),
            args,
          },
        );
        const reason =
          instructionContext.mode === "ghostwriting"
            ? `Tool "${name}" is disabled in ghostwriting mode. Use manage_outline for structure changes and queue_draft_update for content.`
            : `Tool "${name}" is unavailable in ${instructionContext.mode} mode.`;
        const submitted = await submitToolResult({
          tool: name,
          tool_call_id: toolCallId,
          response_id: responseId,
          success: false,
          error: reason,
        });
        return submitted;
      }

      let result: unknown = null;
      let success = false;
      let errorMessage: string | undefined;

      const requireId = (value: unknown, field: string) => {
        if (typeof value !== "string" || !value.trim()) {
          throw new Error(`${field} is required`);
        }
        return value.trim();
      };

      try {
        switch (toolName) {
          case "list_projects": {
            console.log("[realtime] tool:list_projects", {
              args,
              mode: instructionContext.mode,
              WARNING: instructionContext.mode === "ghostwriting"
                ? "list_projects should NOT be called in ghostwriting mode!"
                : null,
            });
            const limit = clampInteger(args.limit, 20, 1, 50);
            const entries = await convex.query(api.projects.listProjects, {
              limit,
            });
            const listResult = makeProjectListResult(entries);
            lastProjectResultsRef.current = listResult;
            result = listResult;
            success = true;
            break;
          }
          case "get_project": {
            console.log("[realtime] tool:get_project", { args, rawArguments });
            const projectId = resolveProjectId(args);
            const entry = await convex.query(api.projects.getProject, {
              projectId: projectId as Id<"projects">,
            });
            if (entry) {
              const projectResult = makeProjectToolResult({
                project: entry.project,
                blueprint: entry.blueprint,
              });
              lastProjectResultsRef.current = [projectResult];
              result = projectResult;
            } else {
              result = null;
            }
            success = true;
            break;
          }
          case "create_project": {
            console.log("[realtime] tool:create_project", { args });
            const title = requireId(args.title, "title");
            const contentType = requireId(args.contentType, "contentType");
            const goalValue = coerceOptionalString(args.goal);
            const created = await createProjectToolMutation({
              title,
              contentType,
              goal: typeof goalValue === "string" ? goalValue : undefined,
            });
            const projectResult = makeProjectToolResult(created);
            lastProjectResultsRef.current = [projectResult];
            result = projectResult;
            success = true;
            break;
          }
          case "update_project_metadata": {
            console.log("[realtime] tool:update_project_metadata", { args });
            const projectId = resolveProjectId(args);
            const updates: Parameters<
              typeof updateProjectMetadataMutation
            >[0] = {
              projectId: projectId as Id<"projects">,
            };
            const titleValue = coerceOptionalString(args.title);
            if (typeof titleValue === "string") {
              updates.title = titleValue;
            }
            const contentTypeValue = coerceOptionalString(args.contentType);
            if (typeof contentTypeValue === "string") {
              updates.contentType = contentTypeValue;
            }
            const goalValue = coerceOptionalString(args.goal);
            if (typeof goalValue === "string") {
              updates.goal = goalValue;
            }
            const statusValue =
              typeof args.status === "string" ? args.status.trim() : undefined;
            if (
              statusValue &&
              ["draft", "active", "archived", "intake"].includes(statusValue)
            ) {
              updates.status = statusValue as Parameters<
                typeof updateProjectMetadataMutation
              >[0]["status"];
            }
            await updateProjectMetadataMutation(updates);
            const entry = await convex.query(api.projects.getProject, {
              projectId: projectId as Id<"projects">,
            });
            if (entry) {
              const projectResult = makeProjectToolResult({
                project: entry.project,
                blueprint: entry.blueprint,
              });
              lastProjectResultsRef.current = [projectResult];
              result = projectResult;
            } else {
              result = { projectId };
            }
            success = true;
            break;
          }
          case "sync_blueprint_field": {
            console.log("[realtime] tool:sync_blueprint_field", { args });
            const projectId = resolveProjectId(args);
            const field = requireId(args.field, "field");
            let value: string | VoiceGuardrailsValue | null;
            if (field === "voiceGuardrails") {
              const guardrails = coerceVoiceGuardrailsValue(args.value);
              value = typeof guardrails === "undefined" ? null : guardrails;
            } else {
              const stringValue = coerceOptionalString(args.value);
            if (typeof stringValue === "undefined") {
              throw new Error("value is required for sync_blueprint_field");
            }
            value = stringValue ?? null;
            }
            const messagePointer = coerceIdString(args.messageId);
            let messageId =
              messagePointer
                ? resolveMessagePointer(messagePointer) ?? undefined
                : undefined;
            if (!messageId) {
              const transcriptPointer = coerceIdString(args.transcriptId);
              if (transcriptPointer) {
                messageId = resolveMessagePointer(transcriptPointer) ?? undefined;
              }
            }

            const syncArgs: Parameters<typeof syncBlueprintFieldMutation>[0] = {
              projectId: projectId as Id<"projects">,
              field: field as Parameters<
                typeof syncBlueprintFieldMutation
              >[0]["field"],
              value: value as Parameters<typeof syncBlueprintFieldMutation>[0]["value"],
            };
            if (sessionRecord?.sessionId) {
              syncArgs.sessionId = sessionRecord.sessionId;
            }
            if (messageId) {
              syncArgs.messageId = messageId;
            }
            await syncBlueprintFieldMutation(syncArgs);
            const entry = await convex.query(api.projects.getProject, {
              projectId: projectId as Id<"projects">,
            });
            if (entry) {
              const projectResult = makeProjectToolResult({
                project: entry.project,
                blueprint: entry.blueprint,
              });
              lastProjectResultsRef.current = [projectResult];
              result = projectResult;
            } else {
              result = { projectId };
            }
            success = true;
            break;
          }
          case "commit_blueprint": {
            console.log("[realtime] tool:commit_blueprint", { args });
            const projectId = resolveProjectId(args);
            const committed = await commitBlueprintMutation({
              projectId: projectId as Id<"projects">,
              sessionId: sessionRecord?.sessionId,
            });
            const projectResult = makeProjectToolResult(committed);
            lastProjectResultsRef.current = [projectResult];
            result = projectResult;
            success = true;
            break;
          }
          case "assign_project_to_session": {
            console.log("[realtime] tool:assign_project_to_session", { args });
            const projectId = resolveProjectId(args) as Id<"projects">;
            await assignProjectToSession(projectId);
            result = { projectId };
            success = true;
            break;
          }
          case "list_notes": {
            console.log("[realtime] tool:list_notes", { args });
            const projectId = resolveProjectId(args);
            const limitValue =
              typeof args.limit === "number"
                ? clampInteger(args.limit, 20, 1, 100)
                : undefined;
            const notes = await convex.query(api.notes.listForProject, {
              projectId: projectId as Id<"projects">,
              limit: limitValue,
            });
            result = notes;
            success = true;
            break;
          }
          case "list_todos": {
            console.log("[realtime] tool:list_todos", { args });
            const projectId = resolveProjectId(args);
            const todos = await convex.query(api.todos.listForProject, {
              projectId: projectId as Id<"projects">,
            });
            result = todos;
            success = true;
            break;
          }
          case "create_note": {
            console.log("[realtime] tool:create_note", { args });
            const projectId = resolveProjectId(args) as Id<"projects">;
            const noteTypeValue = coerceNoteTypeValue(
              (args.noteType ?? args.type) as unknown,
            );
            if (!noteTypeValue) {
              throw new Error(
                "noteType must be one of fact, story, style, voice, todo, summary",
              );
            }
            const contentValue = coerceOptionalString(args.content);
            if (typeof contentValue !== "string") {
              throw new Error("content is required for create_note");
            }

            // GRACEFUL TRANSCRIPT ANCHORING:
            // Only include message IDs that are explicitly mapped
            // If transcript IDs haven't been persisted yet, skip them silently
            const messageIds = new Set<Id<"messages">>();
            const unresolvedIds: string[] = [];

            const pushMessageId = (value: unknown) => {
              const idString = coerceIdString(value);
              if (idString) {
                const mapped = resolveMessagePointer(idString);
                if (mapped) {
                  messageIds.add(mapped);
                } else {
                  unresolvedIds.push(idString);
                }
              }
            };

            if (Array.isArray(args.messageIds)) {
              for (const entry of args.messageIds as unknown[]) {
                pushMessageId(entry);
              }
            }
            pushMessageId(args.messageId);

            const mapTranscript = (raw: unknown) => {
              const idString = coerceIdString(raw);
              if (!idString) return;
              const mapped = resolveMessagePointer(idString);
              if (mapped) {
                messageIds.add(mapped);
              } else {
                unresolvedIds.push(idString);
              }
            };

            if (Array.isArray(args.transcriptIds)) {
              for (const entry of args.transcriptIds as unknown[]) {
                mapTranscript(entry);
              }
            }
            mapTranscript(args.transcriptId);

            // Log warning but don't fail - transcript IDs are async
            if (unresolvedIds.length > 0) {
              console.warn(
                `[realtime] create_note: ${unresolvedIds.length} transcript IDs not yet persisted (will be linked later)`,
                { unresolvedIds: unresolvedIds.slice(0, 3) },
              );
            }

            const confidenceValue =
              typeof args.confidence === "number" &&
              Number.isFinite(args.confidence)
                ? args.confidence
                : undefined;
            const resolvedFlag =
              typeof args.resolved === "boolean" ? args.resolved : undefined;
            const todoStatusValue = coerceTodoStatusValue(
              args.todoStatus ?? args.status,
            );

            // Only pass sourceMessageIds if we have valid ones
            const created = await createNoteMutation({
              projectId,
              sessionId:
                sessionRecord?.sessionId ?? sessionIdRef.current ?? undefined,
              noteType: noteTypeValue,
              content: contentValue,
              sourceMessageIds:
                messageIds.size > 0 ? Array.from(messageIds) : undefined,
              confidence: confidenceValue,
              resolved: resolvedFlag,
              todoStatus: todoStatusValue ?? undefined,
            });
            result = created;
            success = true;
            break;
          }
          case "update_todo_status": {
            console.log("[realtime] tool:update_todo_status", { args });
            const todoIdString = coerceIdString(args.todoId ?? args.id);
            if (!todoIdString) {
              throw new Error("todoId is required");
            }
            const statusValue = coerceTodoStatusValue(args.status);
            if (!statusValue) {
              throw new Error("status must be open, in_review, or resolved");
            }
            const updatedTodo = await updateTodoStatusMutation({
              todoId: todoIdString as Id<"todos">,
              status: statusValue,
            });
            result = updatedTodo;
            success = true;
            break;
          }
          case "record_transcript_pointer": {
            const projectId = resolveProjectId(args) as Id<"projects">;
            const sessionIdValue =
              sessionRecord?.sessionId ?? sessionIdRef.current;
            if (!sessionIdValue) {
              throw new Error("Session id required for record_transcript_pointer");
            }
            let messageId: Id<"messages"> | null = null;
            let itemPointer: string | null = null;
            const argRecord = args as Record<string, unknown>;

            const pointerCandidates = new Set<string>();
            const pushCandidate = (value: unknown) => {
              const idValue = coerceIdString(value);
              if (idValue) {
                pointerCandidates.add(idValue);
              }
            };

            pushCandidate(argRecord.messageId);
            pushCandidate(argRecord.message_id);
            pushCandidate(argRecord.messagePointer);
            pushCandidate(argRecord.pointer);
            pushCandidate(argRecord.transcriptId);
            pushCandidate(argRecord.transcript_id);
            pushCandidate(argRecord.transcriptPointer);
            pushCandidate(argRecord.transcript);

            const arrayKeys = [
              "messageIds",
              "messages",
              "message_ids",
              "transcriptIds",
              "transcripts",
              "transcript_ids",
              "pointers",
            ];

            for (const key of arrayKeys) {
              const value = argRecord[key];
              if (Array.isArray(value)) {
                for (const entry of value) {
                  pushCandidate(entry);
                }
              }
            }

            if (isRecord(argRecord)) {
              for (const [key, value] of Object.entries(argRecord)) {
                const lowered = key.toLowerCase();
                if (lowered.includes("message") || lowered.includes("transcript")) {
                  if (Array.isArray(value)) {
                    for (const entry of value) {
                      pushCandidate(entry);
                    }
                  } else {
                    pushCandidate(value);
                  }
                }
              }
            }

            const pointerList = Array.from(pointerCandidates);
            if (pointerList.length > 0) {
              itemPointer = pointerList[0] ?? null;
            }

            for (const pointer of pointerList) {
              const resolved = resolveMessagePointer(pointer);
              if (resolved) {
                messageId = resolved;
                itemPointer = pointer;
                break;
              }
            }

            // GRACEFUL: If nothing resolved yet, just skip this tool call
            // The pointer will be linkable later when transcript persists
            if (!messageId && !itemPointer) {
              console.warn(
                `[realtime] record_transcript_pointer: No IDs resolved yet (transcript still persisting)`,
                { pointerList: pointerList.slice(0, 3) },
              );
              result = { skipped: true, reason: "transcript_not_persisted_yet" };
              success = true;
              break;
            }
            const blueprint = await recordTranscriptPointerMutation({
              projectId,
              sessionId: sessionIdValue,
              messageId: messageId ?? (itemPointer as string | undefined),
              itemId: itemPointer ?? undefined,
            });
            result = makeProjectToolResult({
              project: null,
              blueprint,
              fallbackId: projectId,
            });
            success = true;
            break;
          }
          case "get_document_workspace": {
            console.log("[realtime] tool:get_document_workspace", { args });
            const projectId = resolveProjectId(args);
            const workspace = await convex.query(api.documents.getWorkspace, {
              projectId: projectId as Id<"projects">,
            });
            result = workspace;
            success = true;
            break;
          }
          case "manage_outline": {
            console.log("[realtime] tool:manage_outline", { args });
            const projectId = resolveProjectId(args) as Id<"projects">;
            const operations = Array.isArray(args.operations) ? args.operations : [];
            const updated = await convex.mutation(api.documents.manageOutline, {
              projectId,
              operations: operations.map((op: Record<string, unknown>) => ({
                action: op.action as "add" | "rename" | "reorder" | "remove",
                heading: op.heading as string,
                newHeading: op.newHeading as string | undefined,
                position: op.position as number | undefined,
                status: op.status as "drafting" | "needs_detail" | "complete" | undefined,
              })),
            });
            result = {
              projectId,
              operations: updated.operations,
              sections: updated.sections.map((s: Record<string, unknown>) => ({
                heading: s.heading,
                status: s.status,
                order: s.order,
              })),
            };
            success = true;
            break;
          }
          case "queue_draft_update": {
            console.log("[realtime] tool:queue_draft_update", { args });
            const projectId = resolveProjectId(args) as Id<"projects">;
            const urgencyValue = coerceOptionalString(args.urgency);
            const rawPointerArray =
              coerceStringArray(args.messagePointers ?? args.message_pointers) ??
              [];
            const rawAnchorArray =
              coerceStringArray(
                args.transcriptAnchors ?? args.transcript_anchors,
              ) ?? [];
            const promptContextValue = coercePromptContext(
              args.promptContext ?? args.context,
            );

            const pointerSet = new Set<string>();
            const anchorSet = new Set<string>(rawAnchorArray);
            const unresolvedPointers: string[] = [];

            for (const pointer of rawPointerArray) {
              const resolved = resolveMessagePointer(pointer);
              if (resolved) {
                pointerSet.add(resolved);
              } else {
                anchorSet.add(pointer);
                unresolvedPointers.push(pointer);
              }
            }

            // Log but don't fail - unresolved pointers go to transcriptAnchors
            if (unresolvedPointers.length > 0) {
              console.warn(
                `[realtime] queue_draft_update: ${unresolvedPointers.length} transcript IDs not yet persisted (keeping as anchors)`,
                { unresolvedPointers: unresolvedPointers.slice(0, 3) },
              );
            }

            const messagePointersPayload =
              pointerSet.size > 0 ? Array.from(pointerSet) : undefined;
            const transcriptAnchorsPayload =
              anchorSet.size > 0 ? Array.from(anchorSet) : undefined;
            const sessionIdValue =
              sessionRecord?.sessionId ?? sessionIdRef.current;
            if (!sessionIdValue) {
              throw new Error("sessionId is required to queue a draft update");
            }
            const acceptedAt = Date.now();
            void (async () => {
              try {
                const job = await enqueueDraftUpdateMutation({
                  projectId,
                  sessionId: sessionIdValue,
                  summary: undefined,
                  urgency:
                    typeof urgencyValue === "string" ? urgencyValue : undefined,
                  messagePointers: messagePointersPayload,
                  transcriptAnchors: transcriptAnchorsPayload,
                  promptContext: promptContextValue,
                });
                await emitSystemJsonMessage("TOOL_PROGRESS", {
                  tool: name,
                  tool_call_id: toolCallId,
                  status: "queued",
                  projectId,
                  jobId: job?._id ?? null,
                  summary: null,
                  urgency: job?.urgency ?? null,
                  createdAt: job?.createdAt ?? acceptedAt,
                });
                try {
                  await convex.action(api.documents.processDraftQueue, {});
                } catch (processError) {
                  console.error(
                    "[realtime] queue_draft_update processDraftQueue failed",
                    processError,
                  );
                }
              } catch (progressError) {
                console.error(
                  "[realtime] queue_draft_update async failure",
                  progressError,
                );
                await emitSystemJsonMessage("TOOL_PROGRESS", {
                  tool: name,
                  tool_call_id: toolCallId,
                  status: "error",
                  projectId,
                  error:
                    progressError instanceof Error
                      ? progressError.message
                      : String(progressError),
                });
              }
            })();

            result = {
              status: "queued",
              projectId,
              acceptedAt,
              summary: null,
              urgency: urgencyValue ?? null,
            };
            success = true;
            break;
          }
          case "apply_document_edits": {
            console.log("[realtime] tool:apply_document_edits", { args });
            const projectId = resolveProjectId(args) as Id<"projects">;
            const markdownValue = coerceOptionalString(args.markdown);
            if (typeof markdownValue !== "string") {
              throw new Error("markdown is required");
            }
            const sectionPayload = coerceDocumentSectionsPayload(args.sections);
            const summaryValue = coerceOptionalString(args.summary);
            const acceptedAt = Date.now();
            const sectionsSummary = sectionPayload.map((section) => ({
              heading: section.heading,
              status: section.status ?? "drafting",
              order: section.order ?? null,
            }));

            void (async () => {
              try {
                const updated = await applyDocumentEditsMutation({
                  projectId,
                  markdown: markdownValue,
                  sections: sectionPayload.map(
                    (section: DocumentEditSectionPayload) => ({
                      heading: section.heading,
                      content: section.content,
                      status: section.status,
                      order: section.order,
                    }),
                  ),
                  summary:
                    typeof summaryValue === "string" ? summaryValue : undefined,
                });
                await emitSystemJsonMessage("TOOL_PROGRESS", {
                  tool: name,
                  tool_call_id: toolCallId,
                  status: "completed",
                  projectId,
                  updatedAt: Date.now(),
                  sections: updated.sections.map((section: (typeof updated.sections)[number]) => ({
                    heading: section.heading,
                    status: section.status,
                    order: section.order,
                  })),
                  summary: typeof summaryValue === "string" ? summaryValue : undefined,
                });
              } catch (progressError) {
                console.error(
                  "[realtime] apply_document_edits async failure",
                  progressError,
                );
                await emitSystemJsonMessage("TOOL_PROGRESS", {
                  tool: name,
                  tool_call_id: toolCallId,
                  status: "error",
                  projectId,
                  error:
                    progressError instanceof Error
                      ? progressError.message
                      : String(progressError),
                });
              }
            })();

            result = {
              status: "queued",
              projectId,
              acceptedAt,
              sections: sectionsSummary,
              summary: summaryValue ?? null,
            };
            success = true;
            break;
          }
          default: {
            throw new Error(`Unhandled tool call: ${name}`);
          }
        }
      } catch (toolError) {
        errorMessage =
          toolError instanceof Error ? toolError.message : String(toolError);
        console.error(`Tool ${name} failed`, toolError);
      }

      const submitted = await submitToolResult({
        tool: name,
        tool_call_id: toolCallId,
        response_id: responseId,
        success,
        result: success ? result : undefined,
        error: success ? undefined : errorMessage ?? "Unknown tool error",
      });

      return submitted;
    },
    [
      assignProjectToSession,
      applyDocumentEditsMutation,
      enqueueDraftUpdateMutation,
      commitBlueprintMutation,
      convex,
      createProjectToolMutation,
      createNoteMutation,
      instructionContext.mode,
      logConnection,
      resolveProjectId,
      recordTranscriptPointerMutation,
      resolveMessagePointer,
      submitToolResult,
      sessionRecord,
      syncBlueprintFieldMutation,
      updateTodoStatusMutation,
      updateProjectMetadataMutation,
      emitSystemJsonMessage,
    ],
  );

  const handleServerEvent = useCallback(
    async (payload: string | ArrayBuffer) => {
      try {
        const textPayload =
          typeof payload === "string"
            ? payload
            : new TextDecoder().decode(payload as ArrayBuffer);
        const event: ServerMessage = JSON.parse(textPayload);
        const eventId = event.event_id ?? randomId();

        setServerEvents((previous) => {
          const entry: ServerEventLog = {
            id: eventId,
            type: event.type ?? "unknown",
            timestamp: Date.now(),
            payload: event,
          };
          const next = [...previous, entry];
          return next.slice(-50);
        });

        switch (event.type) {
          case "session.created": {
            if (event.session?.id && sessionRecord?.sessionId) {
              logConnection(`Realtime session ready (${event.session.id})`);
              try {
                await updateRealtimeMutation({
                  sessionId: sessionRecord.sessionId,
                  realtimeSessionId: event.session.id,
                });
              } catch (sessionError) {
                console.error("Failed to sync realtime session id", sessionError);
              }
            }
            break;
          }
          case "input_audio_buffer.speech_started": {
            setVoiceActivity((current) => ({ ...current, user: true }));
            break;
          }
          case "input_audio_buffer.speech_stopped": {
            setVoiceActivity((current) => ({ ...current, user: false }));
            if (event.item_id) {
              userFragmentsRef.current.delete(event.item_id);
            }
            setPartialUserTranscript(null);
            break;
          }
          case "response.audio.delta": {
            setVoiceActivity((current) => ({ ...current, assistant: true }));
            break;
          }
          case "response.audio.completed":
          case "response.done":
          case "response.completed": {
            setVoiceActivity((current) => ({ ...current, assistant: false }));
            break;
          }
          case "conversation.item.input_audio_transcription.delta": {
            const key = event.item_id ?? eventId;
            const deltaText = extractText(event.delta) ?? extractText(event.text);
            if (deltaText) {
              const currentText =
                userFragmentsRef.current.get(key) ?? "";
              const nextText = `${currentText}${deltaText}`;
              userFragmentsRef.current.set(key, nextText);
              setPartialUserTranscript(nextText);
            }
            break;
          }
          case "conversation.item.input_audio_transcription.completed": {
            const key = event.item_id ?? eventId;
            const text =
              extractText(event.transcript) ??
              userFragmentsRef.current.get(key) ??
              extractText(event.text);
            await finalizeTranscript("user", key, text);
            userFragmentsRef.current.delete(key);
            break;
          }
          case "response.output_text.delta": {
            const key =
              event.response_id ?? event.response?.id ?? "assistant";
            const deltaText =
              extractText(event.delta) ?? extractText(event.output_text);
            if (deltaText) {
              const currentText =
                assistantFragmentsRef.current.get(key) ?? "";
              const nextText = `${currentText}${deltaText}`;
              assistantFragmentsRef.current.set(key, nextText);
              setPartialAssistantTranscript(nextText);
              setVoiceActivity((current) => ({
                ...current,
                assistant: true,
              }));
            }
            break;
          }
          case "response.output_text.done": {
            const key =
              event.response_id ?? event.response?.id ?? eventId;
            const text =
              extractText(event.output_text) ??
              assistantFragmentsRef.current.get(key);
            await finalizeTranscript("assistant", key, text);
            assistantFragmentsRef.current.delete(key);
            break;
          }
          case "conversation.item.created":
          case "conversation.item.added":
          case "conversation.item.done": {
            if (event.item) {
              const itemRecord = event.item as Record<string, unknown>;
              const role =
                typeof itemRecord.role === "string" ? itemRecord.role : null;
              const itemId =
                typeof itemRecord.id === "string" && itemRecord.id.trim()
                  ? (itemRecord.id as string)
                  : eventId;
              const previousItemId = (() => {
                const snake = itemRecord.previous_item_id;
                if (typeof snake === "string" && snake.trim()) {
                  return snake;
                }
                const camel = (itemRecord as Record<string, unknown>)
                  .previousItemId;
                return typeof camel === "string" && camel.trim() ? camel : null;
              })();
              const itemType =
                typeof itemRecord.type === "string" ? itemRecord.type : null;
              const itemStatus =
                typeof itemRecord.status === "string" ? itemRecord.status : null;
              const createdAt = (() => {
                const snake = itemRecord.created_at;
                if (typeof snake === "number") return snake;
                const camel = (itemRecord as Record<string, unknown>).createdAt;
                if (typeof camel === "number") return camel;
                return Date.now();
              })();

              if (itemRecord.type === "message") {
                if (role === "user" || role === "assistant") {
                  const key = `${role}-${itemId}`;
                  const text = extractText(itemRecord.content)?.trim();
                  await finalizeTranscript(
                    role === "user" ? "user" : "assistant",
                    key,
                    text,
                    {
                      itemId,
                      previousItemId,
                      itemType,
                      itemStatus,
                      payload: event.item,
                      createdAt,
                    },
                  );
                } else if (role === "system") {
                  const text = extractText(itemRecord.content)?.trim();
                  if (text && text.startsWith("TOOL_PROGRESS::")) {
                    const jsonPayload = text.slice("TOOL_PROGRESS::".length);
                    try {
                      const parsed = JSON.parse(jsonPayload);
                      handleToolProgressEvent(parsed);
                    } catch (progressError) {
                      console.warn(
                        "Failed to parse TOOL_PROGRESS payload",
                        progressError,
                        {
                          jsonPayload,
                        },
                      );
                    }
                  }

                  const sessionIdValue =
                    sessionRecord?.sessionId ?? sessionIdRef.current;
                  const projectIdValue =
                    sessionRecord?.projectId ?? projectIdRef.current;
                  if (projectIdValue && sessionIdValue) {
                    try {
                      await saveTranscriptChunkMutation({
                        projectId: projectIdValue,
                        sessionId: sessionIdValue,
                        item: {
                          id: itemId,
                          type: itemType ?? "message",
                          status: itemStatus ?? undefined,
                          role: "system",
                          previousItemId: previousItemId ?? undefined,
                          payload: event.item,
                          createdAt,
                        },
                      });
                    } catch (chunkError) {
                      console.error(
                        "Failed to persist system transcript chunk",
                        chunkError,
                        { itemId },
                      );
                    }
                  }
                }
              } else {
                const sessionIdValue =
                  sessionRecord?.sessionId ?? sessionIdRef.current;
                const projectIdValue =
                  sessionRecord?.projectId ?? projectIdRef.current;
                if (projectIdValue && sessionIdValue) {
                  try {
                    await saveTranscriptChunkMutation({
                      projectId: projectIdValue,
                      sessionId: sessionIdValue,
                      item: {
                        id: itemId,
                        type: itemType ?? undefined,
                        status: itemStatus ?? undefined,
                        role: role ?? undefined,
                        previousItemId: previousItemId ?? undefined,
                        payload: event.item,
                        createdAt,
                      },
                    });
                  } catch (chunkError) {
                    console.error(
                      "Failed to persist transcript chunk", chunkError, {
                        itemId,
                      },
                    );
                  }
                }
              }
            }
            break;
          }
          default: {
            break;
          }
        }

        const isDeltaEvent =
          typeof event.type === "string" && event.type.includes(".delta");
        if (!isDeltaEvent) {
          const toolCalls = collectToolCallInvocations(event);
          if (toolCalls.length > 0) {
            for (const call of toolCalls) {
              if (handledToolCallIdsRef.current.has(call.id)) {
                continue;
              }
              const processed = await handleToolCall(call);
              if (processed) {
                handledToolCallIdsRef.current.add(call.id);
                if (handledToolCallIdsRef.current.size > 100) {
                  const oldest = handledToolCallIdsRef.current.values().next();
                  if (!oldest.done) {
                    handledToolCallIdsRef.current.delete(oldest.value);
                  }
                }
              }
            }
          }
        }
      } catch (eventError) {
        console.error("Failed to process realtime event", eventError);
      }
    },
    [
      finalizeTranscript,
      handleToolCall,
      handleToolProgressEvent,
      logConnection,
      saveTranscriptChunkMutation,
      sessionRecord,
      updateRealtimeMutation,
    ],
  );

  const startSession = useCallback(async (options?: StartSessionOptions) => {
    if (status === "connecting" || status === "connected") return;
    if (!audioElementRef.current) {
      setError("Audio element not ready");
      return;
    }

    setStatus("requesting-permissions");
    setStatusMessage("Requesting microphone access");
    setError(null);
    logConnection("Requesting microphone access");

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDeviceId
            ? { exact: selectedInputDeviceId }
            : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      localStreamRef.current = mediaStream;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      if (!micMonitorRef.current) {
        micMonitorRef.current = new AudioLevelMonitor(
          audioContextRef.current,
          setMicrophoneLevel,
        );
      }
      micMonitorRef.current.connect(mediaStream);

      setStatus("connecting");
      setStatusMessage("Opening Convex session");
      logConnection("Creating Convex session record");

      const createdSession = await createSessionMutation({
        noiseProfile: noiseReduction,
        projectId: options?.projectId,
        deferProject: options?.deferProject,
        language,
      });
      const assignedProjectId =
        createdSession.projectId ?? options?.projectId ?? null;
      completeOnceRef.current = false;
      sessionIdRef.current = createdSession.sessionId;
      projectIdRef.current = assignedProjectId ?? null;
      console.log("[realtime] startSession created", createdSession);
      setSessionRecord({
        sessionId: createdSession.sessionId,
        projectId:
          assignedProjectId,
        startedAt: createdSession.startedAt,
        language: createdSession.language ?? language,
      });
      setLanguageState(createdSession.language ?? language);

      if (assignedProjectId) {
        try {
          const projectBundle = await convex.query(api.projects.getProject, {
            projectId: assignedProjectId as Id<"projects">,
          });
          if (projectBundle?.project) {
            ingestProjects([
              {
                project: projectBundle.project,
                blueprint: projectBundle.blueprint ?? null,
              },
            ]);
          }
        } catch (projectError) {
          console.error("[realtime] startSession getProject failed", projectError);
        }
      }

      const secretResponse = await fetch("/api/realtime/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noiseReduction,
          language,
          hasProjectContext: Boolean(assignedProjectId),
          mode: instructionContext.mode,
          turnDetection,
        }),
      });

      if (!secretResponse.ok) {
        throw new Error(
          `Failed to fetch realtime client secret (${secretResponse.status})`,
        );
      }

      const secretPayload = await secretResponse.json();
      const ephemeralKey: string | undefined =
        secretPayload?.client_secret?.value ?? secretPayload?.value;
      const model: string =
        secretPayload?.session?.model ??
        secretPayload?.model ??
        process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL ??
        "gpt-realtime";

      if (!ephemeralKey) {
        throw new Error("Realtime client secret missing in response");
      }

      logConnection("Opening peer connection");
      const peerConnection = createPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.addEventListener("connectionstatechange", () => {
        const connectionState = peerConnection.connectionState;
        logConnection(`Peer connection state: ${connectionState}`);
        if (connectionState === "failed") {
          setStatus("error");
          setError("Peer connection failed");
        }
        if (connectionState === "closed") {
          setStatus("ended");
        }
      });

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        const element = audioElementRef.current;
        if (remoteStream && element) {
          element.srcObject = remoteStream;
          void element.play().catch((playError) => {
            console.warn("Autoplay blocked", playError);
          });
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
          }
          if (audioContextRef.current) {
            if (!assistantMonitorRef.current) {
              assistantMonitorRef.current = new AudioLevelMonitor(
                audioContextRef.current,
                setAssistantLevel,
              );
            }
            assistantMonitorRef.current.connect(remoteStream);
          }
          if (selectedOutputDeviceId) {
            void applySinkId(element, selectedOutputDeviceId);
          }
        }
      };

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;

      dataChannel.addEventListener("open", () => {
        logConnection("Realtime data channel open");
        setStatus("connected");
        setStatusMessage("Listening");
      });

      dataChannel.addEventListener("close", () => {
        logConnection("Realtime data channel closed");
        if (status !== "ended") {
          setStatus("ended");
        }
      });

      dataChannel.addEventListener("error", (event) => {
        console.error("Data channel error", event);
        setError("Realtime data channel error");
        setStatus("error");
      });

      dataChannel.addEventListener("message", (event) => {
        void handleServerEvent(event.data as string | ArrayBuffer);
      });

      mediaStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      if (peerConnection.getTransceivers().length === 0) {
        peerConnection.addTransceiver("audio", { direction: "sendrecv" });
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      logConnection("Sending SDP offer to OpenAI");
      const response = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(
          model,
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI Realtime handshake failed (${response.status})`,
        );
      }

      const answerSdp = await response.text();
      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
      logConnection("Realtime session established");
      setStatusMessage("Connected");

      if (selectedOutputDeviceId) {
        await applySinkId(audioElementRef.current, selectedOutputDeviceId);
      }
    } catch (startError) {
      console.error("Failed to start realtime session", startError);
      setError(startError instanceof Error ? startError.message : String(startError));
      setStatus("error");
      setStatusMessage("Unable to start session");
      await tearDownConnection();
    }
  }, [
    audioElementRef,
    convex,
    createSessionMutation,
    handleServerEvent,
    ingestProjects,
    instructionContext.mode,
    language,
    logConnection,
    noiseReduction,
    turnDetection,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    status,
    tearDownConnection,
  ]);

  useEffect(() => {
    if (status !== "connected") return;
    let cancelled = false;

    const pushSessionUpdate = async () => {
      try {
        await waitForDataChannelOpen();
      } catch (connectionError) {
        console.error("Failed waiting for realtime channel", connectionError);
        return;
      }

      if (cancelled) return;
      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open") {
        return;
      }

      const languageOption = findLanguageOption(language);
      const hasProjectContext =
        instructionContext.mode !== "intake" || Boolean(sessionRecord?.projectId);
      const realtimeModel =
        process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL ?? "gpt-realtime";
      const transcriptionModel =
        process.env.NEXT_PUBLIC_OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1";

      const sessionUpdate: Record<string, unknown> = {
        type: "realtime",
        model: realtimeModel,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: transcriptionModel },
          },
        },
      };

      if (noiseReduction && noiseReduction !== "default") {
        const audioConfig =
          (sessionUpdate.audio as Record<string, unknown>) ?? {};
        const inputConfig = (audioConfig.input as Record<string, unknown>) ?? {};
        inputConfig.noise_reduction = { type: noiseReduction };
        audioConfig.input = inputConfig;
        sessionUpdate.audio = audioConfig;
      }

      if (turnDetection) {
        sessionUpdate.turn_detection =
          turnDetection.type === "semantic_vad"
            ? {
                type: "semantic_vad",
                eagerness: turnDetection.eagerness,
              }
            : {
                type: "server_vad",
                threshold: turnDetection.threshold,
                prefix_padding_ms: turnDetection.prefix_padding_ms,
                silence_duration_ms: turnDetection.silence_duration_ms,
              };
      }

      const toolDefinitions = getToolsForMode(instructionContext.mode);
      const toolSignature = JSON.stringify(toolDefinitions);
      if (toolSignature !== lastToolSignatureRef.current) {
        sessionUpdate.tools = toolDefinitions;
        lastToolSignatureRef.current = toolSignature;
      }

      const instructions = buildSessionInstructions({
        language: languageOption,
        hasProjectContext,
        mode: instructionContext.mode,
        blueprintSummary: instructionContext.blueprintSummary,
        draftingSnapshot: instructionContext.draftingSnapshot,
        latestDraftUpdate: instructionContext.latestDraftUpdate ?? undefined,
      });
      if (instructions && instructions !== lastInstructionRef.current) {
        sessionUpdate.instructions = instructions;
        lastInstructionRef.current = instructions;
      }

      try {
        if (Object.keys(sessionUpdate).length > 0) {
          channel.send(
            JSON.stringify({
              type: "session.update",
              session: sessionUpdate,
            }),
          );
          if (noiseReduction && noiseReduction !== "default") {
            logConnection(`Noise reduction set to ${noiseReduction}`);
          }
          if (turnDetection) {
            const turnLabel =
              TURN_DETECTION_OPTIONS.find(
                (option) => option.value === turnDetectionPreset,
              )?.label ??
              (turnDetection.type === "semantic_vad"
                ? `Semantic (${turnDetection.eagerness ?? "auto"})`
                : "Server VAD");
            logConnection(`Turn detection configured: ${turnLabel}`);
          }
          if (sessionUpdate.instructions) {
            const contextLabel = hasProjectContext
              ? "project"
              : "project selection";
            logConnection(
              `Assistant language pinned to ${languageOption.label} with ${contextLabel} context`,
            );
          }
        }

        if (sessionRecord?.sessionId) {
          await setNoiseProfileMutation({
            sessionId: sessionRecord.sessionId,
            noiseProfile: noiseReduction,
          });
        }
      } catch (updateError) {
        console.error("Failed to update realtime session", updateError);
      }
    };

    void pushSessionUpdate();

    return () => {
      cancelled = true;
    };
  }, [
    instructionContext,
    language,
    logConnection,
    noiseReduction,
    turnDetection,
    turnDetectionPreset,
    sessionRecord?.sessionId,
    sessionRecord?.projectId,
    setNoiseProfileMutation,
    status,
    waitForDataChannelOpen,
  ]);

  const sendTextMessage = useCallback(
    async (message: string, options?: ManualMessageOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      await waitForDataChannelOpen();
      const channel = dataChannelRef.current;
      if (!channel || channel.readyState !== "open") {
        throw new Error("Realtime connection not ready");
      }
      const clientEvent = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: trimmed,
            },
          ],
        },
      };
      channel.send(JSON.stringify(clientEvent));
      channel.send(JSON.stringify({ type: "response.create" }));
      if (!options?.skipPersist) {
        const key = `manual-${Date.now()}`;
        await finalizeTranscript("user", key, trimmed);
      }
    },
    [finalizeTranscript, waitForDataChannelOpen],
  );

  useEffect(() => {
    if (status === "idle" || status === "ended") {
      resetInstructionContext();
    }
  }, [resetInstructionContext, status]);

  return useMemo(
    () => ({
      status,
      statusMessage,
      isConnected: status === "connected",
      startSession,
      stopSession,
      refreshDevices,
      inputDevices,
      outputDevices,
      selectedInputDeviceId,
      selectInputDevice,
      selectedOutputDeviceId,
      selectOutputDevice,
      noiseReduction,
      setNoiseReduction,
      turnDetection,
      turnDetectionPreset,
      setTurnDetectionPreset,
      language,
      setLanguage,
      languageOptions: LANGUAGE_OPTIONS,
      microphoneLevel,
      assistantLevel,
      voiceActivity,
      isMuted,
      toggleMute,
      transcripts,
      partialUserTranscript,
      partialAssistantTranscript,
      connectionLog,
      serverEvents,
      draftProgress,
      error,
      sendTextMessage,
      registerAudioElement,
      sessionRecord,
      assignProjectToSession,
      resolveMessageId,
      ingestProjects,
      instructionContext,
      updateInstructionContext,
      resetInstructionContext,
    }),
    [
      assistantLevel,
      assignProjectToSession,
      instructionContext,
      connectionLog,
      error,
      ingestProjects,
      language,
      inputDevices,
      noiseReduction,
      outputDevices,
      partialAssistantTranscript,
      partialUserTranscript,
      sessionRecord,
      refreshDevices,
      registerAudioElement,
      resetInstructionContext,
      selectInputDevice,
      selectOutputDevice,
      selectedInputDeviceId,
      selectedOutputDeviceId,
      sendTextMessage,
      startSession,
      setLanguage,
      setTurnDetectionPreset,
      status,
      statusMessage,
      stopSession,
      transcripts,
      voiceActivity,
      isMuted,
      toggleMute,
      microphoneLevel,
      serverEvents,
      setNoiseReduction,
      turnDetection,
      turnDetectionPreset,
      resolveMessageId,
      updateInstructionContext,
      draftProgress,
    ],
  );
}

export { NOISE_REDUCTION_OPTIONS, TURN_DETECTION_OPTIONS };
