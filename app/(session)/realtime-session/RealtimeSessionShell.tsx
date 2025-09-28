"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  CONTENT_TYPE_OPTIONS,
  BLUEPRINT_FIELD_ORDER,
  blueprintFieldHasValue,
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
import DocumentWorkspace from "./DocumentWorkspace";
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

const getContentTypeLabel = (value: string) =>
  CONTENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;

type TranscriptListProps = {
  transcripts: RealtimeSessionState["transcripts"];
  partialUserTranscript: string | null;
  partialAssistantTranscript: string | null;
};

function TranscriptList({ transcripts, partialAssistantTranscript, partialUserTranscript }: TranscriptListProps) {
  return (
    <ol className="transcript-list">
      {transcripts.length === 0 && !partialAssistantTranscript && !partialUserTranscript ? (
        <li className="placeholder">Start speaking to populate the transcript.</li>
      ) : null}
      {transcripts.map((entry) => (
        <li key={entry.id} className={`transcript transcript-${entry.speaker}`}>
          <div className="transcript-meta">
            <span className="speaker">{entry.speaker === "user" ? "You" : "Assistant"}</span>
            <time dateTime={new Date(entry.timestamp).toISOString()}>
              {formatTime(entry.timestamp)}
            </time>
          </div>
          <p>{entry.text}</p>
        </li>
      ))}
      {partialUserTranscript ? (
        <li className="transcript transcript-user transcript-partial">
          <div className="transcript-meta">
            <span className="speaker">You</span>
            <span className="partial-indicator">capturing…</span>
          </div>
          <p>{partialUserTranscript}</p>
        </li>
      ) : null}
      {partialAssistantTranscript ? (
        <li className="transcript transcript-assistant transcript-partial">
          <div className="transcript-meta">
            <span className="speaker">Assistant</span>
            <span className="partial-indicator">responding…</span>
          </div>
          <p>{partialAssistantTranscript}</p>
        </li>
      ) : null}
    </ol>
  );
}

type DiagnosticsProps = {
  connectionLog: RealtimeSessionState["connectionLog"];
  serverEvents: RealtimeSessionState["serverEvents"];
};

type DraftSnapshot = {
  wordCount: number;
  todoCount: number;
  sections: Array<{
    title: string;
    status: "drafting" | "needs_detail" | "complete";
  }>;
};

function Diagnostics({ connectionLog, serverEvents }: DiagnosticsProps) {
  const recentServerEvents = serverEvents.slice(-12).reverse();
  return (
    <div className="diagnostics">
      <section>
        <h3>Connection log</h3>
        <ul>
          {connectionLog.length === 0 ? (
            <li className="placeholder">No connection activity yet.</li>
          ) : (
            connectionLog
              .slice(-12)
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  <span className="time">{formatTime(event.timestamp)}</span>
                  <span>{event.message}</span>
                </li>
              ))
          )}
        </ul>
      </section>
      <section>
        <h3>Realtime events</h3>
        <ul>
          {recentServerEvents.length === 0 ? (
            <li className="placeholder">Events will appear after the session starts.</li>
          ) : (
            recentServerEvents.map((event) => (
              <li key={event.id}>
                <span className="time">{formatTime(event.timestamp)}</span>
                <span>{event.type}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

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
    isConnected,
    startSession,
    stopSession,
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
    updateInstructionContext,
  } = useRealtimeSessionContext();

  const {
    phase,
    projects: projectEntries,
    isLoadingProjects,
    isProjectContextHydrated,
    activeProject,
    blueprint,
    fieldStates,
    activeFieldKey,
    beginConversation,
    beginProjectSession,
    openProject,
    setActiveFieldKey: focusBlueprintField,
    updateField,
    updateVoiceGuardrails,
    updateProjectMetadata,
    isBlueprintComplete,
    commitBlueprint,
  } = useProjectIntakeFlow({
    transcripts,
    status,
    startSession,
    sendTextMessage,
    sessionRecord,
    assignProjectToSession,
    resolveMessageId,
    ingestProjects,
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
  const [draftSnapshot, setDraftSnapshot] = useState<DraftSnapshot | null>(null);

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
    if (phase === "active") {
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
      return;
    }
    if (phase === "blueprint") {
      const missingFields = fieldStates
        .filter((field) => !field.isComplete)
        .map((field) => field.key);
      updateInstructionContext({
        mode: "blueprint",
        blueprintSummary: { missingFields },
        draftingSnapshot: undefined,
      });
      return;
    }
    updateInstructionContext({
      mode: "intake",
      blueprintSummary: undefined,
      draftingSnapshot: undefined,
    });
  }, [draftSnapshot, fieldStates, phase, updateInstructionContext]);

  const audioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      registerAudioElement(element);
    },
    [registerAudioElement],
  );

  const selectedProjectId = activeProject?._id ?? sessionRecord?.projectId ?? null;
  const hasExplicitProjectContext = Boolean(projectId ?? selectedProjectId);

  const handleBeginConversation = useCallback(() => {
    if (hasExplicitProjectContext) {
      if (!isProjectContextHydrated) {
        console.warn("Project context still loading; delaying session start.");
        return;
      }
      void beginProjectSession();
      return;
    }
    void beginConversation();
  }, [
    beginConversation,
    beginProjectSession,
    isProjectContextHydrated,
    hasExplicitProjectContext,
  ]);

  const handleStop = useCallback(() => {
    void stopSession("Session ended by user");
  }, [stopSession]);

  const handleManualSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!manualMessage.trim()) return;
      void sendTextMessage(manualMessage).then(() => setManualMessage(""));
    },
    [manualMessage, sendTextMessage],
  );

  const blueprintProgress = fieldStates.filter((field) => field.isComplete).length;
  const blueprintTotal = fieldStates.length;
  const blueprintStatus = blueprint?.status ?? "draft";
  const sessionStartedAtLabel = sessionRecord?.startedAt
    ? formatDate(sessionRecord.startedAt)
    : null;

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

  return (
    <div className="realtime-shell project-shell">
      <header className="shell-toolbar">
        {breadcrumbs}
        <h2>{projectTitle}</h2>

        <div className="toolbar-actions">
          {isConnected ? (
            <button className="danger" onClick={handleStop}>
              End session
            </button>
          ) : (
            <button
              className="primary"
              onClick={handleBeginConversation}
              disabled={
                status === "connecting" ||
                status === "requesting-permissions" ||
                (hasExplicitProjectContext && !isProjectContextHydrated)
              }
            >
              Start conversation
            </button>
          )}
        </div>
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

      {activeTab === "document" ? (
        <div className="document-tab">
          <section className="panel project-panel">
            <div className="panel-header">
              <h2>Project overview</h2>
              {isLoadingProjects ? <span className="chip">Loading…</span> : null}
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

            <div className="project-list-wrapper">
              <h3>Recent projects</h3>
              <ul className="project-list">
                {projectEntries && projectEntries.length > 0 ? (
                  projectEntries.map((entry, index) => {
                    const blueprintComplete = entry.blueprint
                      ? BLUEPRINT_FIELD_ORDER.filter((key) =>
                          blueprintFieldHasValue(entry.blueprint!, key),
                        ).length
                      : 0;
                    const blueprintCount = BLUEPRINT_FIELD_ORDER.length;
                    const isActive = selectedProjectId === entry.project._id;
                    return (
                      <li key={entry.project._id}>
                        <button
                          type="button"
                          className={`project-card ${isActive ? "active" : ""}`}
                          onClick={() => {
                            void openProject(entry.project._id);
                          }}
                        >
                          <div className="project-card-header">
                            <span className="project-card-index">{index + 1}</span>
                            <span className="project-card-title">
                              {entry.project.title}
                            </span>
                          </div>
                          <div className="project-card-meta">
                            <span>{getContentTypeLabel(entry.project.contentType)}</span>
                            <span>Updated {formatDate(entry.project.updatedAt)}</span>
                          </div>
                          <div className="project-card-blueprint">
                            <span>{entry.blueprint?.status ?? "draft"}</span>
                            <span>
                              {blueprintComplete}/{blueprintCount} fields
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })
                ) : (
                  <li className="placeholder">
                    Start a blueprint to see it listed here.
                  </li>
                )}
              </ul>
            </div>
          </section>
          {phase !== "active" ? (
            <div className="document-placeholder">
              <p>
                The document view unlocks after the blueprint is committed. Use the
                Session settings tab to finish capturing project details.
              </p>
            </div>
          ) : null}
          <DocumentWorkspace
            projectId={selectedProjectId}
            blueprint={blueprint}
            fieldStates={fieldStates}
            onSnapshot={setDraftSnapshot}
          />
        </div>
      ) : (
        <div className="settings-grid">
          <div className="settings-column">
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
            <section className="panel transcripts-panel">
              <div className="panel-header">
                <h2>Conversation transcript</h2>
                {sessionStartedAtLabel ? (
                  <span className="panel-subtitle">Started {sessionStartedAtLabel}</span>
                ) : null}
              </div>
              <TranscriptList
                transcripts={transcripts}
                partialAssistantTranscript={partialAssistantTranscript}
                partialUserTranscript={partialUserTranscript}
              />
              <form className="manual-entry" onSubmit={handleManualSubmit}>
                <label>
                  Manual text reply
                  <textarea
                    value={manualMessage}
                    onChange={(event) => setManualMessage(event.target.value)}
                    placeholder="Type a quick response when you can’t speak"
                    disabled={!isConnected}
                  />
                </label>
                <button type="submit" disabled={!isConnected || !manualMessage.trim()}>
                  Send to assistant
                </button>
              </form>
              <div className="diagnostics-inline">
                <Diagnostics connectionLog={connectionLog} serverEvents={serverEvents} />
              </div>
            </section>
          </div>
          <SessionControlBar />
        </div>
      )}
      <audio ref={audioRef} className="hidden-audio" />
    </div>
  );
}
