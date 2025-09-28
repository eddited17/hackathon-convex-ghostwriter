"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  BLUEPRINT_FIELD_DEFINITIONS,
  BLUEPRINT_FIELD_ORDER,
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
  ingestProjects: RealtimeSessionState["ingestProjects"];
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
  setActiveFieldKey: (key: BlueprintFieldKey | null, manual?: boolean) => void;
  updateField: (key: BlueprintFieldKey, value: string) => Promise<void>;
  updateVoiceGuardrails: (value: VoiceGuardrails) => Promise<void>;
  updateProjectMetadata: (updates: {
    title?: string;
    contentType?: string;
    goal?: string;
  }) => Promise<void>;
  isBlueprintComplete: boolean;
  commitBlueprint: () => Promise<void>;
}

export function useProjectIntakeFlow({
  transcripts,
  status,
  startSession,
  sendTextMessage,
  sessionRecord,
  assignProjectToSession,
  resolveMessageId,
  ingestProjects,
  onNavigateToProject,
  initialProjectId,
}: UseProjectIntakeFlowOptions): ProjectIntakeState {
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
  const manualFocusRef = useRef(false);
  const modeTranscriptIdsRef = useRef(new Set<string>());
  const existingTranscriptIdsRef = useRef(new Set<string>());
  const fieldTranscriptIdsRef = useRef(new Set<string>());
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
  }, [sessionRecord?.projectId]);

  const projectsList = useMemo<ProjectListEntry[]>(
    () => projects ?? [],
    [projects],
  );

  useEffect(() => {
    if (!projectsList.length) return;
    ingestProjects(projectsList);
  }, [ingestProjects, projectsList]);

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
    providedProjectListRef.current = false;
    setModeIntent(null);
    setSelectedProjectId(null);
    setActiveProject(null);
    setBlueprint(null);
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
    manualFocusRef.current = false;
    fieldTranscriptIdsRef.current.clear();
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
      await ensureSessionForProject(projectId);
      onNavigateToProject?.(projectId);

      if (entry.project.status === "intake" || entry.blueprint?.status !== "committed") {
        setPhase("blueprint");
      } else {
        setPhase("active");
      }

      await sendTextMessage(
        `We’re working inside "${entry.project.title}". Acknowledge the selection and pull up the latest blueprint highlights.`,
        { skipPersist: true },
      );
    },
    [ensureSessionForProject, projectsList, sendTextMessage],
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
    return BLUEPRINT_FIELD_ORDER.every((key) =>
      blueprintFieldHasValue(blueprint, key),
    );
  }, [blueprint]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!activeProject) return;
    const needsBlueprint =
      !blueprint || blueprint.status !== "committed" || !isBlueprintComplete;
    setPhase((current) => {
      if (needsBlueprint) {
        return current === "blueprint" ? current : "blueprint";
      }
      return current === "active" ? current : "active";
    });
  }, [activeProject, blueprint, isBlueprintComplete, selectedProjectId]);

  const missingBlueprintFields = useMemo(
    () => fieldStates.filter((field) => !field.isComplete),
    [fieldStates],
  );

  const beginProjectSession = useCallback(async () => {
    const targetProjectId =
      activeProject?._id ?? selectedProjectId ?? sessionRecord?.projectId ?? null;

    if (!targetProjectId) {
      await beginConversation();
      return;
    }

    await ensureSessionForProject(targetProjectId);

    const projectName = activeProject?.title ?? "this project";

    if (!blueprint || blueprint.status !== "committed" || !isBlueprintComplete) {
      const fieldLabels = missingBlueprintFields.map((field) => field.label);
      const fieldSummary = (() => {
        if (fieldLabels.length === 0) return "the remaining blueprint fields";
        if (fieldLabels.length === 1) return fieldLabels[0];
        const tail = fieldLabels[fieldLabels.length - 1];
        const head = fieldLabels.slice(0, -1).join(", ");
        return `${head}, and ${tail}`;
      })();
      const needsProjectTitleConfirmation = !(
        activeProject?.title && activeProject.title.trim().length > 0 &&
        !activeProject.title.toLowerCase().startsWith("untitled")
      );
      const titleHint = needsProjectTitleConfirmation
        ? " Also confirm whether they want to set or update the project name via update_project_metadata."
        : "";
      await sendTextMessage(
        `You are connected to project ${targetProjectId}. Open with a concise greeting that acknowledges "${projectName}" is already loaded. Explain that setup mode is available because the blueprint still needs ${fieldSummary}, then ask if the user wants to enter setup mode now. If they agree, walk through each missing item using sync_blueprint_field (repeat updates if they refine answers), keep list_projects off since the project is already assigned, and call update_project_metadata for the title when needed.${titleHint} If they prefer to skip, acknowledge it and continue in project editing mode without trying to fill the remaining setup items. Use get_project with id ${targetProjectId} if you need fresh details, but only after greeting them.`,
        { skipPersist: true },
      );
      return;
    }

    await sendTextMessage(
      `You are connected to project ${targetProjectId}. Start with a quick greeting that mentions "${projectName}" is ready to work on. Do not call list_projects. If you need fresh context, call get_project with id ${targetProjectId} after greeting the user. Otherwise, ask how you can advance the next draft or deliverable right away.`,
      { skipPersist: true },
    );
  }, [
    activeProject,
    beginConversation,
    blueprint,
    ensureSessionForProject,
    isBlueprintComplete,
    missingBlueprintFields,
    sendTextMessage,
    selectedProjectId,
    sessionRecord?.projectId,
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
    manualFocusRef.current = false;
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
    if (status === "idle" || status === "ended") {
      setPhase("idle");
      setModeIntent(null);
      if (!initialProjectId) {
        setSelectedProjectId(null);
      }
    }
  }, [initialProjectId, status]);

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
    setActiveFieldKey,
    updateField,
    updateVoiceGuardrails,
    updateProjectMetadata,
    isBlueprintComplete,
    commitBlueprint,
  };
}
