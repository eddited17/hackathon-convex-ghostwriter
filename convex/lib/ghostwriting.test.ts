import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../_generated/dataModel";
import {
  buildDraftingPrompt,
  type DraftingPromptTranscriptItem,
} from "./ghostwriting";

const projectId = "project_1" as Id<"projects">;
const sessionId = "session_1" as Id<"sessions">;
const documentId = "document_1" as Id<"documents">;

const project: Doc<"projects"> = {
  _id: projectId,
  ownerId: "user_1" as Id<"users">,
  title: "Remote Leadership Playbook",
  contentType: "article",
  goal: "Position the founder as a trusted leader for distributed teams",
  status: "active",
  _creationTime: 1735689600000,
  createdAt: 1735689600000,
  updatedAt: 1735689600000,
};

const blueprint: Doc<"projectBlueprints"> = {
  _id: "blueprint_1" as Id<"projectBlueprints">,
  projectId,
  desiredOutcome: "Publish a 5-minute read that convinces operators to try async-first routines",
  targetAudience: "Series B startup leaders",
  materialsInventory: "Interview transcript, workshop notes",
  communicationPreferences: "Short daily updates on Slack",
  voiceGuardrails: {
    tone: "Warm but analytical",
    structure: "Start with a narrative cold open, land on actionable playbook",
    content: "Avoid generic productivity platitudes",
  },
  status: "committed",
  intakeSessionId: sessionId,
  intakeTranscriptMessageId: undefined,
  _creationTime: 1735689600000,
  createdAt: 1735689600000,
  updatedAt: 1735689600000,
};

const document: Doc<"documents"> = {
  _id: documentId,
  projectId,
  latestDraftMarkdown: "# Remote Leadership Playbook\n\nIntro paragraph placeholder.",
  summary: "Framing the shift to async and outlining the four habits to master.",
  status: "drafting",
  lockedSections: [],
  _creationTime: 1735693200000,
  updatedAt: 1735693200000,
};

const sections: Doc<"documentSections">[] = [
  {
    _id: "section_1" as Id<"documentSections">,
    documentId,
    heading: "Why async needs a new playbook",
    content: "Leaders are juggling time zones; async is the unlock.",
    order: 0,
    status: "needs_detail",
    version: 2,
    locked: false,
    _creationTime: 1735693200000,
    updatedAt: 1735693200000,
  },
  {
    _id: "section_2" as Id<"documentSections">,
    documentId,
    heading: "Four habits for distributed teams",
    content: "Outline of rituals, tooling, and culture guardrails.",
    order: 1,
    status: "drafting",
    version: 1,
    locked: false,
    _creationTime: 1735693200000,
    updatedAt: 1735693200000,
  },
];

const notes: Doc<"notes">[] = [
  {
    _id: "note_1" as Id<"notes">,
    projectId,
    sessionId,
    noteType: "fact",
    content: "Team reduced meetings from 18hrs/week to 6hrs/week after async shift.",
    sourceMessageIds: undefined,
    confidence: 0.9,
    resolved: false,
    _creationTime: 1735690000000,
    createdAt: 1735690000000,
  },
  {
    _id: "note_2" as Id<"notes">,
    projectId,
    sessionId,
    noteType: "story",
    content: "Founder told story about 3am incident that led to async overhaul.",
    sourceMessageIds: undefined,
    confidence: 0.8,
    resolved: false,
    _creationTime: 1735690100000,
    createdAt: 1735690100000,
  },
];

const todos: Doc<"todos">[] = [
  {
    _id: "todo_1" as Id<"todos">,
    projectId,
    label: "Clarify metrics for habit #3",
    status: "open",
    createdAt: 1735690200000,
    resolvedAt: undefined,
    noteId: undefined,
    _creationTime: 1735690200000,
  },
];

const transcriptItems: DraftingPromptTranscriptItem[] = [
  {
    id: "assistant-1",
    role: "assistant",
    status: "completed",
    type: "message",
    previousItemId: undefined,
    createdAt: 1735690300000,
    messageId: "message_a" as Id<"messages">,
    messageKey: "assistant-1",
    text: "Can you walk me through the moment you realized sync standups no longer worked?",
  },
  {
    id: "user-2",
    role: "user",
    status: "completed",
    type: "message",
    previousItemId: "assistant-1",
    createdAt: 1735690315000,
    messageId: "message_b" as Id<"messages">,
    messageKey: "user-2",
    text: "At 3am I handled a production incident while our Berlin lead waited eight hours. That's when I knew async was mandatory.",
  },
];

const job: Doc<"draftJobs"> = {
  _id: "job_1" as Id<"draftJobs">,
  projectId,
  sessionId,
  status: "running",
  summary: "Incorporate the 3am outage anecdote and highlight the four habits",
  urgency: "asap",
  messagePointers: ["message_b"],
  transcriptAnchors: ["assistant-1"],
  promptContext: {
    outlineTarget: "Emphasize habit #2 with metric",
    narration: "Call out reduction in meeting load",
  },
  generatedSummary: undefined,
  modelUsage: undefined,
  createdAt: 1735690500000,
  startedAt: 1735690600000,
  completedAt: undefined,
  updatedAt: 1735690600000,
  error: undefined,
  durationMs: undefined,
  attemptCount: 1,
  _creationTime: 1735690500000,
};

const referencedMessages: Array<Doc<"messages">> = [
  {
    _id: "message_b" as Id<"messages">,
    sessionId,
    speaker: "user",
    transcript: "At 3am I handled a production incident while our Berlin lead waited eight hours.",
    timestamp: 1735690315000,
    tags: ["user-2"],
    _creationTime: 1735690315000,
  },
];

describe("buildDraftingPrompt", () => {
  it("constructs a high-signal prompt with project context", () => {
    const result = buildDraftingPrompt({
      project,
      blueprint,
      document,
      sections,
      notes,
      todos,
      transcriptItems,
      job,
      referencedMessages,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "system": "You are Stream's background ghostwriting model.\nYou receive interview transcripts, blueprint details, and outstanding TODOs.\nProduce a long-form Markdown draft update grounded in the provided context.\nRequirements:\n- Always return polished Markdown ready for publication.\n- Reflect the client's voice and respect blueprint guardrails.\n- Incorporate cited transcript excerpts and TODOs.\n- Summarize changes and maintain continuity with the existing draft.\n- Return structured section metadata describing heading, status, and order.\n- Provide a concise summary narrating the update for the realtime assistant.",
        "tokens": 221,
        "user": "## Project\nProject: Remote Leadership Playbook (article)\nGoal: Position the founder as a trusted leader for distributed teams\nStatus: active\n\n## Blueprint\nBlueprint status: committed.\nDesired outcome: Publish a 5-minute read that convinces operators to try async-first routines\nTarget audience: Series B startup leaders\nPublishing plan: Company blog, LinkedIn repost\nTimeline: Draft within 48 hours\nMaterials inventory: Interview transcript, workshop notes\nCommunication preferences: Short daily updates on Slack\nBudget range: $4-6k\nVoice tone: Warm but analytical\nVoice structure: Start with a narrative cold open, land on actionable playbook\nVoice content guardrails: Avoid generic productivity platitudes\n\n## Document\nPrevious summary: Framing the shift to async and outlining the four habits to master.\nExisting draft length: 9 words\nMost recent request: Incorporate the 3am outage anecdote and highlight the four habits\nUrgency: asap\n\n## Sections\n1. Why async needs a new playbook — Needs detail (v2)\n2. Four habits for distributed teams — Drafting (v1)\n\n## TODOs\n- (open) Clarify metrics for habit #3\n\n## Notes\n- [FACT] Team reduced meetings from 18hrs/week to 6hrs/week after async shift.\n- [STORY] Founder told story about 3am incident that led to async overhaul.\n\n## Transcript excerpts\n- (assistant) Can you walk me through the moment you realized sync standups no longer worked? [ref:assistant-1]\n- (user) At 3am I handled a production incident while our Berlin lead waited eight hours. That's when I knew async was mandatory. [ref:user-2]\n\n## Referenced messages\n- (Client) At 3am I handled a production incident while our Berlin lead waited eight hours.\n\n## Additional context\n{\n  \"outlineTarget\": \"Emphasize habit #2 with metric\",\n  \"narration\": \"Call out reduction in meeting load\"\n}",
      }
    `);
  });
});
