# Task 03c — Ghostwriting V1 Production Push

Goal: elevate the Ghostwriting queue from the stubbed demo into a production-ready experience that can ship without human babysitting. Tasks below are grouped by stream and include concrete sub-steps, owners (TBD), and acceptance checks.

## Stream 1 — Real drafting loop

| Step | Deliverable | Details | Owner | Due | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Prompt package | Build `draftingPrompt({ project, transcript, notes, todos, summary })` utility under `convex/lib/ghostwriting.ts`. Include latest blueprint summary, open TODO list, recent transcript excerpts keyed by `messagePointers`, and prior draft summary. | TBD |  | Prompt returns `{ system: string; user: string; tokens: number }` and is covered by unit snapshot test. |
| 1.2 | Model call wrapper | Create `callDraftingModel(prompt)` action that hits the chosen LLM (start with `gpt-4.1-mini` or config flag). Support retries (3 attempts, exponential backoff). | TBD |  | Wrapper returns `{ markdown, sections, summary, usage }` or throws typed error. |
| 1.3 | Replace stub writer | In `documents.processDraftQueue`, swap lines 410‑417 with the new prompt + model pipeline. Feed anchors from the job payload, apply returned Markdown + sections via `documents.applyEdits`. | TBD |  | Generated draft stored verbatim; sections array matches schema; job log includes model usage. |
| 1.4 | Job payload enrichment | Update `draftJobs` schema (`convex/schema.ts`) to add `messagePointers`, `transcriptAnchors`, `promptContext` JSON. Amend `documents.enqueueDraftUpdate` to persist these (parse args in `useRealtimeSession.ts` and send via mutation). | TBD |  | New fields non-null when assistants pass context; migration script backfills defaults. |
| 1.5 | Summary persistence | After model response, persist `job.generatedSummary` and write it into `documents.applyEdits` summary when provided. | TBD |  | Document summary updates reflect background write, assistant can narrate change. |

## Stream 2 — Realtime feedback + narration

| Step | Deliverable | Details | Owner | Due | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Progress mutation | Add `documents.reportDraftProgress` mutation that takes `{ jobId, projectId, status, summary?, error?, sections? }` and emits `TOOL_PROGRESS::<json>` via `emitSystemJsonMessage`. | TBD |  | Mutation writes log entry and returns OK. |
| 2.2 | Worker hook-up | Call `reportDraftProgress` from `processDraftQueue` on both success and error paths with accurate timestamps and job metadata. | TBD |  | Logs show `status:"completed"` and `status:"error"` flows. |
| 2.3 | Client listener | Extend `useRealtimeSession.ts` to handle new `TOOL_PROGRESS` payloads: append system message to Document chat, update a local “draft status” store for UI badges. | TBD |  | Manual test shows assistant narrates update automatically once backend finishes. |
| 2.4 | Narration template | Update ghostwriting instructions + conversation logic so assistant summarizes `job.generatedSummary` when the completion event lands. | TBD |  | Play-through demonstrates verbal acknowledgement aligned with summary text. |

## Stream 3 — Durable queue execution

| Step | Deliverable | Details | Owner | Due | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Scheduled runner | Configure Convex cron job (`convex/crons.ts`) to invoke `documents.processDraftQueue` every 30s. Include safety guard to bail if more than N jobs processed in single tick. | TBD |  | Jobs continue processing when no browsers are active. |
| 3.2 | Idempotent claims | Harden `claimNextDraftJob` so jobs can be safely retried (store `attempts`, reset to queued on failure, limit to 3). | TBD |  | Re-running action doesn’t duplicate work or stick jobs in running state. |
| 3.3 | Deduping throttle | When enqueuing, ignore repeated requests with identical `(projectId, summary hash)` inside 90s window unless urgency escalates. | TBD |  | Unit test ensures duplicates collapse. |
| 3.4 | Manual runner tool | Add `documents.triggerDraftProcessing` admin mutation for on-demand drains (gated by auth), plus CLI script. | TBD |  | Operator can force-run queue in staging/prod. |

## Stream 4 — Observability & safety nets

| Step | Deliverable | Details | Owner | Due | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 4.1 | Metrics emission | Capture `job.durationMs`, `model.tokens`, `attempts` in `draftJobs`. Push key stats to existing telemetry (Segment/DataDog). | TBD |  | Dashboard tile visible with per-job metrics. |
| 4.2 | Error alerts | Integrate with alerting sink (Slack webhook or OpsGenie) when `status:"error"` or when retries exhausted. Include projectId + last summary. | TBD |  | Test alert fires in staging and reaches on-call channel. |
| 4.3 | Transcript integrity check | Add nightly cron that verifies `projectTranscripts` ordering, logs anomalies. | TBD |  | Job completes without errors; anomalies reported. |
| 4.4 | Docs/runbook | Write operational guide in `docs/runbooks/ghostwriting.md` covering queue inspection, manual retries, rollback process. | TBD |  | Doc peer-reviewed and linked from ops wiki. |

## Stream 5 — Verification & launch

| Step | Deliverable | Details | Owner | Due | Acceptance |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Test matrix | Execute scripted test across 3 project archetypes (new project, resume blueprint, active drafting). Record outcomes + timing. | TBD |  | Spreadsheet with pass/fail and notes stored in drive. |
| 5.2 | Latency baseline | Log drafting latency across 10 runs; ensure P95 < agreed SLA (e.g., 45s). | TBD |  | Metrics sign-off from product. |
| 5.3 | Stakeholder review | Demo to product/design/support; capture sign-off checklist items and confirm ready-to-ship. | TBD |  | Sign-off recorded, follow-up issues tracked. |
| 5.4 | Launch checklist | Verify feature flags/defaults, ensure migration scripts applied, announce rollout schedule. | TBD |  | All checklist boxes ticked prior to prod flip. |

### Tracking & updates
- Populate Owners/Due columns in sprint planning.
- Move completed rows to an appendix or mark ✅; leave timestamps/links for audit.
- Append lessons learned after launch to inform Ghostwriting V2.
