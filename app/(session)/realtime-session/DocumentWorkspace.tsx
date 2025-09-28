"use client";

import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
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
};

export default function DocumentWorkspace({
  projectId,
  blueprint,
  fieldStates,
  onSnapshot,
}: DocumentWorkspaceProps) {
  const workspace = useQuery(
    api.documents.getWorkspace,
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

  const openTodoCount = useMemo(() => {
    if (!todos) return 0;
    return todos.filter((todo) => todo.status !== "resolved").length;
  }, [todos]);

  useEffect(() => {
    if (!workspace || !onSnapshot) return;
    const sections = workspace.progress.sectionStatuses.map((section) => ({
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

  const voiceGuardrails = blueprint?.voiceGuardrails ?? {
    tone: "",
    structure: "",
    content: "",
  };

  const documentContent = workspace?.document?.latestDraftMarkdown ?? "";
  const sections = workspace?.sections ?? [];

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
            </div>
            <div className="draft-metrics">
              <span className="metric-chip">
                {workspace ? `${workspace.progress.wordCount} words` : "—"}
              </span>
              <span
                className={`metric-chip status-${workspace?.document?.status ?? "drafting"}`}
              >
                {workspace?.document?.status ?? "drafting"}
              </span>
              {workspace?.document?.updatedAt ? (
                <span className="metric-chip subtle">
                  Updated {formatDateTime(workspace.document.updatedAt)}
                </span>
              ) : null}
            </div>
          </header>
          <SimpleMarkdown content={documentContent} />
        </section>
        <aside className="panel document-sidebar">
          <section>
            <h3>Section outline</h3>
            {sections.length === 0 ? (
              <p className="empty-state">
                Sections will populate after the first drafting pass.
              </p>
            ) : (
              <ol className="outline-list">
                {sections.map((section) => (
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
            <h3>Open TODOs</h3>
            {todos && todos.length > 0 ? (
              <ul className="todo-list">
                {todos.map((todo) => (
                  <li key={todo._id} className={`todo-item status-${todo.status}`}>
                    <div>
                      <p>{todo.label}</p>
                      <span className="todo-status">
                        {todo.status === "in_review" ? "Needs detail" : todo.status}
                      </span>
                    </div>
                    <div className="todo-actions">
                      {todo.status !== "resolved" ? (
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
                            Mark resolved
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleTodoUpdate(todo._id, "open")}
                        >
                          Reopen
                        </button>
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
          <section>
            <h3>Recent notes</h3>
            {notes && notes.length > 0 ? (
              <ul className="note-list">
                {notes.map((note) => (
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
                        Anchored to {note.sourceMessageIds.length} transcript
                        message(s)
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
        </aside>
      </div>
    </div>
  );
}
