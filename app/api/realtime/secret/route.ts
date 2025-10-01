import { NextResponse } from "next/server";

import {
  DEFAULT_LANGUAGE_OPTION,
  findLanguageOption,
} from "@/lib/languages";
import {
  buildSessionInstructions,
  type SessionInstructionMode,
} from "@/lib/realtimeInstructions";
import {
  getInitialToolList,
  isSessionInstructionMode,
} from "@/lib/realtimeTools";

type NoiseReduction = "default" | "near_field" | "far_field";

type TurnDetectionPayload =
  | {
      type: "semantic_vad";
      eagerness?: "low" | "medium" | "high" | "auto";
    }
  | {
      type: "server_vad";
      threshold?: number;
      prefix_padding_ms?: number;
      silence_duration_ms?: number;
    };

type SecretRequest = {
  noiseReduction?: NoiseReduction;
  voice?: string;
  language?: string;
  hasProjectContext?: boolean;
  mode?: SessionInstructionMode;
  turnDetection?: TurnDetectionPayload;
};

const OPENAI_ENDPOINT = "https://api.openai.com/v1/realtime/client_secrets";
const DEFAULT_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
const DEFAULT_VOICE = process.env.OPENAI_REALTIME_VOICE ?? "marin";

const isValidNoiseReduction = (
  value: unknown,
): value is NoiseReduction =>
  value === "default" || value === "near_field" || value === "far_field";

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "OPENAI_API_KEY not configured",
      },
      { status: 500 },
    );
  }

  const payload: SecretRequest = {};
  try {
    const body = await request.json();
    if (isValidNoiseReduction(body?.noiseReduction)) {
      payload.noiseReduction = body.noiseReduction;
    }
    if (typeof body?.voice === "string") {
      payload.voice = body.voice;
    }
    if (typeof body?.language === "string") {
      payload.language = body.language;
    }
    if (typeof body?.hasProjectContext === "boolean") {
      payload.hasProjectContext = body.hasProjectContext;
    }
    if (isSessionInstructionMode(body?.mode)) {
      payload.mode = body.mode;
    }
  } catch (parseError) {
    // Ignore malformed JSON; fall back to defaults.
  }

  const selectedLanguage = findLanguageOption(
    payload.language ?? DEFAULT_LANGUAGE_OPTION.value,
  );
  const inferredProjectContext =
    payload.hasProjectContext ??
    (payload.mode ? payload.mode !== "intake" : undefined);
  const hasProjectContext = Boolean(inferredProjectContext);
  const resolvedMode: SessionInstructionMode = payload.mode
    ? payload.mode
    : hasProjectContext
      ? "blueprint"
      : "intake";
  const tools = getInitialToolList({
    mode: resolvedMode,
    hasProjectContext,
  });
  const instructions = buildSessionInstructions({
    language: selectedLanguage,
    hasProjectContext,
    mode: resolvedMode,
  });

  const buildSessionConfig = (includeTurnDetection: boolean) => {
    const audioConfig: Record<string, unknown> = {
      output: {
        voice: payload.voice ?? DEFAULT_VOICE,
      },
    };

    if (payload.noiseReduction && payload.noiseReduction !== "default") {
      audioConfig.input = {
        noise_reduction: { type: payload.noiseReduction },
      };
    }

    const sessionConfig: Record<string, unknown> = {
      type: "realtime",
      model: DEFAULT_MODEL,
      audio: audioConfig,
      instructions,
      tools,
    };

    if (includeTurnDetection && payload.turnDetection) {
      sessionConfig.turn_detection =
        payload.turnDetection.type === "semantic_vad"
          ? {
              type: "semantic_vad",
              eagerness: payload.turnDetection.eagerness,
            }
          : {
              type: "server_vad",
              threshold: payload.turnDetection.threshold,
              prefix_padding_ms: payload.turnDetection.prefix_padding_ms,
              silence_duration_ms: payload.turnDetection.silence_duration_ms,
            };
    }

    return sessionConfig;
  };

  const createClientSecret = async (sessionConfig: Record<string, unknown>) => {
    return fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ session: sessionConfig }),
    });
  };

  try {
    const includeTurnDetection = Boolean(payload.turnDetection);
    let response = await createClientSecret(
      buildSessionConfig(includeTurnDetection),
    );

    if (!response.ok && payload.turnDetection) {
      const detail = await response.text();
      console.warn(
        "[realtime] turn_detection rejected during secret creation; retrying without custom config",
        {
          status: response.status,
          detail,
        },
      );
      response = await createClientSecret(buildSessionConfig(false));
      if (!response.ok) {
        const fallbackDetail = await response.text();
        return NextResponse.json(
          {
            error: "Failed to create realtime client secret",
            detail: fallbackDetail,
          },
          { status: response.status },
        );
      }
    }

    if (!response.ok) {
      const detail = await response.text();
      return NextResponse.json(
        {
          error: "Failed to create realtime client secret",
          detail,
        },
        { status: response.status },
      );
    }

    const secret = await response.json();
    return NextResponse.json(secret);
  } catch (error) {
    console.error("Failed to request realtime client secret", error);
    return NextResponse.json(
      {
        error: "Unexpected error requesting realtime client secret",
      },
      { status: 500 },
    );
  }
}
