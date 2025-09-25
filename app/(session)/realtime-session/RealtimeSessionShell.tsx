"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { NoiseReductionProfile } from "@/lib/realtimeAudio";
import {
  CONTENT_TYPE_OPTIONS,
  BLUEPRINT_FIELD_ORDER,
  blueprintFieldHasValue,
  type BlueprintFieldKey,
  type ContentType,
  type VoiceGuardrails,
} from "@/lib/projects";

import {
  NOISE_REDUCTION_OPTIONS,
  useRealtimeSession,
} from "./useRealtimeSession";
import { useProjectIntakeFlow } from "./useProjectIntakeFlow";

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

const phaseLabels: Record<string, { label: string; helper: string }> = {
  idle: {
    label: "Idle",
    helper: "Start the assistant to choose a project context.",
  },
  "mode-selection": {
    label: "Choosing project context",
    helper: "Listening for new vs. existing project.",
  },
  "awaiting-existing": {
    label: "Waiting for project",
    helper: "Say a project name or tap a card to continue.",
  },
  blueprint: {
    label: "Blueprint intake",
    helper: "Capturing success outcomes, audience, and guardrails.",
  },
  active: {
    label: "Ghostwriting mode",
    helper: "Blueprint confirmed—continue drafting and notes.",
  },
};

const getContentTypeLabel = (value: string) =>
  CONTENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;

type DeviceSelectProps = {
  label: string;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange: (deviceId: string) => Promise<void>;
  disabled?: boolean;
};

function DeviceSelect({ label, devices, value, onChange, disabled }: DeviceSelectProps) {
  return (
    <label className="device-select">
      <span>{label}</span>
      <select
        disabled={disabled || devices.length === 0}
        value={value ?? ""}
        onChange={(event) => {
          void onChange(event.target.value);
        }}
      >
        {devices.length === 0 && <option value="">No devices detected</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${device.kind} (${device.deviceId})`}
          </option>
        ))}
      </select>
    </label>
  );
}

type LevelMeterProps = {
  label: string;
  level: number;
  active: boolean;
  tone: "primary" | "secondary";
};

function LevelMeter({ label, level, active, tone }: LevelMeterProps) {
  const width = Math.min(100, Math.round(level * 100));
  return (
    <div className={`level-meter level-${tone}`}>
      <div className="level-header">
        <span>{label}</span>
        <span className={`badge ${active ? "badge-active" : ""}`}>
          {active ? "speaking" : "idle"}
        </span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

type NoiseReductionToggleProps = {
  value: NoiseReductionProfile;
  onChange: (profile: NoiseReductionProfile) => void;
  disabled?: boolean;
};

function NoiseReductionToggle({ value, onChange, disabled }: NoiseReductionToggleProps) {
  return (
    <fieldset className="noise-toggle" disabled={disabled}>
      <legend>Noise reduction</legend>
      {NOISE_REDUCTION_OPTIONS.map((option) => (
        <label key={option.value} className="noise-option">
          <input
            type="radio"
            name="noise-profile"
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          <div>
            <span className="noise-label">{option.label}</span>
            <span className="noise-description">{option.description}</span>
          </div>
        </label>
      ))}
    </fieldset>
  );
}

type TranscriptListProps = {
  transcripts: ReturnType<typeof useRealtimeSession>["transcripts"];
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
  connectionLog: ReturnType<typeof useRealtimeSession>["connectionLog"];
  serverEvents: ReturnType<typeof useRealtimeSession>["serverEvents"];
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

const statusDescriptions: Record<string, string> = {
  idle: "Idle — ready to connect",
  "requesting-permissions": "Awaiting microphone permission",
  connecting: "Connecting to OpenAI Realtime",
  connected: "Streaming audio",
  ended: "Session ended",
  error: "Connection error",
};

export default function RealtimeSessionShell() {
  const {
    status,
    statusMessage,
    isConnected,
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
  } = useRealtimeSession();

  const {
    phase,
    modeIntent,
    projects: projectEntries,
    isLoadingProjects,
    activeProject,
    blueprint,
    fieldStates,
    activeFieldKey,
    beginConversation,
    chooseExistingMode,
    startNewProject,
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

  const statusLabel = useMemo(() => {
    const base = statusDescriptions[status] ?? status;
    if (status === "error" && error) {
      return `${base}: ${error}`;
    }
    if (statusMessage) {
      return `${base}${statusMessage ? ` — ${statusMessage}` : ""}`;
    }
    return base;
  }, [error, status, statusMessage]);

  const phaseCopy = phaseLabels[phase] ?? {
    label: phase,
    helper: "",
  };
  const phaseLabel = phaseCopy.label;
  const phaseHelper = useMemo(() => {
    if (phase === "mode-selection") {
      if (modeIntent === "new") {
        return "Creating a fresh project blueprint.";
      }
      if (modeIntent === "existing") {
        return "Listing recent projects for selection.";
      }
      return (
        phaseCopy.helper ||
        "Waiting to hear whether this is a new or existing project."
      );
    }
    if (phase === "awaiting-existing") {
      return "Say a project name or tap a card to continue.";
    }
    return phaseCopy.helper;
  }, [phase, modeIntent, phaseCopy.helper]);

  const audioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      registerAudioElement(element);
    },
    [registerAudioElement],
  );

  const handleBeginConversation = useCallback(() => {
    void beginConversation();
  }, [beginConversation]);

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

  const selectedProjectId = activeProject?._id ?? sessionRecord?.projectId ?? null;
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
      <header className="shell-header">
        <div className="title-block">
          <h1>Project Intake &amp; Realtime Workspace</h1>
          <p>
            Choose a project, capture its blueprint, and collaborate with the realtime assistant.
          </p>
        </div>
        <div className="status-block">
          <span className={`status-indicator status-${status}`}></span>
          <span className="status-label">{statusLabel}</span>
        </div>
        <div className="phase-block">
          <span className={`phase-badge phase-${phase}`}>{phaseLabel}</span>
          <span className="phase-helper">{phaseHelper}</span>
        </div>
        <div className="header-actions">
          {isConnected ? (
            <button className="danger" onClick={handleStop}>
              End session
            </button>
          ) : (
            <button
              className="primary"
              onClick={handleBeginConversation}
              disabled={
                status === "connecting" || status === "requesting-permissions"
              }
            >
              Start conversation
            </button>
          )}
          <button
            onClick={() => {
              void refreshDevices();
            }}
            disabled={status === "requesting-permissions"}
          >
            Refresh devices
          </button>
        </div>
      </header>

      {error && status !== "error" ? (
        <div className="alert">{error}</div>
      ) : null}

      <div className="project-grid">
        <aside className="panel project-panel">
          <div className="panel-header">
            <h2>Projects</h2>
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

          <div className="project-actions">
            <button
              className="primary"
              onClick={() => {
                void startNewProject();
              }}
              disabled={
                status === "connecting" || status === "requesting-permissions"
              }
            >
              New project blueprint
            </button>
            <button
              onClick={() => {
                void chooseExistingMode();
              }}
              disabled={!isConnected}
            >
              Ask assistant about existing projects
            </button>
          </div>

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

          <div className="audio-controls">
            <h3>Audio controls</h3>
            <DeviceSelect
              label="Microphone"
              devices={inputDevices}
              value={selectedInputDeviceId}
              onChange={selectInputDevice}
              disabled={status === "requesting-permissions"}
            />
            <DeviceSelect
              label="Playback"
              devices={outputDevices}
              value={selectedOutputDeviceId}
              onChange={selectOutputDevice}
              disabled={status === "requesting-permissions"}
            />
            <NoiseReductionToggle
              value={noiseReduction}
              onChange={setNoiseReduction}
              disabled={
                status === "requesting-permissions" || status === "connecting"
              }
            />
            <div className="meters">
              <LevelMeter
                label="Microphone"
                level={microphoneLevel}
                active={voiceActivity.user}
                tone="primary"
              />
              <LevelMeter
                label="Assistant audio"
                level={assistantLevel}
                active={voiceActivity.assistant}
                tone="secondary"
              />
            </div>
          </div>
        </aside>

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
              Commit blueprint &amp; continue
            </button>
          ) : null}
        </section>
      </div>

      <audio ref={audioRef} className="hidden-audio" />
    </div>
  );
}
