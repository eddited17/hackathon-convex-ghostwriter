import { NextResponse } from "next/server";

type NoiseReduction = "default" | "near_field" | "far_field";

type SecretRequest = {
  noiseReduction?: NoiseReduction;
  voice?: string;
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
  } catch (parseError) {
    // Ignore malformed JSON; fall back to defaults.
  }

  const sessionConfig: Record<string, unknown> = {
    type: "realtime",
    model: DEFAULT_MODEL,
    audio: {
      output: {
        voice: payload.voice ?? DEFAULT_VOICE,
      },
    },
  };

  if (payload.noiseReduction && payload.noiseReduction !== "default") {
    (sessionConfig.audio as Record<string, unknown>).input = {
      noise_reduction: { type: payload.noiseReduction },
    };
  }

  const requestBody: Record<string, unknown> = {
    session: sessionConfig,
  };

  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

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
