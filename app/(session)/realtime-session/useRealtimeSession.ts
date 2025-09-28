"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation } from "convex/react";

import {
  AudioLevelMonitor,
  NOISE_REDUCTION_OPTIONS,
  NoiseReductionProfile,
  TranscriptionFragment,
  VoiceActivityState,
  applySinkId,
  createPeerConnection,
} from "@/lib/realtimeAudio";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  DEFAULT_LANGUAGE_OPTION,
  LANGUAGE_OPTIONS,
  findLanguageOption,
  type LanguageOption,
} from "@/lib/languages";
import { buildSessionInstructions } from "@/lib/realtimeInstructions";

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
  language: string;
  setLanguage: (language: string) => Promise<void>;
  languageOptions: LanguageOption[];
  microphoneLevel: number;
  assistantLevel: number;
  voiceActivity: VoiceActivityState;
  transcripts: TranscriptionFragment[];
  partialUserTranscript: string | null;
  partialAssistantTranscript: string | null;
  connectionLog: ConnectionEvent[];
  serverEvents: ServerEventLog[];
  error: string | null;
  sendTextMessage: (message: string, options?: ManualMessageOptions) => Promise<void>;
  registerAudioElement: (element: HTMLAudioElement | null) => void;
  sessionRecord: SessionBootstrap | null;
  assignProjectToSession: (projectId: Id<"projects">) => Promise<void>;
  resolveMessageId: (transcriptId: string) => Id<"messages"> | null;
  ingestProjects: (
    entries: Array<{ project: ProjectDoc; blueprint: BlueprintDoc | null }>,
  ) => void;
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
      collected.push({ id, name, arguments: args, responseId });
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
      missingFields: [
        "desiredOutcome",
        "targetAudience",
        "publishingPlan",
        "timeline",
        "materialsInventory",
        "communicationPreferences",
        "budgetRange",
        "voiceGuardrails",
      ],
    };
  }

  const missingFields: string[] = [];
  const textFields: Array<keyof BlueprintDoc> = [
    "desiredOutcome",
    "targetAudience",
    "publishingPlan",
    "timeline",
    "materialsInventory",
    "communicationPreferences",
    "budgetRange",
  ];

  for (const field of textFields) {
    const value = blueprint[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      missingFields.push(field);
    }
  }

  const guardrails = blueprint.voiceGuardrails;
  if (
    !guardrails ||
    Object.values(guardrails).every((entry) => {
      if (typeof entry === "string") {
        return entry.trim().length === 0;
      }
      return !entry;
    })
  ) {
    missingFields.push("voiceGuardrails");
  }

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
  const [language, setLanguageState] = useState<string>(
    DEFAULT_LANGUAGE_OPTION.value,
  );
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivityState>({
    user: false,
    assistant: false,
  });
  const [transcripts, setTranscripts] = useState<TranscriptionFragment[]>([]);
  const [partialUserTranscript, setPartialUserTranscript] =
    useState<string | null>(null);
  const [partialAssistantTranscript, setPartialAssistantTranscript] =
    useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<ConnectionEvent[]>([]);
  const [serverEvents, setServerEvents] = useState<ServerEventLog[]>([]);
  const [sessionRecord, setSessionRecord] =
    useState<SessionBootstrap | null>(null);

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
  const completeOnceRef = useRef(false);
  const lastInstructionRef = useRef<string | null>(null);
  const lastProjectResultsRef = useRef<ProjectToolResult[]>([]);
  const sessionIdRef = useRef<Id<"sessions"> | null>(null);

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

      if (sessionRecord?.projectId) {
        console.log("[realtime] resolveProjectId falling back to session project", {
          projectId: sessionRecord.projectId,
        });
        return sessionRecord.projectId;
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
        setSelectedInputDeviceId(inputs[0]!.deviceId);
      }

      if (!selectedOutputDeviceId && outputs.length > 0) {
        setSelectedOutputDeviceId(outputs[0]!.deviceId);
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

      if (sessionRecord?.sessionId) {
        try {
          const persisted = await appendMessageMutation({
            sessionId: sessionRecord.sessionId,
            speaker,
            transcript: text,
            timestamp: message.timestamp,
            eventId: key,
          });
          if (persisted?.messageId) {
            transcriptMessageIdsRef.current.set(key, persisted.messageId);
          }
        } catch (persistError) {
          console.error("Failed to persist transcript", persistError);
        }
      }
    },
    [appendMessageMutation, sessionRecord],
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
      setSessionRecord(null);
      setStatus("ended");
    },
    [completeSessionMutation, sessionRecord, status, tearDownConnection],
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
      } catch (assignError) {
        console.error("Failed to assign project to session", assignError);
        throw assignError;
      }
    },
    [assignProjectMutation, language, sessionRecord],
  );

  const resolveMessageId = useCallback(
    (transcriptId: string) =>
      transcriptMessageIdsRef.current.get(transcriptId) ?? null,
    [],
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

      if (name !== "list_projects" && argCount === 0) {
        console.log(`[realtime] tool:${name} awaiting arguments`, {
          rawArguments,
        });
        return false;
      }

      if (name === "create_project") {
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
        switch (name) {
          case "list_projects": {
            console.log("[realtime] tool:list_projects", { args });
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

            const transcriptId =
              typeof args.transcriptId === "string"
                ? args.transcriptId
                : undefined;
            const messageId = transcriptId
              ? transcriptMessageIdsRef.current.get(transcriptId) ?? undefined
              : undefined;

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
      commitBlueprintMutation,
      convex,
      createProjectToolMutation,
      logConnection,
      resolveProjectId,
      submitToolResult,
      sessionRecord,
      syncBlueprintFieldMutation,
      transcriptMessageIdsRef,
      updateProjectMetadataMutation,
      coerceOptionalString,
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
          case "conversation.item.created": {
            if (event.item?.type === "message") {
              const role = event.item.role;
              if (role === "user" || role === "assistant") {
                const key = `${role}-${event.item.id ?? eventId}`;
                const text = extractText(event.item.content);
                await finalizeTranscript(
                  role === "user" ? "user" : "assistant",
                  key,
                  text,
                );
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
      logConnection,
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
      console.log("[realtime] startSession created", createdSession);
      setSessionRecord({
        sessionId: createdSession.sessionId,
        projectId:
          assignedProjectId,
        startedAt: createdSession.startedAt,
        language: createdSession.language ?? language,
      });
      setLanguageState(createdSession.language ?? language);

      const secretResponse = await fetch("/api/realtime/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noiseReduction,
          language,
          hasProjectContext: Boolean(assignedProjectId),
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
    createSessionMutation,
    handleServerEvent,
    logConnection,
    noiseReduction,
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
      const hasProjectContext = Boolean(sessionRecord?.projectId);
      const sessionUpdate: Record<string, unknown> = {};

      if (noiseReduction && noiseReduction !== "default") {
        sessionUpdate.audio = {
          input: { noise_reduction: { type: noiseReduction } },
        };
      }

      const instructions = buildSessionInstructions({
        language: languageOption,
        hasProjectContext,
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
          if (sessionUpdate.audio) {
            logConnection(`Noise reduction set to ${noiseReduction}`);
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
    language,
    logConnection,
    noiseReduction,
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
      language,
      setLanguage,
      languageOptions: LANGUAGE_OPTIONS,
      microphoneLevel,
      assistantLevel,
      voiceActivity,
      transcripts,
      partialUserTranscript,
      partialAssistantTranscript,
      connectionLog,
      serverEvents,
      error,
      sendTextMessage,
      registerAudioElement,
      sessionRecord,
      assignProjectToSession,
      resolveMessageId,
      ingestProjects,
    }),
    [
      assistantLevel,
      assignProjectToSession,
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
      selectInputDevice,
      selectOutputDevice,
      selectedInputDeviceId,
      selectedOutputDeviceId,
      sendTextMessage,
      startSession,
      setLanguage,
      status,
      statusMessage,
      stopSession,
      transcripts,
      voiceActivity,
      microphoneLevel,
      serverEvents,
      setNoiseReduction,
      resolveMessageId,
    ],
  );
}

export { NOISE_REDUCTION_OPTIONS };
