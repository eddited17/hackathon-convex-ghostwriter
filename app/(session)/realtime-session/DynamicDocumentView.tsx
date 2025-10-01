"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { SessionInstructionMode } from "@/lib/realtimeInstructions";

type MarkdownBlock = {
  type: "h1" | "h2" | "h3" | "paragraph" | "list" | "code";
  content?: string;
  items?: string[];
  hash: string;
  id: string;
  state: "positioning" | "materializing" | "visible" | "removing";
};

type RealtimeDraftStatus = {
  status: "idle" | "queued" | "running" | "complete" | "error";
  summary: string | null;
  error: string | null;
  updatedAt: number | null;
};

const MODE_LABELS: Record<SessionInstructionMode, string> = {
  intake: "Intake",
  blueprint: "Blueprint",
  ghostwriting: "Drafting",
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

// Create content-based hash for block matching
const getBlockHash = (block: Omit<MarkdownBlock, "hash" | "id" | "state">) => {
  return JSON.stringify({ type: block.type, content: block.content, items: block.items });
};

// Parse markdown into structured blocks
const parseMarkdown = (md: string): MarkdownBlock[] => {
  const lines = md.split("\n");
  const blocks: Array<Omit<MarkdownBlock, "id" | "state">> = [];
  let codeBlockContent: string[] = [];
  let inCodeBlock = false;
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const block = { type: "list" as const, items: listItems, hash: "" };
    block.hash = getBlockHash(block);
    blocks.push(block);
    listItems = [];
  };

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        const block = { type: "code" as const, content: codeBlockContent.join("\n"), hash: "" };
        block.hash = getBlockHash(block);
        blocks.push(block);
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      return;
    }

    const h1Match = line.match(/^# (.+)$/);
    const h2Match = line.match(/^## (.+)$/);
    const h3Match = line.match(/^### (.+)$/);

    if (h1Match) {
      flushList();
      const block = { type: "h1" as const, content: h1Match[1], hash: "" };
      block.hash = getBlockHash(block);
      blocks.push(block);
    } else if (h2Match) {
      flushList();
      const block = { type: "h2" as const, content: h2Match[1], hash: "" };
      block.hash = getBlockHash(block);
      blocks.push(block);
    } else if (h3Match) {
      flushList();
      const block = { type: "h3" as const, content: h3Match[1], hash: "" };
      block.hash = getBlockHash(block);
      blocks.push(block);
    } else if (line.trim().match(/^[-*] (.+)$/)) {
      const match = line.trim().match(/^[-*] (.+)$/);
      if (match) listItems.push(match[1]);
    } else if (line.trim()) {
      flushList();
      const block = { type: "paragraph" as const, content: line.trim(), hash: "" };
      block.hash = getBlockHash(block);
      blocks.push(block);
    } else if (line === "") {
      flushList();
    }
  });

  flushList();

  return blocks.map(block => ({ ...block, id: `block-${block.hash}`, state: "visible" as const }));
};

// Render inline markdown formatting
const renderInlineMarkdown = (text: string) => {
  let result = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/`(.+?)`/g, '<code>$1</code>');
  return <span dangerouslySetInnerHTML={{ __html: result }} />;
};

type DynamicDocumentViewProps = {
  projectId: Id<"projects"> | null;
  realtimeStatus?: RealtimeDraftStatus;
  mode: SessionInstructionMode;
  autoScroll?: boolean;
};

export default function DynamicDocumentView({
  projectId,
  realtimeStatus,
  mode,
  autoScroll = true,
}: DynamicDocumentViewProps) {
  const workspace = useQuery(
    api.documents.getWorkspace,
    projectId ? { projectId } : "skip",
  );
  const draftQueueState = useQuery(
    api.documents.getDraftQueueState,
    projectId ? { projectId } : "skip",
  );

  const resetDraftMutation = useMutation(api.documents.resetDraft);

  const [displayedBlocks, setDisplayedBlocks] = useState<MarkdownBlock[]>([]);
  const [resetting, setResetting] = useState(false);
  const newBlockRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const processingRef = useRef(false);
  const targetMarkdownRef = useRef("");

  const documentContent = workspace?.document?.latestDraftMarkdown ?? "";

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
      ? "Queued"
      : effectiveStatus === "running"
        ? "Drafting…"
        : effectiveStatus === "complete"
          ? "Ready"
          : effectiveStatus === "error"
            ? "Error"
            : null;

  const jobErrorMessage = liveStatus?.error ?? draftQueueState?.jobs?.find(
    (job: Doc<"draftJobs">) => job.status === "error" && job.error?.trim(),
  )?.error ?? null;

  // Transform document sequentially
  const transformDocument = async (targetBlocks: MarkdownBlock[]) => {
    if (processingRef.current) return;
    processingRef.current = true;

    let currentBlocks = [...displayedBlocks];
    const currentHashSet = new Set(currentBlocks.map(b => b.hash));
    const targetHashSet = new Set(targetBlocks.map(b => b.hash));

    // Step 1: Remove blocks that are no longer in target
    for (let i = currentBlocks.length - 1; i >= 0; i--) {
      const block = currentBlocks[i];
      if (!targetHashSet.has(block.hash)) {
        currentBlocks = currentBlocks.map((b, idx) =>
          idx === i ? { ...b, state: "removing" as const } : b
        );
        setDisplayedBlocks([...currentBlocks]);

        await new Promise(resolve => setTimeout(resolve, 400));

        currentBlocks = currentBlocks.filter((_, idx) => idx !== i);
        setDisplayedBlocks([...currentBlocks]);

        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Step 2: Insert new blocks at correct positions
    for (let targetIdx = 0; targetIdx < targetBlocks.length; targetIdx++) {
      const targetBlock = targetBlocks[targetIdx];

      if (!currentHashSet.has(targetBlock.hash)) {
        const newBlock = { ...targetBlock, state: "positioning" as const };

        currentBlocks.splice(targetIdx, 0, newBlock);
        setDisplayedBlocks([...currentBlocks]);

        await new Promise(resolve => setTimeout(resolve, 25));

        // Auto-scroll to new block if enabled
        if (autoScroll && newBlockRefs.current[newBlock.id]) {
          const element = newBlockRefs.current[newBlock.id];
          if (element) {
            const rect = element.getBoundingClientRect();
            const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;

            if (!isInView) {
              element.scrollIntoView({
                behavior: "smooth",
                block: "center"
              });
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }

        currentBlocks = currentBlocks.map((b) =>
          b.id === newBlock.id ? { ...b, state: "materializing" as const } : b
        );
        setDisplayedBlocks([...currentBlocks]);

        await new Promise(resolve => setTimeout(resolve, 600));

        currentBlocks = currentBlocks.map((b) =>
          b.id === newBlock.id ? { ...b, state: "visible" as const } : b
        );
        setDisplayedBlocks([...currentBlocks]);

        currentHashSet.add(targetBlock.hash);

        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    processingRef.current = false;
  };

  useEffect(() => {
    if (documentContent !== targetMarkdownRef.current) {
      targetMarkdownRef.current = documentContent;
      const targetBlocks = parseMarkdown(documentContent);

      if (displayedBlocks.length === 0) {
        setDisplayedBlocks(targetBlocks);
      } else {
        transformDocument(targetBlocks);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentContent, autoScroll]);

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

  return (
    <div className="dynamic-document-view">
      {/* Thin status bar */}
      <div className="document-status-bar">
        <div className="status-chips">
          <span className="status-chip mode">
            {MODE_LABELS[mode]}
          </span>
          <span className="status-chip">
            {workspace ? `${workspace.progress.wordCount} words` : "—"}
          </span>
          {jobStatusLabel && (
            <span
              className={`status-chip ${effectiveStatus}`}
              title={jobErrorMessage ?? undefined}
            >
              {jobStatusLabel}
            </span>
          )}
          {workspace?.document?.updatedAt && (
            <span className="status-chip subtle">
              {formatDateTime(workspace.document.updatedAt)}
            </span>
          )}
        </div>
        <button
          type="button"
          className="reset-button"
          onClick={handleResetDraft}
          disabled={!projectId || resetting}
        >
          {resetting ? "Resetting…" : "Reset"}
        </button>
      </div>

      {/* Centered document viewport */}
      <div className="document-viewport">
        <div className="document-content">
          {displayedBlocks.length === 0 ? (
            <p className="empty-state">
              Draft updates will appear here once the assistant starts writing.
            </p>
          ) : (
            displayedBlocks.map((block) => (
              <div
                key={block.id}
                ref={(el) => {
                  newBlockRefs.current[block.id] = el;
                }}
                className={`block block-${block.state}`}
              >
                {block.type === "h1" && (
                  <h1>{block.content}</h1>
                )}

                {block.type === "h2" && (
                  <h2>{block.content}</h2>
                )}

                {block.type === "h3" && (
                  <h3>{block.content}</h3>
                )}

                {block.type === "paragraph" && (
                  <p>{renderInlineMarkdown(block.content ?? "")}</p>
                )}

                {block.type === "list" && (
                  <ul>
                    {block.items?.map((item, i) => (
                      <li key={i}>{renderInlineMarkdown(item)}</li>
                    ))}
                  </ul>
                )}

                {block.type === "code" && (
                  <pre>
                    <code>{block.content}</code>
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <style jsx>{`
        .dynamic-document-view {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
        }

        .document-status-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 1.5rem;
          background: var(--surface-1);
          border-bottom: 1px solid var(--border-subtle);
          min-height: 2.5rem;
          flex-shrink: 0;
        }

        .status-chips {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .status-chip {
          padding: 0.25rem 0.75rem;
          border-radius: 0.375rem;
          font-size: 0.75rem;
          font-weight: 500;
          background: var(--surface-2);
          color: var(--text-2);
        }

        .status-chip.mode {
          background: var(--accent-surface);
          color: var(--accent-text);
        }

        .status-chip.queued,
        .status-chip.running {
          background: var(--warning-surface);
          color: var(--warning-text);
        }

        .status-chip.complete {
          background: var(--success-surface);
          color: var(--success-text);
        }

        .status-chip.error {
          background: var(--error-surface);
          color: var(--error-text);
        }

        .status-chip.subtle {
          opacity: 0.7;
        }

        .reset-button {
          padding: 0.25rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 500;
          border: none;
          border-radius: 0.375rem;
          background: transparent;
          color: var(--error-text);
          cursor: pointer;
          transition: background 0.2s;
        }

        .reset-button:hover:not(:disabled) {
          background: var(--error-surface);
        }

        .reset-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .document-viewport {
          flex: 1;
          overflow-y: auto;
          padding: 3rem 2rem;
        }

        .document-content {
          max-width: 48rem;
          margin: 0 auto;
        }

        .empty-state {
          text-align: center;
          color: var(--text-3);
          font-size: 0.875rem;
          padding: 4rem 2rem;
        }

        .block {
          margin-bottom: 1.5rem;
        }

        .block h1 {
          font-size: 2.25rem;
          font-weight: 700;
          line-height: 1.2;
          margin: 0 0 1.5rem 0;
        }

        .block h2 {
          font-size: 1.75rem;
          font-weight: 600;
          line-height: 1.3;
          margin: 2rem 0 1rem 0;
        }

        .block h3 {
          font-size: 1.375rem;
          font-weight: 600;
          line-height: 1.4;
          margin: 1.5rem 0 0.75rem 0;
        }

        .block p {
          font-size: 1rem;
          line-height: 1.7;
          margin: 0;
        }

        .block ul {
          list-style: disc;
          padding-left: 1.5rem;
          margin: 0;
        }

        .block li {
          font-size: 1rem;
          line-height: 1.7;
          margin: 0.25rem 0;
        }

        .block pre {
          background: var(--surface-2);
          border-radius: 0.5rem;
          padding: 1rem;
          overflow-x: auto;
          margin: 0;
        }

        .block code {
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .block-positioning {
          opacity: 0;
        }

        .block-materializing {
          animation: materialize 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        .block-visible {
          opacity: 1;
        }

        .block-removing {
          animation: fadeOut 0.4s cubic-bezier(0.4, 0, 1, 1) forwards;
        }

        @keyframes materialize {
          0% {
            opacity: 0;
            transform: translateY(40px) scale(0.92);
            filter: blur(12px);
          }
          60% {
            opacity: 0.6;
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes fadeOut {
          0% {
            opacity: 1;
            transform: translateX(0) scale(1);
            filter: blur(0);
          }
          100% {
            opacity: 0;
            transform: translateX(-30px) scale(0.95);
            filter: blur(8px);
          }
        }
      `}</style>
    </div>
  );
}
