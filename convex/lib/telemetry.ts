const METRICS_ENDPOINT = process.env.DRAFT_METRICS_ENDPOINT;
const METRICS_TOKEN = process.env.DRAFT_METRICS_TOKEN;
const ALERT_WEBHOOK = process.env.DRAFT_ALERT_WEBHOOK;

export type DraftJobMetricPayload = {
  jobId: string;
  projectId: string;
  sessionId?: string;
  status: "running" | "complete" | "error";
  durationMs?: number;
  attempts?: number;
  promptTokens?: number;
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
  };
  timestamp: number;
};

export async function publishDraftJobMetrics(payload: DraftJobMetricPayload) {
  if (!METRICS_ENDPOINT) {
    console.log("[metrics:draftJob]", payload);
    return;
  }

  try {
    await fetch(METRICS_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(METRICS_TOKEN ? { Authorization: `Bearer ${METRICS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to publish draft job metric", error, payload);
  }
}

export type DraftJobAlertPayload = {
  jobId: string;
  projectId: string;
  sessionId?: string;
  message: string;
  severity: "info" | "warning" | "error";
  summary?: string;
};

export async function sendDraftingAlert(payload: DraftJobAlertPayload) {
  if (!ALERT_WEBHOOK) {
    console.warn("[alert:draftQueue]", payload);
    return;
  }

  try {
    await fetch(ALERT_WEBHOOK, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Failed to send drafting alert", error, payload);
  }
}
