"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  BLUEPRINT_FIELD_DEFINITIONS,
  BLUEPRINT_FIELD_ORDER,
  REQUIRED_BLUEPRINT_FIELDS,
  blueprintFieldHasValue,
  normalizeTextValue,
  type BlueprintFieldDefinition,
  type BlueprintFieldKey,
  type VoiceGuardrails,
} from "@/lib/projects";
import type { TranscriptionFragment } from "@/lib/realtimeAudio";
import type {
  RealtimeSessionState,
  SessionStatus,
  StartSessionOptions,
} from "./useRealtimeSession";

type IntakePhase =
  | "idle"
  | "mode-selection"
  | "awaiting-existing"
  | "blueprint"
  | "active";

type ProjectListEntry = {
  project: Doc<"projects">;
  blueprint: Doc<"projectBlueprints"> | null;
};

type DocumentWorkspaceSnapshot = {
  document: Doc<"documents"> | null;
  sections: Doc<"documentSections">[];
  progress: {
    wordCount: number;
    sectionStatuses: Array<{
      sectionId: Id<"documentSections">;
      heading: string;
      status: "drafting" | "needs_detail" | "complete";
      order: number;
    }>;
  };
};

const MAX_DRAFT_PREVIEW_CHARS = 3500;

const MISSING_VALUE_LABEL = "[missing]";

const formatBlueprintSnapshot = (
  blueprint: Doc<"projectBlueprints"> | null,
) => {
  if (!blueprint) {
    return ["- No blueprint captured yet."];
  }

  const lines: string[] = [];

  for (const fieldKey of BLUEPRINT_FIELD_ORDER) {
    const definition = BLUEPRINT_FIELD_DEFINITIONS.find(
      (entry) => entry.key === fieldKey,
    );
    if (!definition) continue;

    switch (fieldKey) {
      case "voiceGuardrails": {
        const voice = blueprint.voiceGuardrails;
        const tone = normalizeTextValue(voice?.tone);
        const structure = normalizeTextValue(voice?.structure);
        const content = normalizeTextValue(voice?.content);
        if (!tone && !structure && !content) {
          lines.push("- Voice guardrails: [missing]");
          break;
        }
        if (tone) {
          lines.push(`- Voice guardrails (tone): ${tone}`);
        }
        if (structure) {
          lines.push(`- Voice guardrails (structure): ${structure}`);
        }
        if (content) {
          lines.push(`- Voice guardrails (content): ${content}`);
        }
        break;
      }
      case "desiredOutcome": {
        const value = normalizeTextValue(blueprint.desiredOutcome);
        lines.push(`- ${definition.label}: ${value || MISSING_VALUE_LABEL}`);
        break;
      }
      case "targetAudience": {
        const value = normalizeTextValue(blueprint.targetAudience);
        lines.push(`- ${definition.label}: ${value || MISSING_VALUE_LABEL}`);
        break;
      }
      case "materialsInventory": {
        const value = normalizeTextValue(blueprint.materialsInventory);
        lines.push(`- ${definition.label}: ${value || MISSING_VALUE_LABEL}`);
        break;
      }
      case "communicationPreferences": {
        const value = normalizeTextValue(blueprint.communicationPreferences);
        lines.push(`- ${definition.label}: ${value || MISSING_VALUE_LABEL}`);
        break;
      }
      default:
        break;
    }
  }

  return lines;
};

const summarizeDraftSections = (
  sections: DocumentWorkspaceSnapshot["progress"]["sectionStatuses"],
) => {
  if (!sections?.length) return "";
  const needsDetail: string[] = [];
  const drafting: string[] = [];
  const complete: string[] = [];

  for (const section of sections) {
    const heading = section.heading;
    switch (section.status) {
      case "needs_detail":
        needsDetail.push(heading);
        break;
      case "drafting":
        drafting.push(heading);
        break;
      case "complete":
        complete.push(heading);
        break;
      default:
        break;
    }
  }

  const parts: string[] = [];
  if (needsDetail.length) {
    parts.push(`needs detail: ${needsDetail.join(", ")}`);
  }
  if (drafting.length) {
    parts.push(`drafting: ${drafting.join(", ")}`);
  }
  if (complete.length) {
    parts.push(`complete: ${complete.join(", ")}`);
  }
  return parts.join("; ");
};

const formatTodoSnapshot = (todos: Doc<"todos">[] | null | undefined) => {
  const openTodos = (todos ?? []).filter((todo) => todo.status !== "resolved");
  if (openTodos.length === 0) {
    return {
      count: 0,
      lines: ["- No open TODOs."],
    };
  }

  const displayLimit = 5;
  const lines = openTodos.slice(0, displayLimit).map((todo, index) => {
    const label = todo.label.trim();
    return `${index + 1}. ${label || "(no label)"} (${todo.status})`;
  });

  if (openTodos.length > displayLimit) {
    lines.push(
      `… and ${openTodos.length - displayLimit} more open TODO${
        openTodos.length - displayLimit === 1 ? "" : "s"
      }.`,
    );
  }

  return {
    count: openTodos.length,
    lines,
  };
};

const buildProjectSnapshotMessage = ({
  projectName,
  blueprint,
  workspace,
  todos,
}: {
  projectName: string;
  blueprint: Doc<"projectBlueprints"> | null;
  workspace: DocumentWorkspaceSnapshot | null | undefined;
  todos: Doc<"todos">[] | null | undefined;
}) => {
  const sections: string[] = [];
  sections.push(`Context snapshot for "${projectName}":`);

  const blueprintLines = formatBlueprintSnapshot(blueprint);
  if (blueprintLines.length > 0) {
    sections.push(["Blueprint overview:", ...blueprintLines.map((line) => `  ${line}`)].join("\n"));
  }

  const todoSummary = formatTodoSnapshot(todos);
  sections.push(
    [`Open TODOs (${todoSummary.count}):`, ...todoSummary.lines.map((line) => `  ${line}`)].join("\n"),
  );

  const wordCount = workspace?.progress.wordCount ?? 0;
  const sectionSummary = summarizeDraftSections(workspace?.progress.sectionStatuses ?? []);
  const sectionText = sectionSummary ? `; sections: ${sectionSummary}` : "";

  const rawMarkdown = workspace?.document?.latestDraftMarkdown ?? "";
  const trimmedMarkdown = rawMarkdown.trim();
  const summaryText = workspace?.document?.summary?.trim();

  if (summaryText) {
    sections.push(`Draft summary:\n${summaryText}`);
  } else {
    sections.push("Draft summary: _Not captured yet._");
  }

  if (trimmedMarkdown) {
    const truncated = trimmedMarkdown.length > MAX_DRAFT_PREVIEW_CHARS;
    const preview = truncated
      ? `${trimmedMarkdown.slice(0, MAX_DRAFT_PREVIEW_CHARS)}\n… trimmed for brevity.`
      : trimmedMarkdown;
    sections.push(
      `Document progress: ${wordCount} words${sectionText}.\nCurrent draft:\n\`\`\`markdown\n${preview}\n\`\`\``,
    );
  } else {
    sections.push(
      `Document progress: ${wordCount} words${sectionText}.\nCurrent draft: _No saved content yet._`,
    );
  }

  return sections.join("\n\n");
};

type FieldActivity = {
  source: "voice" | "manual";
  updatedAt: number;
  transcriptId?: string;
};

const MODE_KEYWORDS = {
  new: ["new", "start", "create", "fresh"],
  existing: ["existing", "resume", "continue", "pick up", "current"],
};

const ORDINAL_KEYWORDS = new Map<string, number>([
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["fourth", 3],
  ["fifth", 4],
  ["sixth", 5],
]);

const untitledProjectName = (count: number) =>
  `Untitled project ${count > 0 ? count + 1 : ""}`.trim();

const detectModeIntent = (text: string): "new" | "existing" | null => {
  const lowered = text.toLowerCase();
  if (MODE_KEYWORDS.new.some((keyword) => lowered.includes(keyword))) {
    return "new";
  }
  if (MODE_KEYWORDS.existing.some((keyword) => lowered.includes(keyword))) {
    return "existing";
  }
  return null;
};

const detectProjectByText = (
  text: string,
  projects: ProjectListEntry[] | undefined,
): ProjectListEntry | null => {
  if (!projects?.length) return null;
  const lowered = text.toLowerCase();

  for (const entry of projects) {
    const title = entry.project.title.toLowerCase();
    if (title && lowered.includes(title)) {
      return entry;
    }
  }

  for (const [keyword, index] of ORDINAL_KEYWORDS.entries()) {
    if (lowered.includes(keyword) && projects[index]) {
      return projects[index] ?? null;
    }
  }

  const numberMatch = lowered.match(/project\s*(\d+)/);
  if (numberMatch) {
    const index = Number.parseInt(numberMatch[1] ?? "", 10) - 1;
    if (Number.isFinite(index) && index >= 0 && projects[index]) {
      return projects[index] ?? null;
    }
  }

  return null;
};

interface UseProjectIntakeFlowOptions {
  transcripts: TranscriptionFragment[];
  status: SessionStatus;
  startSession: (options?: StartSessionOptions) => Promise<void>;
  sendTextMessage: RealtimeSessionState["sendTextMessage"];
  sessionRecord: RealtimeSessionState["sessionRecord"];
  assignProjectToSession: RealtimeSessionState["assignProjectToSession"];
  resolveMessageId: RealtimeSessionState["resolveMessageId"];
  onNavigateToProject?: (projectId: Id<"projects">) => void;
  initialProjectId?: Id<"projects"> | null;
}

export interface BlueprintFieldState extends BlueprintFieldDefinition {
  value: string;
  activity?: FieldActivity;
  isComplete: boolean;
}

export interface ProjectIntakeState {
  phase: IntakePhase;
  modeIntent: "new" | "existing" | null;
  projects: ProjectListEntry[] | undefined;
  isLoadingProjects: boolean;
  isProjectContextHydrated: boolean;
  activeProject: Doc<"projects"> | null;
  blueprint: Doc<"projectBlueprints"> | null;
  fieldStates: BlueprintFieldState[];
  activeFieldKey: BlueprintFieldKey | null;
  beginConversation: () => Promise<void>;
  beginProjectSession: () => Promise<void>;
  chooseExistingMode: () => Promise<void>;
  startNewProject: () => Promise<void>;
  openProject: (projectId: Id<"projects">) => Promise<void>;
  clearProject: () => void;
  setActiveFieldKey: (key: BlueprintFieldKey | null, manual?: boolean) => void;
  updateField: (key: BlueprintFieldKey, value: string) => Promise<void>;
  updateVoiceGuardrails: (value: VoiceGuardrails) => Promise<void>;
  updateProjectMetadata: (updates: {
    title?: string;
    contentType?: string;
    goal?: string;
  }) => Promise<void>;
  isBlueprintComplete: boolean;
  isBlueprintBypassed: boolean;
  commitBlueprint: () => Promise<void>;
  skipBlueprint: () => Promise<void>;
  resumeBlueprint: () => Promise<void>;
}

export function useProjectIntakeFlow({
  transcripts,
  status,
  startSession,
  sendTextMessage,
  sessionRecord,
  assignProjectToSession,
  resolveMessageId,
  onNavigateToProject,
  initialProjectId,
}: UseProjectIntakeFlowOptions): ProjectIntakeState {
  const convex = useConvex();
  const projects = useQuery(api.projects.listProjects, { limit: 20 });
  const [phase, setPhase] = useState<IntakePhase>("idle");
  const [modeIntent, setModeIntent] = useState<"new" | "existing" | null>(
    null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<
    Id<"projects"> | null
  >(initialProjectId ?? null);
  const [activeProject, setActiveProject] = useState<Doc<"projects"> | null>(
    null,
  );
  const [blueprint, setBlueprint] = useState<Doc<"projectBlueprints"> | null>(
    null,
  );
  const [activeFieldKey, setActiveFieldKeyInternal] = useState<
    BlueprintFieldKey | null
  >(null);
  const [fieldActivity, setFieldActivity] = useState<
    Partial<Record<BlueprintFieldKey, FieldActivity>>
  >({});
  const [blueprintBypassed, setBlueprintBypassed] = useState(false);
  const manualFocusRef = useRef(false);
  const modeTranscriptIdsRef = useRef(new Set<string>());
  const existingTranscriptIdsRef = useRef(new Set<string>());
  const fieldTranscriptIdsRef = useRef(new Set<string>());
  const skipBlueprintTranscriptIdsRef = useRef(new Set<string>());
  const providedProjectListRef = useRef(false);

  const createProjectMutation = useMutation(api.projects.createProject);
  const updateProjectMutation = useMutation(api.projects.updateProjectMetadata);
  const syncBlueprintFieldMutation = useMutation(
    api.projects.syncBlueprintField,
  );
  const commitBlueprintMutation = useMutation(api.projects.commitBlueprint);
  const bootstrapSandboxMutation = useMutation(api.projects.bootstrapSandbox);

  const projectDetail = useQuery(
    api.projects.getProject,
    selectedProjectId ? { projectId: selectedProjectId } : "skip",
  );

  const isProjectDetailLoading = Boolean(
    selectedProjectId && projectDetail === undefined,
  );

  useEffect(() => {
    if (!initialProjectId) return;
    setSelectedProjectId((previous) => previous ?? initialProjectId);
  }, [initialProjectId]);

  useEffect(() => {
    void bootstrapSandboxMutation({});
  }, [bootstrapSandboxMutation]);

  useEffect(() => {
    if (!projectDetail) return;
    if (!projectDetail.project) return;
    setActiveProject(projectDetail.project);
    setBlueprint(projectDetail.blueprint ?? null);
  }, [projectDetail]);

  const navigateToProjectRef = useRef<typeof onNavigateToProject>();

  useEffect(() => {
    navigateToProjectRef.current = onNavigateToProject;
  }, [onNavigateToProject]);

  useEffect(() => {
    const projectIdFromSession = sessionRecord?.projectId ?? null;
    console.log("[intake] session projectId effect", {
      projectIdFromSession,
      selectedProjectId,
    });
    if (!projectIdFromSession) return;
    setSelectedProjectId((previous) =>
      previous === projectIdFromSession ? previous : projectIdFromSession,
    );
    setModeIntent(null);
    manualFocusRef.current = false;
    modeTranscriptIdsRef.current.clear();
    existingTranscriptIdsRef.current.clear();
    fieldTranscriptIdsRef.current.clear();
    navigateToProjectRef.current?.(projectIdFromSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRecord?.projectId]);

  const projectsList = useMemo<ProjectListEntry[]>(
    () => projects ?? [],
    [projects],
  );

  // REMOVED: Automatic ingestProjects calls that were polluting the conversation
  // The assistant will explicitly call list_projects/get_project ONLY when needed

  const isProjectContextHydrated = useMemo(() => {
    if (!selectedProjectId) return true;
    if (isProjectDetailLoading) return false;
    return Boolean(activeProject && activeProject._id === selectedProjectId);
  }, [activeProject, isProjectDetailLoading, selectedProjectId]);

  const ensureSessionForProject = useCallback(
    async (projectId: Id<"projects">, options?: StartSessionOptions) => {
      if (status === "connected" && sessionRecord?.sessionId) {
        if (sessionRecord.projectId !== projectId) {
          await assignProjectToSession(projectId);
        }
        return;
      }
      await startSession({ projectId, ...options });
    },
    [assignProjectToSession, sessionRecord, startSession, status],
  );

  const beginConversation = useCallback(async () => {
    modeTranscriptIdsRef.current.clear();
    existingTranscriptIdsRef.current.clear();
    fieldTranscriptIdsRef.current.clear();
    skipBlueprintTranscriptIdsRef.current.clear();
    providedProjectListRef.current = false;
    setModeIntent(null);
    setSelectedProjectId(null);
    setActiveProject(null);
    setBlueprint(null);
    setBlueprintBypassed(false);
    await startSession({ deferProject: true });
    setPhase("mode-selection");
    await sendTextMessage(
      "Let’s begin! Greet the user warmly and ask if they’d like to create a new project or continue an existing one.",
      { skipPersist: true },
    );
  }, [sendTextMessage, startSession]);

  const startNewProject = useCallback(async () => {
    if (modeIntent !== "new") {
      setModeIntent("new");
    }
    const untitledCount = projectsList.filter((entry: ProjectListEntry) =>
      entry.project.title.startsWith("Untitled project"),
    ).length;
    const created = await createProjectMutation({
      title: untitledProjectName(untitledCount),
      contentType: "article",
    });
    setSelectedProjectId(created.project._id);
    setActiveProject(created.project);
    setBlueprint(created.blueprint);
    setPhase("blueprint");
    setBlueprintBypassed(false);
    manualFocusRef.current = false;
    fieldTranscriptIdsRef.current.clear();
    skipBlueprintTranscriptIdsRef.current.clear();
    await ensureSessionForProject(created.project._id);
    await sendTextMessage(
      "We’re starting a fresh project. Let the user know we’ll capture the project blueprint step by step.",
      { skipPersist: true },
    );
  }, [
    createProjectMutation,
    ensureSessionForProject,
    modeIntent,
    projectsList,
    sendTextMessage,
  ]);

  const chooseExistingMode = useCallback(async () => {
    setModeIntent("existing");
    setPhase("awaiting-existing");
    providedProjectListRef.current = false;
    console.log("[intake] entering existing project mode");
    await sendTextMessage(
      "Share the recent projects and invite the user to pick one by name or number.",
      { skipPersist: true },
    );
  }, [sendTextMessage]);

  const openProject = useCallback(
    async (projectId: Id<"projects">) => {
      const entry = projectsList.find(
        (candidate: ProjectListEntry) =>
          candidate.project._id === projectId,
      );
      if (!entry) return;

      setSelectedProjectId(projectId);
      setModeIntent(null);
      manualFocusRef.current = false;
      fieldTranscriptIdsRef.current.clear();
      skipBlueprintTranscriptIdsRef.current.clear();

      // SIMPLE LOGIC: Only enter blueprint if it's COMPLETELY empty
      const blueprintIsCompletelyEmpty = !entry.blueprint ||
        (!entry.blueprint.desiredOutcome &&
         !entry.blueprint.targetAudience &&
         !entry.blueprint.materialsInventory &&
         !entry.blueprint.communicationPreferences &&
         !entry.blueprint.voiceGuardrails?.tone &&
         !entry.blueprint.voiceGuardrails?.structure &&
         !entry.blueprint.voiceGuardrails?.content);

      setBlueprintBypassed(false);
      await ensureSessionForProject(projectId);
      onNavigateToProject?.(projectId);

      // Only set blueprint phase if completely empty
      setPhase(blueprintIsCompletelyEmpty ? "blueprint" : "active");

      await sendTextMessage(
        blueprintIsCompletelyEmpty
          ? `We're working inside "${entry.project.title}". The blueprint is empty, so let's set it up step by step before drafting.`
          : `We're working inside "${entry.project.title}". You're in GHOSTWRITING MODE—focus on drafting and orchestration. When you queue draft updates, immediately continue talking with the user.`,
        { skipPersist: true },
      );
    },
    [ensureSessionForProject, projectsList, sendTextMessage, onNavigateToProject],
  );

  const autoAdvanceField = useCallback(
    (currentBlueprint: Doc<"projectBlueprints"> | null) => {
      if (phase !== "blueprint") return;
      if (!currentBlueprint) return;
      if (manualFocusRef.current && activeFieldKey) {
        const stillPending = !blueprintFieldHasValue(
          currentBlueprint,
          activeFieldKey,
        );
        if (stillPending) {
          return;
        }
      }
      const nextField = BLUEPRINT_FIELD_ORDER.find(
        (field) => !blueprintFieldHasValue(currentBlueprint, field),
      );
      setActiveFieldKeyInternal(nextField ?? null);
      manualFocusRef.current = false;
    },
    [activeFieldKey, phase],
  );

  useEffect(() => {
    autoAdvanceField(blueprint);
  }, [autoAdvanceField, blueprint]);

  const setActiveFieldKey = useCallback(
    (key: BlueprintFieldKey | null, manual = false) => {
      manualFocusRef.current = manual;
      setActiveFieldKeyInternal(key);
    },
    [],
  );

  const updateFieldActivity = useCallback(
    (key: BlueprintFieldKey, activity: FieldActivity) => {
      setFieldActivity((previous) => ({
        ...previous,
        [key]: activity,
      }));
    },
    [],
  );

  const updateField = useCallback(
    async (key: BlueprintFieldKey, value: string) => {
      if (!selectedProjectId) return;
      const trimmed = normalizeTextValue(value);
      await syncBlueprintFieldMutation({
        projectId: selectedProjectId,
        field: key,
        value: trimmed,
        sessionId: sessionRecord?.sessionId,
      });
      updateFieldActivity(key, {
        source: "manual",
        updatedAt: Date.now(),
      });
      manualFocusRef.current = false;
    },
    [selectedProjectId, sessionRecord, syncBlueprintFieldMutation, updateFieldActivity],
  );

  const updateVoiceGuardrails = useCallback(
    async (value: VoiceGuardrails) => {
      if (!selectedProjectId) return;
      await syncBlueprintFieldMutation({
        projectId: selectedProjectId,
        field: "voiceGuardrails",
        value,
        sessionId: sessionRecord?.sessionId,
      });
      updateFieldActivity("voiceGuardrails", {
        source: "manual",
        updatedAt: Date.now(),
      });
    },
    [selectedProjectId, sessionRecord, syncBlueprintFieldMutation, updateFieldActivity],
  );

  const updateProjectMetadata = useCallback(
    async (updates: {
      title?: string;
      contentType?: string;
      goal?: string;
    }) => {
      if (!selectedProjectId) return;
      await updateProjectMutation({
        projectId: selectedProjectId,
        ...updates,
      });
    },
    [selectedProjectId, updateProjectMutation],
  );

  const fieldStates: BlueprintFieldState[] = useMemo(() => {
    return BLUEPRINT_FIELD_DEFINITIONS.map((definition) => {
      const value =
        definition.key === "voiceGuardrails"
          ? ""
          : normalizeTextValue(
              (blueprint?.[definition.key] as string | undefined) ?? "",
            );
      const isComplete = blueprintFieldHasValue(blueprint, definition.key);
      return {
        ...definition,
        value,
        activity: fieldActivity[definition.key],
        isComplete,
      };
    });
  }, [blueprint, fieldActivity]);

  const isBlueprintComplete = useMemo(() => {
    if (!blueprint) return false;
    return REQUIRED_BLUEPRINT_FIELDS.every((key) =>
      blueprintFieldHasValue(blueprint, key),
    );
  }, [blueprint]);

  const needsBlueprint = useMemo(() => {
    if (!blueprint) return true;
    if (!isBlueprintComplete) return true;
    return false;
  }, [blueprint, isBlueprintComplete]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!activeProject) return;

    setPhase((current) => {
      // Don't override mode selection / project list phases
      if (current === "mode-selection" || current === "awaiting-existing") {
        return current;
      }

      // Stay in blueprint ONLY if explicitly set and still empty
      if (current === "blueprint") {
        return current;
      }

      // Default to active (ghostwriting) for all project work
      return "active";
    });
  }, [activeProject, selectedProjectId]);

  useEffect(() => {
    if (!needsBlueprint && blueprintBypassed) {
      setBlueprintBypassed(false);
    }
  }, [blueprintBypassed, needsBlueprint]);

  const missingBlueprintFields = useMemo(
    () => fieldStates.filter((field) => !field.isComplete && !field.optional),
    [fieldStates],
  );

  const blueprintHasAnyCapturedValue = useMemo(
    () => fieldStates.some((field) => field.isComplete),
    [fieldStates],
  );

  const summarizeMissingBlueprintFields = useCallback((): string | null => {
    if (missingBlueprintFields.length === 0) return null;
    if (missingBlueprintFields.length === 1) {
      return missingBlueprintFields[0]?.label ?? null;
    }
    const labels = missingBlueprintFields.map((field) => field.label).filter(Boolean);
    if (labels.length === 0) return null;
    if (labels.length === 1) return labels[0] ?? null;
    const tail = labels[labels.length - 1];
    const head = labels.slice(0, -1).join(", ");
    return head ? `${head}, and ${tail}` : tail;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingBlueprintFields]);

  const beginProjectSession = useCallback(async () => {
    const targetProjectId =
      activeProject?._id ?? selectedProjectId ?? sessionRecord?.projectId ?? null;

    if (!targetProjectId) {
      await beginConversation();
      return;
    }

    await ensureSessionForProject(targetProjectId);

    let projectName = activeProject?.title ?? "this project";
    let resolvedBlueprint = blueprint;

    // SIMPLE LOGIC: Only enter blueprint if it's COMPLETELY empty
    const blueprintIsCompletelyEmpty = !blueprint ||
      (!blueprint.desiredOutcome &&
       !blueprint.targetAudience &&
       !blueprint.materialsInventory &&
       !blueprint.communicationPreferences &&
       !blueprint.voiceGuardrails?.tone &&
       !blueprint.voiceGuardrails?.structure &&
       !blueprint.voiceGuardrails?.content);

    if (blueprintIsCompletelyEmpty) {
      setPhase("blueprint");
      setBlueprintBypassed(false);
      const fieldSummary =
        summarizeMissingBlueprintFields() ?? "the blueprint fields";
      await sendTextMessage(
        `You are connected to project ${targetProjectId}. The blueprint is completely empty, so enter blueprint mode. Walk the user through ${fieldSummary} with sync_blueprint_field and update_project_metadata, then call commit_blueprint when done.`,
        { skipPersist: true },
      );
      return;
    }

    // Otherwise, ALWAYS ghostwriting mode
    setPhase("active");
    setBlueprintBypassed(false);

    let snapshotMessage: string | null = null;
    let shouldRequestSummary = false;
    let autoSummaryText: string | null = null;

    try {
      const [projectBundle, initialWorkspace, todos] = await Promise.all([
        convex.query(api.projects.getProject, {
          projectId: targetProjectId as Id<"projects">,
        }),
        convex.query(api.documents.getWorkspace, {
          projectId: targetProjectId as Id<"projects">,
        }),
        convex.query(api.todos.listForProject, {
          projectId: targetProjectId as Id<"projects">,
        }),
      ]);

      if (projectBundle?.project) {
        projectName = projectBundle.project.title ?? projectName;
      }
      if (projectBundle?.blueprint) {
        resolvedBlueprint = projectBundle.blueprint;
      }

      let workspace = initialWorkspace;
      let workspaceSnapshot = workspace as DocumentWorkspaceSnapshot;
      const draftText = workspaceSnapshot?.document?.latestDraftMarkdown ?? "";
      const summaryText = workspaceSnapshot?.document?.summary ?? "";

      const needsSummary = draftText.trim().length > 0 && summaryText.trim().length === 0;

      if (needsSummary) {
        try {
          const summaryResult = await convex.action(
            api.documents.generateDraftSummary,
            { projectId: targetProjectId as Id<"projects"> },
          );
          if (summaryResult?.summary) {
            autoSummaryText = summaryResult.summary;
            const refreshedWorkspace = await convex.query(api.documents.getWorkspace, {
              projectId: targetProjectId as Id<"projects">,
            });
            workspace = refreshedWorkspace;
            workspaceSnapshot = refreshedWorkspace as DocumentWorkspaceSnapshot;
          }
        } catch (summaryError) {
          console.error("[intake] failed to auto-generate summary", summaryError);
        }
      }

      snapshotMessage = buildProjectSnapshotMessage({
        projectName,
        blueprint: resolvedBlueprint ?? null,
        workspace: workspaceSnapshot,
        todos,
      });

      const updatedDraftText = workspaceSnapshot?.document?.latestDraftMarkdown ?? "";
      const updatedSummaryText = workspaceSnapshot?.document?.summary ?? "";
      shouldRequestSummary =
        updatedDraftText.trim().length > 0 && updatedSummaryText.trim().length === 0;

    } catch (snapshotError) {
      console.error("[intake] failed to build project snapshot", snapshotError);
    }

    await sendTextMessage(
      `You are connected to project ${targetProjectId}. You are in GHOSTWRITING MODE. Greet the user, confirm "${projectName}" is loaded. NEVER call list_projects—stay focused on this single project. If you need to refresh context, call get_project with id ${targetProjectId}. CRITICAL: When you call queue_draft_update, IMMEDIATELY continue talking with the user—do not wait for TOOL_PROGRESS. The draft updates asynchronously in the background while you keep talking with the user.`,
      { skipPersist: true },
    );

    if (snapshotMessage) {
      await sendTextMessage(snapshotMessage, { skipPersist: true });
    }

    if (autoSummaryText) {
      await sendTextMessage(
        `A fresh summary of the current draft is available for quick reference:\n${autoSummaryText}`,
        { skipPersist: true },
      );
    }

    if (shouldRequestSummary) {
      await sendTextMessage(
        "The project already has Markdown but no saved summary. Offer to capture one if the user is ready; if they agree, queue a draft update that focuses on summarizing the current draft.",
        { skipPersist: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeProject,
    beginConversation,
    blueprint,
    convex,
    ensureSessionForProject,
    sendTextMessage,
    selectedProjectId,
    sessionRecord?.projectId,
    summarizeMissingBlueprintFields,
  ]);

  const commitBlueprint = useCallback(async () => {
    if (!selectedProjectId) return;
    const result = await commitBlueprintMutation({
      projectId: selectedProjectId,
      sessionId: sessionRecord?.sessionId ?? undefined,
    });
    setActiveProject(result.project);
    setBlueprint(result.blueprint);
    setPhase("active");
    setBlueprintBypassed(false);
    manualFocusRef.current = false;
    skipBlueprintTranscriptIdsRef.current.clear();
    await sendTextMessage(
      "Summarize the captured blueprint for confirmation and invite the user to continue into drafting.",
      { skipPersist: true },
    );
  }, [
    commitBlueprintMutation,
    selectedProjectId,
    sendTextMessage,
    sessionRecord,
  ]);

  const skipBlueprint = useCallback(async () => {
    if (!needsBlueprint || blueprintBypassed) {
      setPhase("active");
      return;
    }
    const fieldSummary = summarizeMissingBlueprintFields();
    const projectName = activeProject?.title ?? "this project";
    setBlueprintBypassed(true);
    setPhase("active");
    skipBlueprintTranscriptIdsRef.current.clear();
    await sendTextMessage(
      `The user wants to skip blueprint work and start drafting ${projectName}. You are now in GHOSTWRITING MODE. Acknowledge open items${fieldSummary ? ` (${fieldSummary})` : ""}, capture TODOs, and focus on drafting. NEVER call list_projects—stay on this single project. When you call queue_draft_update, immediately continue talking with the user—don't wait.`,
      { skipPersist: true },
    );
  }, [
    activeProject?.title,
    blueprintBypassed,
    needsBlueprint,
    sendTextMessage,
    summarizeMissingBlueprintFields,
  ]);

  const resumeBlueprint = useCallback(async () => {
    if (!needsBlueprint) return;
    if (!blueprintBypassed) {
      setPhase("blueprint");
      return;
    }
    const fieldSummary =
      summarizeMissingBlueprintFields() ?? "the remaining blueprint fields";
    setBlueprintBypassed(false);
    setPhase("blueprint");
    skipBlueprintTranscriptIdsRef.current.clear();
    await sendTextMessage(
      `The user is ready to resume blueprint setup. Re-enter intake mode and work through ${fieldSummary} using sync_blueprint_field, update_project_metadata, and commit_blueprint when everything is captured.`,
      { skipPersist: true },
    );
  }, [
    blueprintBypassed,
    needsBlueprint,
    sendTextMessage,
    summarizeMissingBlueprintFields,
  ]);

  useEffect(() => {
    if (phase !== "mode-selection") return;
    const latest = [...transcripts]
      .filter((entry) => entry.speaker === "user")
      .reverse()
      .find((entry) => !modeTranscriptIdsRef.current.has(entry.id));
    if (!latest) return;
    modeTranscriptIdsRef.current.add(latest.id);
    const intent = detectModeIntent(latest.text);
    if (intent === "new") {
      void startNewProject();
    }
    if (intent === "existing") {
      void chooseExistingMode();
    }
  }, [chooseExistingMode, phase, startNewProject, transcripts]);

  useEffect(() => {
    if (phase !== "awaiting-existing") return;
    if (!projectsList.length) return;
    if (!providedProjectListRef.current) {
      providedProjectListRef.current = true;
      const annotated = projectsList
        .map((entry, index) => {
          const parts = [
            `${index + 1}. ${entry.project.title}`,
            `(projectId: ${entry.project._id})`,
          ];
          if (entry.project.status) {
            parts.push(`status: ${entry.project.status}`);
          }
          if (entry.project.contentType) {
            parts.push(`type: ${entry.project.contentType}`);
          }
          return parts.join(" ");
        })
        .join("\n");
      void sendTextMessage(
        `Here are the current projects. Use the provided projectId when calling tools:\n${annotated}`,
        { skipPersist: true },
      );
      console.log("[intake] provided project list to assistant", {
        count: projectsList.length,
        projects: projectsList.map((entry, index) => ({
          index,
          projectId: entry.project._id,
          title: entry.project.title,
          status: entry.project.status,
        })),
      });
    }
    const latest = [...transcripts]
      .filter((entry) => entry.speaker === "user")
      .reverse()
      .find((entry) => !existingTranscriptIdsRef.current.has(entry.id));
    if (!latest) return;
    existingTranscriptIdsRef.current.add(latest.id);
    console.log("[intake] user mentioned project", { text: latest.text });
    const match = detectProjectByText(latest.text, projectsList);
    if (match) {
      console.log("[intake] matched project from speech", {
        projectId: match.project._id,
        title: match.project.title,
      });
      void openProject(match.project._id);
    }
  }, [openProject, phase, projectsList, transcripts]);

  useEffect(() => {
    if (phase !== "blueprint") return;
    if (!activeFieldKey) return;
    if (activeFieldKey === "voiceGuardrails") return;
    if (!selectedProjectId) return;
    const latest = [...transcripts]
      .filter((entry) => entry.speaker === "user")
      .reverse()
      .find((entry) => !fieldTranscriptIdsRef.current.has(entry.id));
    if (!latest) return;
    const trimmed = normalizeTextValue(latest.text);
    if (trimmed.length < 6) return;
    fieldTranscriptIdsRef.current.add(latest.id);
    void (async () => {
      await syncBlueprintFieldMutation({
        projectId: selectedProjectId,
        field: activeFieldKey,
        value: trimmed,
        sessionId: sessionRecord?.sessionId,
        messageId: resolveMessageId(latest.id) ?? undefined,
      });
      updateFieldActivity(activeFieldKey, {
        source: "voice",
        updatedAt: Date.now(),
        transcriptId: latest.id,
      });
    })();
  }, [
    activeFieldKey,
    phase,
    resolveMessageId,
    selectedProjectId,
    sessionRecord,
    syncBlueprintFieldMutation,
    transcripts,
    updateFieldActivity,
  ]);

  useEffect(() => {
    if (phase !== "blueprint") return;
    if (!needsBlueprint || blueprintBypassed) return;
    const latest = [...transcripts]
      .filter((entry) => entry.speaker === "user")
      .reverse()
      .find((entry) => !skipBlueprintTranscriptIdsRef.current.has(entry.id));
    if (!latest) return;
    skipBlueprintTranscriptIdsRef.current.add(latest.id);
    const normalized = latest.text.toLowerCase();
    const mentionsSkip =
      normalized.includes("skip") ||
      normalized.includes("later") ||
      normalized.includes("not now") ||
      normalized.includes("don't worry");
    const mentionsSetup =
      normalized.includes("setup") ||
      normalized.includes("set up") ||
      normalized.includes("blueprint") ||
      normalized.includes("intake") ||
      normalized.includes("questions") ||
      normalized.includes("details");
    const wantsDraft =
      normalized.includes("draft") ||
      normalized.includes("write") ||
      normalized.includes("writing") ||
      normalized.includes("article") ||
      normalized.includes("document") ||
      normalized.includes("story");
    const goKeywords =
      normalized.includes("start") ||
      normalized.includes("begin") ||
      normalized.includes("jump") ||
      normalized.includes("move on") ||
      normalized.includes("just") ||
      normalized.includes("straight") ||
      normalized.includes("dive");
    const skipIntent =
      (mentionsSkip && (mentionsSetup || wantsDraft)) ||
      (wantsDraft && goKeywords);
    if (skipIntent) {
      void skipBlueprint();
    }
  }, [blueprintBypassed, needsBlueprint, phase, skipBlueprint, transcripts]);

  useEffect(() => {
    if (status === "idle" || status === "ended") {
      setPhase("idle");
      setModeIntent(null);
      if (!initialProjectId) {
        setSelectedProjectId(null);
      }
      setBlueprintBypassed(false);
      skipBlueprintTranscriptIdsRef.current.clear();
    }
  }, [initialProjectId, status]);

  const clearProject = useCallback(() => {
    console.log("[intake] Clearing project state");
    setSelectedProjectId(null);
    setActiveProject(null);
    setBlueprint(null);
    setPhase("idle");
    setModeIntent(null);
    setBlueprintBypassed(false);
    setActiveFieldKeyInternal(null);
    setFieldActivity({});
  }, []);

  return {
    phase,
    modeIntent,
    projects: projectsList,
    isLoadingProjects: projects === undefined,
    isProjectContextHydrated,
    activeProject,
    blueprint,
    fieldStates,
    activeFieldKey,
    beginConversation,
    beginProjectSession,
    chooseExistingMode,
    startNewProject,
    openProject,
    clearProject,
    setActiveFieldKey,
    updateField,
    updateVoiceGuardrails,
    updateProjectMetadata,
    isBlueprintComplete,
    isBlueprintBypassed: blueprintBypassed,
    commitBlueprint,
    skipBlueprint,
    resumeBlueprint,
  };
}
