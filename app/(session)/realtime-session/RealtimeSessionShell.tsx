"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CONTENT_TYPE_OPTIONS,
  type BlueprintFieldKey,
  type ContentType,
  type VoiceGuardrails,
} from "@/lib/projects";

import type { Id } from "@/convex/_generated/dataModel";
import {
  type RealtimeSessionState,
} from "./useRealtimeSession";
import { useProjectIntakeFlow } from "./useProjectIntakeFlow";
import { useRealtimeSessionContext } from "./RealtimeSessionProvider";
import DynamicDocumentView from "./DynamicDocumentView";
import SessionControlBar from "./SessionControlBar";

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);

const formatDate = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

type DraftSnapshot = {
  wordCount: number;
  todoCount: number;
  sections: Array<{
    title: string;
    status: "drafting" | "needs_detail" | "complete";
  }>;
};

export default function RealtimeSessionShell({
  projectTitle,
  breadcrumbs,
  projectId,
}: {
  projectTitle: string;
  breadcrumbs: JSX.Element;
  projectId?: Id<"projects">;
}) {
  const router = useRouter();
  const {
    status,
    startSession,
    stopSession,
    transcripts,
    draftProgress,
    error,
    sendTextMessage,
    registerAudioElement,
    sessionRecord,
    assignProjectToSession,
    resolveMessageId,
    instructionContext,
    updateInstructionContext,
  } = useRealtimeSessionContext();

  const {
    phase,
    isProjectContextHydrated,
    activeProject,
    blueprint,
    fieldStates,
    activeFieldKey,
    beginConversation,
    beginProjectSession,
    setActiveFieldKey: focusBlueprintField,
    updateField,
    updateVoiceGuardrails,
    updateProjectMetadata,
    isBlueprintComplete,
    isBlueprintBypassed,
    commitBlueprint,
    skipBlueprint,
    resumeBlueprint,
  } = useProjectIntakeFlow({
    transcripts,
    status,
    startSession,
    sendTextMessage,
    sessionRecord,
    assignProjectToSession,
    resolveMessageId,
    onNavigateToProject: (targetProjectId) => {
      if (projectId && targetProjectId === projectId) return;
      router.push(`/projects/${targetProjectId}`);
    },
    initialProjectId: projectId ?? null,
  });

  const [manualMessage, setManualMessage] = useState("");
  const [fieldDrafts, setFieldDrafts] = useState<
    Partial<Record<BlueprintFieldKey, string>>
  >({});
  const [voiceDraft, setVoiceDraft] = useState<VoiceGuardrails>({
    tone: "",
    structure: "",
    content: "",
  });
  const [titleDraft, setTitleDraft] = useState("");
  const [goalDraft, setGoalDraft] = useState("");
  const [contentTypeDraft, setContentTypeDraft] = useState<ContentType>("article");
  const [activeTab, setActiveTab] = useState<"document" | "settings">("document");
  const [draftSnapshot] = useState<DraftSnapshot | null>(null);

  useEffect(() => {
    const next: Partial<Record<BlueprintFieldKey, string>> = {};
    fieldStates.forEach((field) => {
      if (field.key !== "voiceGuardrails") {
        next[field.key] = field.value;
      }
    });
    setFieldDrafts((previous) => {
      const nextKeys = Object.keys(next) as BlueprintFieldKey[];
      const previousKeys = Object.keys(previous) as BlueprintFieldKey[];
      const hasChanges =
        nextKeys.length !== previousKeys.length ||
        nextKeys.some((key) => previous[key] !== next[key]);
      return hasChanges ? next : previous;
    });
    const nextVoice: VoiceGuardrails = {
      tone: blueprint?.voiceGuardrails?.tone ?? "",
      structure: blueprint?.voiceGuardrails?.structure ?? "",
      content: blueprint?.voiceGuardrails?.content ?? "",
    };
    setVoiceDraft((previous) => {
      const changed =
        previous.tone !== nextVoice.tone ||
        previous.structure !== nextVoice.structure ||
        previous.content !== nextVoice.content;
      return changed ? nextVoice : previous;
    });
  }, [fieldStates, blueprint?.voiceGuardrails]);

  useEffect(() => {
    setTitleDraft(activeProject?.title ?? "");
    setGoalDraft(activeProject?.goal ?? "");
    setContentTypeDraft(
      (activeProject?.contentType as ContentType) ?? "article",
    );
  }, [
    activeProject?._id,
    activeProject?.title,
    activeProject?.goal,
    activeProject?.contentType,
  ]);

  useEffect(() => {
    // SIMPLE MODE LOGIC:
    // - No project selected → INTAKE
    // - Project selected + blueprint completely empty → BLUEPRINT
    // - Everything else → GHOSTWRITING

    const hasProject = Boolean(activeProject?._id);
    const blueprintIsCompletelyEmpty = !blueprint ||
      (!blueprint.desiredOutcome &&
       !blueprint.targetAudience &&
       !blueprint.materialsInventory &&
       !blueprint.communicationPreferences &&
       !blueprint.voiceGuardrails?.tone &&
       !blueprint.voiceGuardrails?.structure &&
       !blueprint.voiceGuardrails?.content);

    if (!hasProject) {
      // INTAKE MODE: Project list selection
      console.log("[session] Mode → INTAKE (no project selected)");
      updateInstructionContext({
        mode: "intake",
        blueprintSummary: undefined,
        draftingSnapshot: undefined,
        latestDraftUpdate: undefined,
      });
      return;
    }

    if (blueprintIsCompletelyEmpty && phase === "blueprint") {
      // BLUEPRINT MODE: Only when blueprint is completely empty AND we're explicitly in blueprint phase
      const missingFields = fieldStates
        .filter((field) => !field.isComplete)
        .map((field) => field.key);
      console.log("[session] Mode → BLUEPRINT (empty blueprint)", { missingFields });
      updateInstructionContext({
        mode: "blueprint",
        blueprintSummary: { missingFields },
        draftingSnapshot: undefined,
        latestDraftUpdate: undefined,
      });
      return;
    }

    // GHOSTWRITING MODE: Default when working on a project
    console.log("[session] Mode → GHOSTWRITING", {
      hasProject,
      blueprintEmpty: blueprintIsCompletelyEmpty,
      phase
    });
    updateInstructionContext({
      mode: "ghostwriting",
      blueprintSummary: undefined,
      draftingSnapshot: draftSnapshot
        ? {
            todoCount: draftSnapshot.todoCount,
            sections: draftSnapshot.sections,
          }
        : undefined,
    });
  }, [activeProject, blueprint, draftSnapshot, fieldStates, phase, updateInstructionContext]);

  const audioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      registerAudioElement(element);
    },
    [registerAudioElement],
  );

  const selectedProjectId = activeProject?._id ?? sessionRecord?.projectId ?? null;

  const blueprintProgress = fieldStates.filter((field) => field.isComplete).length;
  const blueprintTotal = fieldStates.length;
  const blueprintStatus = blueprint?.status ?? "draft";

  const handleFieldDraftChange = useCallback(
    (key: BlueprintFieldKey, value: string) => {
      setFieldDrafts((previous) => ({
        ...previous,
        [key]: value,
      }));
    },
    [],
  );

  const handleFieldBlur = useCallback(
    (key: BlueprintFieldKey) => {
      const value = fieldDrafts[key] ?? "";
      void updateField(key, value);
    },
    [fieldDrafts, updateField],
  );

  const handleVoiceChange = useCallback(
    (key: keyof VoiceGuardrails, value: string) => {
      setVoiceDraft((previous) => ({
        ...previous,
        [key]: value,
      }));
    },
    [],
  );

  const handleVoiceBlur = useCallback(() => {
    void updateVoiceGuardrails(voiceDraft);
  }, [updateVoiceGuardrails, voiceDraft]);

  const handleTitleBlur = useCallback(() => {
    if (!activeProject) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === activeProject.title) return;
    void updateProjectMetadata({ title: trimmed });
  }, [activeProject, titleDraft, updateProjectMetadata]);

  const handleGoalBlur = useCallback(() => {
    if (!activeProject) return;
    const trimmed = goalDraft.trim();
    if (trimmed === (activeProject.goal ?? "")) return;
    void updateProjectMetadata({ goal: trimmed });
  }, [activeProject, goalDraft, updateProjectMetadata]);

  const handleContentTypeChange = useCallback(
    (value: ContentType) => {
      setContentTypeDraft(value);
      if (!activeProject || activeProject.contentType === value) return;
      void updateProjectMetadata({ contentType: value });
    },
    [activeProject, updateProjectMetadata],
  );

  const handleSkipBlueprint = useCallback(() => {
    void skipBlueprint();
  }, [skipBlueprint]);

  const handleResumeBlueprint = useCallback(() => {
    void resumeBlueprint();
  }, [resumeBlueprint]);

  return (
    <div className="realtime-shell project-shell">
      <header className="shell-toolbar">
        {breadcrumbs}
        <h2>{projectTitle}</h2>
      </header>

      {!isProjectContextHydrated && hasExplicitProjectContext ? (
        <div className="alert">Preparing project context…</div>
      ) : null}

      {error && status !== "error" ? (
        <div className="alert">{error}</div>
      ) : null}

      <div className="session-tabs">
        <button
          type="button"
          className={`tab-button ${activeTab === "document" ? "active" : ""}`}
          onClick={() => setActiveTab("document")}
        >
          Document
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => setActiveTab("settings")}
        >
          Session settings
        </button>
      </div>

      <div className="session-layout">
        <div className="session-main-column">
          {activeTab === "document" ? (
            <>
              {phase !== "active" ? (
                <div className="document-placeholder">
                  <p>
                    The document view unlocks after the blueprint is committed. Use the
                    Session settings tab to finish capturing project details or select
                    Skip setup & start drafting.
                  </p>
                </div>
              ) : null}
              <DynamicDocumentView
                projectId={selectedProjectId}
                realtimeStatus={draftProgress}
                mode={instructionContext.mode}
                autoScroll={true}
              />
            </>
          ) : (
            <div className="settings-container">
              <section className="panel project-panel">
                <div className="panel-header">
                  <h2>Project overview</h2>
                </div>
                <div className="project-meta">
                  <label>
                    <span>Project title</span>
                    <input
                      type="text"
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={handleTitleBlur}
                      placeholder="Name this project"
                      disabled={!activeProject}
                    />
                  </label>
                  <label>
                    <span>Content type</span>
                    <select
                      value={contentTypeDraft}
                      onChange={(event) =>
                        handleContentTypeChange(event.target.value as ContentType)
                      }
                      disabled={!activeProject}
                    >
                      {CONTENT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Project goal</span>
                    <textarea
                      value={goalDraft}
                      onChange={(event) => setGoalDraft(event.target.value)}
                      onBlur={handleGoalBlur}
                      placeholder="Describe the outcome we’re chasing"
                      rows={3}
                      disabled={!activeProject}
                    />
                  </label>
                  <div className="project-progress">
                    <span>Blueprint</span>
                    <span>
                      {blueprintProgress}/{blueprintTotal} • {blueprintStatus}
                    </span>
                  </div>
                </div>

                <p className="project-hint">
                  Review and adjust project metadata. Voice updates push straight into these fields.
                </p>
              </section>
              <section className="panel blueprint-panel">
                <div className="panel-header">
                  <h2>Blueprint fields</h2>
                  <div className="blueprint-summary">
                    <span className={`blueprint-status status-${blueprintStatus}`}>
                      {blueprintStatus}
                    </span>
                    <span>
                      {blueprintProgress}/{blueprintTotal} complete
                    </span>
                  </div>
                </div>
                {!isBlueprintComplete ? (
                  <div className="blueprint-actions">
                    {phase === "blueprint" ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={handleSkipBlueprint}
                      >
                        Skip setup & start drafting
                      </button>
                    ) : isBlueprintBypassed ? (
                      <button
                        type="button"
                        className="text-button"
                        onClick={handleResumeBlueprint}
                      >
                        Resume setup
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <p className="panel-description">
                  During blueprint mode the assistant fills these fields automatically.
                  You can adjust them anytime.
                </p>
                <div className="blueprint-fields">
                  {fieldStates
                    .filter((field) => field.key !== "voiceGuardrails")
                    .map((field) => (
                      <div
                        key={field.key}
                        className={`blueprint-field ${
                          activeFieldKey === field.key ? "active" : ""
                        }`}
                        onClick={() => focusBlueprintField(field.key, true)}
                      >
                        <div className="field-header">
                          <h3>{field.label}</h3>
                          {field.activity ? (
                            <span className={`field-activity badge-${field.activity.source}`}>
                              {field.activity.source === "voice"
                                ? "Captured from voice"
                                : "Manual edit"}
                              {field.activity.updatedAt
                                ? ` · ${formatTime(field.activity.updatedAt)}`
                                : null}
                            </span>
                          ) : null}
                        </div>
                        <p className="field-helper">{field.helper}</p>
                        <textarea
                          value={fieldDrafts[field.key] ?? ""}
                          onChange={(event) =>
                            handleFieldDraftChange(field.key, event.target.value)
                          }
                          onBlur={() => handleFieldBlur(field.key)}
                          placeholder={field.placeholder}
                          rows={field.type === "text" ? 2 : 4}
                        />
                        {phase === "blueprint" && activeFieldKey === field.key ? (
                          <span className="field-status">Listening for your answer…</span>
                        ) : null}
                      </div>
                    ))}
                  <div
                    className={`blueprint-field voice ${
                      activeFieldKey === "voiceGuardrails" ? "active" : ""
                    }`}
                    onClick={() => focusBlueprintField("voiceGuardrails", true)}
                  >
                    <div className="field-header">
                      <h3>Voice guardrails</h3>
                    </div>
                    <p className="field-helper">
                      Tone cues, structural preferences, and content boundaries to keep drafts aligned.
                    </p>
                    <div className="voice-grid">
                      <label>
                        <span>Tone</span>
                        <textarea
                          value={voiceDraft.tone ?? ""}
                          onChange={(event) =>
                            handleVoiceChange("tone", event.target.value)
                          }
                          onBlur={handleVoiceBlur}
                          rows={2}
                        />
                      </label>
                      <label>
                        <span>Structure</span>
                        <textarea
                          value={voiceDraft.structure ?? ""}
                          onChange={(event) =>
                            handleVoiceChange("structure", event.target.value)
                          }
                          onBlur={handleVoiceBlur}
                          rows={2}
                        />
                      </label>
                      <label>
                        <span>Content boundaries</span>
                        <textarea
                          value={voiceDraft.content ?? ""}
                          onChange={(event) =>
                            handleVoiceChange("content", event.target.value)
                          }
                          onBlur={handleVoiceBlur}
                          rows={2}
                        />
                      </label>
                    </div>
                  </div>
                </div>
                {phase === "blueprint" ? (
                  <button
                    className="primary"
                    onClick={() => {
                      void commitBlueprint();
                    }}
                    disabled={!isBlueprintComplete}
                  >
                    Commit blueprint & continue
                  </button>
                ) : null}
              </section>
            </div>
          )}
        </div>
        <SessionControlBar />
      </div>
      <audio ref={audioRef} className="hidden-audio" />
    </div>
  );
}
