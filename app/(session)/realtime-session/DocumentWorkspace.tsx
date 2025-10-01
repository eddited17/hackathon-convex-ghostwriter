"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { SessionInstructionMode } from "@/lib/realtimeInstructions";
import type { BlueprintFieldState } from "./useProjectIntakeFlow";

const SECTION_STATUS_LABELS: Record<string, string> = {
  drafting: "Drafting",
  needs_detail: "Needs detail",
  complete: "Complete",
};

const NOTE_LABELS: Record<string, string> = {
  fact: "Fact",
  story: "Story",
  style: "Style",
  voice: "Voice",
  todo: "TODO",
  summary: "Summary",
};

type RealtimeDraftStatus = {
  status: "idle" | "queued" | "running" | "complete" | "error";
  summary: string | null;
  error: string | null;
  updatedAt: number | null;
};

const MODE_LABELS: Record<SessionInstructionMode, string> = {
  intake: "Intake setup",
  blueprint: "Blueprint refinement",
  ghostwriting: "Draft orchestration",
};

const MODE_CLASSES: Record<SessionInstructionMode, string> = {
  intake: "mode-intake",
  blueprint: "mode-blueprint",
  ghostwriting: "mode-ghostwriting",
};

const formatDateTime = (timestamp: number | undefined) => {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
};

function SimpleMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const lines = content.split(/\r?\n/);
    const result: Array<{ type: string; value: string | string[] }> = [];

    let buffer: string[] = [];
    let listBuffer: string[] = [];

    const flushParagraph = () => {
      if (buffer.length === 0) return;
      result.push({ type: "paragraph", value: buffer.join(" ") });
      buffer = [];
    };

    const flushList = () => {
      if (listBuffer.length === 0) return;
      result.push({ type: "list", value: [...listBuffer] });
      listBuffer = [];
    };

    for (const line of lines) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        flushParagraph();
        flushList();
        continue;
      }
      if (trimmed.startsWith("#")) {
        flushParagraph();
        flushList();
        const depth = trimmed.match(/^#+/)?.[0].length ?? 1;
        const text = trimmed.slice(depth).trim();
        result.push({ type: `heading-${depth}`, value: text });
        continue;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        flushParagraph();
        const item = trimmed.replace(/^[-*]\s+/, "").trim();
        listBuffer.push(item);
        continue;
      }
      buffer.push(trimmed);
    }

    flushParagraph();
    flushList();

    return result;
  }, [content]);

  if (!content.trim()) {
    return (
      <p className="markdown-placeholder">
        Draft updates will appear here once the assistant starts writing.
      </p>
    );
  }

  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        if (block.type.startsWith("heading")) {
          const depth = Number.parseInt(block.type.split("-")[1] ?? "1", 10);
          const HeadingTag = (
            depth === 1 ? "h2" : depth === 2 ? "h3" : "h4"
          ) as keyof JSX.IntrinsicElements;
          return (
            <HeadingTag key={`heading-${index}`} className="markdown-heading">
              {block.value as string}
            </HeadingTag>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={`list-${index}`} className="markdown-list">
              {(block.value as string[]).map((item, itemIndex) => (
                <li key={`list-${index}-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={`paragraph-${index}`} className="markdown-paragraph">
            {block.value as string}
          </p>
        );
      })}
    </div>
  );
}

type DocumentWorkspaceProps = {
  projectId: Id<"projects"> | null;
  blueprint: Doc<"projectBlueprints"> | null;
  fieldStates: BlueprintFieldState[];
  onSnapshot?: (snapshot: {
    wordCount: number;
    todoCount: number;
    sections: Array<{
      title: string;
      status: "drafting" | "needs_detail" | "complete";
    }>;
  }) => void;
  realtimeStatus?: RealtimeDraftStatus;
  mode: SessionInstructionMode;
};

export default function DocumentWorkspace({
  projectId,
  blueprint,
  fieldStates,
  onSnapshot,
  realtimeStatus,
  mode,
}: DocumentWorkspaceProps) {
  const workspace = useQuery(
    api.documents.getWorkspace,
    projectId ? { projectId } : "skip",
  );
  const draftQueueState = useQuery(
    api.documents.getDraftQueueState,
    projectId ? { projectId } : "skip",
  );
  const notes = useQuery(
    api.notes.listForProject,
    projectId
      ? {
          projectId,
          limit: 12,
        }
      : "skip",
  );
  const todos = useQuery(
    api.todos.listForProject,
    projectId ? { projectId } : "skip",
  );

  const updateTodoStatus = useMutation(api.todos.updateStatus);
  const resetDraftMutation = useMutation(api.documents.resetDraft);

  const openTodoCount = useMemo(() => {
    if (!todos) return 0;
    return todos.filter((todo: Doc<"todos">) => todo.status !== "resolved").length;
  }, [todos]);

  const [resetting, setResetting] = useState(false);

  const activeJob = draftQueueState?.activeJob ?? null;
  const latestJob = draftQueueState?.jobs?.[0] ?? null;
  const jobStatus = activeJob?.status ?? latestJob?.status ?? null;
  const liveStatus = useMemo<RealtimeDraftStatus | null>(() => {
    if (!realtimeStatus || realtimeStatus.status === "idle") return null;
    if (
      typeof realtimeStatus.updatedAt === "number" &&
      Date.now() - realtimeStatus.updatedAt > 60_000
    ) {
      return null;
    }
    return realtimeStatus;
  }, [realtimeStatus]);
  const effectiveStatus = (liveStatus?.status ?? jobStatus ?? null) as
    | RealtimeDraftStatus["status"]
    | null;
  const jobStatusLabel =
    effectiveStatus === "queued"
      ? "Draft queued"
      : effectiveStatus === "running"
        ? "Drafting…"
        : effectiveStatus === "complete"
          ? "Draft ready"
          : effectiveStatus === "error"
            ? "Draft error"
            : null;
  const jobStatusClass =
    effectiveStatus === "complete"
      ? "status-complete"
      : effectiveStatus === "error"
        ? "status-needs_detail"
        : "status-drafting";
  const jobErrorMessage =
    liveStatus?.error ??
    draftQueueState?.jobs?.find(
      (job: Doc<"draftJobs">) => job.status === "error" && job.error?.trim(),
    )?.error ?? null;
  const realtimeSummary = liveStatus?.summary ?? null;
  const transcriptStatusLabel = draftQueueState?.latestTranscript
    ? draftQueueState.latestTranscript.finalizedAt
      ? "Transcript saved"
      : "Transcript recording"
    : null;

  const handleResetDraft = async () => {
    if (!projectId || resetting) return;
    const confirmed = window.confirm(
      "Reset the draft? This will clear all sections, summary, and Markdown for this project.",
    );
    if (!confirmed) return;
    setResetting(true);
    try {
      await resetDraftMutation({ projectId });
    } catch (error) {
      console.error("Failed to reset draft", error);
    } finally {
      setResetting(false);
    }
  };

  useEffect(() => {
    if (!workspace || !onSnapshot) return;
    const sections = workspace.progress.sectionStatuses.map((section: {
      heading: string;
      status: "drafting" | "needs_detail" | "complete";
    }) => ({
      title: section.heading,
      status: section.status,
    }));
    onSnapshot({
      wordCount: workspace.progress.wordCount,
      todoCount: openTodoCount,
      sections,
    });
  }, [workspace, openTodoCount, onSnapshot]);

  const handleTodoUpdate = async (
    todoId: Id<"todos">,
    status: "open" | "in_review" | "resolved",
  ) => {
    await updateTodoStatus({
      todoId,
      status,
    });
  };

  const blueprintHighlights = useMemo(() => {
    return fieldStates
      .filter((field) => field.key !== "voiceGuardrails")
      .map((field) => ({
        key: field.key,
        label: field.label,
        value: field.value,
        isComplete: field.isComplete,
      }));
  }, [fieldStates]);

  const completedHighlights = useMemo(() => {
    return blueprintHighlights.filter((highlight) => highlight.isComplete).length;
  }, [blueprintHighlights]);

  const voiceGuardrails = blueprint?.voiceGuardrails ?? {
    tone: "",
    structure: "",
    content: "",
  };

  const [detailsOpen, setDetailsOpen] = useState(false);

  const documentContent = workspace?.document?.latestDraftMarkdown ?? "";
  const draftSummary = workspace?.document?.summary?.trim() ?? "";
  const sections = workspace?.sections ?? [];
  const noteCount = notes?.length ?? 0;
  const modeChipLabel = MODE_LABELS[mode];
  const modeChipClass = MODE_CLASSES[mode];
  const blueprintSummary =
    blueprintHighlights.length > 0
      ? `${completedHighlights}/${blueprintHighlights.length} blueprint fields`
      : "Blueprint pending";
  const summaryItems = [
    `${sections.length} ${sections.length === 1 ? "section" : "sections"}`,
    `${openTodoCount} open ${openTodoCount === 1 ? "todo" : "todos"}`,
    voiceGuardrails.tone || voiceGuardrails.structure || voiceGuardrails.content
      ? "Voice cues set"
      : "Voice cues empty",
    blueprintSummary,
  ];

  return (
    <div className="document-workspace">
      <div className="document-grid">
        <section className="panel document-panel">
          <header className="panel-header">
            <div>
              <h2>Live draft</h2>
              <p className="panel-description">
                Updates arrive as the assistant applies whole-document edits.
              </p>
              {realtimeSummary ? (
                <p className="panel-description">
                  Latest update: {realtimeSummary}
                </p>
              ) : null}
              {jobErrorMessage ? (
                <p className="panel-description">
                  Background drafting error: {jobErrorMessage}
                </p>
              ) : null}
            </div>
            <div className="draft-header-tools">
              <div className="draft-metrics">
                <span className={`metric-chip ${modeChipClass}`}>
                  {modeChipLabel}
                </span>
                <span className="metric-chip">
                  {workspace ? `${workspace.progress.wordCount} words` : "—"}
                </span>
                {jobStatusLabel ? (
                  <span
                    className={`metric-chip ${jobStatusClass}`}
                    title={jobErrorMessage ?? undefined}
                  >
                    {jobStatusLabel}
                  </span>
                ) : null}
                <span
                  className={`metric-chip status-${workspace?.document?.status ?? "drafting"}`}
                >
                  {workspace?.document?.status ?? "drafting"}
                </span>
                {transcriptStatusLabel ? (
                  <span className="metric-chip subtle">
                    {transcriptStatusLabel}
                  </span>
                ) : null}
                {workspace?.document?.updatedAt ? (
                  <span className="metric-chip subtle">
                    Updated {formatDateTime(workspace.document.updatedAt)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="text-button danger"
                onClick={handleResetDraft}
                disabled={!projectId || resetting}
              >
                {resetting ? "Resetting…" : "Reset draft"}
              </button>
            </div>
          </header>
          {draftSummary ? (
            <section className="draft-summary">
              <h3>Summary</h3>
              <p>{draftSummary}</p>
            </section>
          ) : null}
          <SimpleMarkdown content={documentContent} />
        </section>
        <aside className="document-aside">
          <section className="panel todo-panel">
            <header className="panel-header">
              <div>
                <h2>Open TODOs</h2>
                <p className="panel-description">
                  Capture outstanding follow-ups before sharing the draft.
                </p>
              </div>
              <span className="panel-subtitle">
                {openTodoCount} open
              </span>
            </header>
            {todos && todos.length > 0 ? (
              <ul className="todo-list">
                {todos.map((todo: Doc<"todos">) => (
                  <li key={todo._id} className={`todo-item status-${todo.status}`}>
                    <div>
                      <p>{todo.label}</p>
                      <span className="todo-status">
                        {todo.status === "in_review" ? "Needs detail" : todo.status}
                      </span>
                    </div>
                    <div className="todo-actions">
                      {todo.status === "resolved" ? (
                        <button
                          type="button"
                          onClick={() => handleTodoUpdate(todo._id, "open")}
                        >
                          Reopen
                        </button>
                      ) : (
                        <>
                          {todo.status !== "in_review" ? (
                            <button
                              type="button"
                              onClick={() => handleTodoUpdate(todo._id, "in_review")}
                            >
                              Needs detail
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => handleTodoUpdate(todo._id, "resolved")}
                          >
                            Resolve
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">
                No outstanding TODOs. Capture follow-ups as they appear.
              </p>
            )}
          </section>

          <section
            className={`panel detail-panel ${detailsOpen ? "open" : "collapsed"}`}
          >
            <header className="detail-header">
              <div>
                <h2>Session details</h2>
                <p className="panel-description">
                  Outline, voice guardrails, blueprint status, and notes in one place.
                </p>
              </div>
              <button
                type="button"
                className="text-button"
                onClick={() => setDetailsOpen((previous) => !previous)}
              >
                {detailsOpen ? "Hide details" : "Show details"}
              </button>
            </header>
            <div className="detail-summary">
              {summaryItems.map((item) => (
                <span key={item}>{item}</span>
              ))}
              <span>
                {noteCount} {noteCount === 1 ? "note" : "notes"}
              </span>
            </div>
            <div className="detail-body">
              <section>
                <h3>Section outline</h3>
                {sections.length === 0 ? (
                  <p className="empty-state">
                    Sections will populate after the first drafting pass.
                  </p>
                ) : (
                  <ol className="outline-list">
                    {sections.map((section: Doc<"documentSections">) => (
                      <li key={section._id}>
                        <div>
                          <span className="outline-title">{section.heading}</span>
                          <span className={`outline-status status-${section.status}`}>
                            {SECTION_STATUS_LABELS[section.status] ?? section.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section>
                <h3>Voice guardrails</h3>
                <ul className="voice-list">
                  <li>
                    <span className="voice-label">Tone</span>
                    <p>{voiceGuardrails.tone || "—"}</p>
                  </li>
                  <li>
                    <span className="voice-label">Structure</span>
                    <p>{voiceGuardrails.structure || "—"}</p>
                  </li>
                  <li>
                    <span className="voice-label">Content boundaries</span>
                    <p>{voiceGuardrails.content || "—"}</p>
                  </li>
                </ul>
              </section>
              <section>
                <h3>Blueprint highlights</h3>
                <ul className="blueprint-highlights">
                  {blueprintHighlights.map((highlight) => (
                    <li key={highlight.key}>
                      <span className="highlight-label">{highlight.label}</span>
                      <p className={highlight.isComplete ? "" : "muted"}>
                        {highlight.value || "Pending"}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>Recent notes</h3>
                {notes && notes.length > 0 ? (
                  <ul className="note-list">
                    {notes.map((note: Doc<"notes">) => (
                      <li key={note._id}>
                        <div>
                          <span className={`note-type type-${note.noteType}`}>
                            {NOTE_LABELS[note.noteType] ?? note.noteType}
                          </span>
                          {note.resolved ? (
                            <span className="note-resolved">Resolved</span>
                          ) : null}
                        </div>
                        <p>{note.content}</p>
                        {note.sourceMessageIds?.length ? (
                          <span className="note-source">
                            Anchored to {note.sourceMessageIds.length} transcript message(s)
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">
                    Notes you capture during the session will land here.
                  </p>
                )}
              </section>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
