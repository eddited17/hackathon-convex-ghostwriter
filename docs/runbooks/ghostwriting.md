# Ghostwriting Draft Queue Runbook

## Overview
Ghostwriting V1 now drafts in the background via Convex jobs. Each job is stored in `draftJobs` with realtime status updates published as `TOOL_PROGRESS::<json>` messages to the active session. The realtime assistant stays responsive while markdown edits land asynchronously.

## Queue Monitoring
- **Convex dashboard**: query `documents.getDraftQueueState` with `projectId` to retrieve the active job, last 5 jobs, and transcript snapshot metadata.
- **Realtime status**: the client stores the latest queue event so badges update instantly; backend emits the same payload for auditors in the conversation log.
- **Telemetry**: every job write invokes `publishDraftJobMetrics`. If `DRAFT_METRICS_ENDPOINT` is configured, metrics flow to the external sink; otherwise we log to the Convex console.

## Manual Drains
Use the helper mutation when you need to force the queue:

```bash
npm run drain:drafts -- --limit 5
```

- The optional `--limit` flag controls how many jobs drain in one call (default 3, hard max 10).
- Jobs honour the built-in retry guard: failures are requeued up to 3 attempts before flipping to `error`.

## Error Handling
- `documents.reportDraftProgress` sends realtime notifications. When the status is `error` an alert is posted through `sendDraftingAlert` (configure `DRAFT_ALERT_WEBHOOK`).
- `callDraftingModel` retries each OpenAI call up to 3 times with exponential backoff. Missing `OPENAI_API_KEY` or non-200 responses immediately fail the job and surface an alert.
- Operators can inspect the job record (`draftJobs.status === "error"`) and requeue by calling `documents.triggerDraftProcessing` after resolving the root cause.

## Transcript Integrity Check
A nightly cron (`verifyTranscriptIntegrity`) scans every `projectTranscripts` record and logs anomalies: duplicate ids, out-of-order timestamps, or missing `previousItemId` links. Warnings surface in the Convex logs; investigate and re-run the cron manually via `npx convex run projects:verifyTranscriptIntegrity` if needed.

## Field Reference
Job payload includes:
- `messagePointers` – message ids referenced in the update (resolved from assistant pointers when available).
- `transcriptAnchors` – conversation item ids used for transcript excerpts.
- `promptContext` – arbitrary JSON context forwarded to the drafter (outline target, narration cues, etc.).
- `generatedSummary` – persisted after successful model runs so the assistant can narrate completions.

Always confirm new data fields exist before rollout: run `tsc --noEmit` and `npm run test` to validate prompt snapshots.
