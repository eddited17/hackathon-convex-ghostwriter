export type NoiseReductionProfile = "default" | "near_field" | "far_field";

export const NOISE_REDUCTION_OPTIONS: Array<{
  value: NoiseReductionProfile;
  label: string;
  description: string;
}> = [
  {
    value: "near_field",
    label: "Near-field",
    description: "Desk mic or laptop mic within ~1 meter",
  },
  {
    value: "far_field",
    label: "Far-field",
    description: "Conference room or built-in mic >1 meter away",
  },
  {
    value: "default",
    label: "Model default",
    description: "Let OpenAI choose automatically",
  },
];

export type TurnDetectionConfig =
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

export type TurnDetectionPreset =
  | "semantic_low"
  | "semantic_medium"
  | "semantic_high"
  | "semantic_auto"
  | "server_default";

export type TurnDetectionOption = {
  value: TurnDetectionPreset;
  label: string;
  description: string;
  config: TurnDetectionConfig;
};

export const TURN_DETECTION_OPTIONS: TurnDetectionOption[] = [
  {
    value: "semantic_low",
    label: "Semantic (patient)",
    description: "Waits for natural pauses before replying; minimizes interruptions.",
    config: { type: "semantic_vad", eagerness: "low" },
  },
  {
    value: "semantic_medium",
    label: "Semantic (balanced)",
    description: "Balances responsiveness with giving the speaker room to finish.",
    config: { type: "semantic_vad", eagerness: "medium" },
  },
  {
    value: "semantic_high",
    label: "Semantic (quick)",
    description: "Responds as soon as it detects intent; best for rapid back-and-forth.",
    config: { type: "semantic_vad", eagerness: "high" },
  },
  {
    value: "semantic_auto",
    label: "Semantic (auto)",
    description: "Let the model adapt turn-taking dynamically during the call.",
    config: { type: "semantic_vad", eagerness: "auto" },
  },
  {
    value: "server_default",
    label: "Silence detection",
    description: "Use server-side silence thresholding (OpenAI default behaviour).",
    config: {
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
    },
  },
];

export const DEFAULT_TURN_DETECTION_PRESET: TurnDetectionPreset = "semantic_low";

export const getTurnDetectionConfig = (
  preset: TurnDetectionPreset,
): TurnDetectionConfig => {
  const option = TURN_DETECTION_OPTIONS.find((entry) => entry.value === preset);
  const fallback = TURN_DETECTION_OPTIONS[0];
  const source = option ?? fallback;

  if (source.config.type === "semantic_vad") {
    return { type: "semantic_vad", eagerness: source.config.eagerness };
  }

  return {
    type: "server_vad",
    threshold: source.config.threshold,
    prefix_padding_ms: source.config.prefix_padding_ms,
    silence_duration_ms: source.config.silence_duration_ms,
  };
};

export interface VoiceActivityState {
  user: boolean;
  assistant: boolean;
}

export class AudioLevelMonitor {
  private analyser: AnalyserNode | null = null;
  private dataArray: Float32Array<ArrayBuffer> = new Float32Array(512);
  private rafId: number | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(
    private readonly context: AudioContext,
    private readonly onUpdate: (value: number) => void,
  ) {}

  connect(stream: MediaStream) {
    this.disconnect();

    if (this.context.state === "suspended") {
      void this.context.resume();
    }

    this.source = this.context.createMediaStreamSource(stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.source.connect(this.analyser);

    const loop = () => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.dataArray);
      let sumSquares = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const value = this.dataArray[i];
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / this.dataArray.length);
      const scaled = Math.min(1, Math.sqrt(rms) * 4);
      this.onUpdate(Number.isFinite(scaled) ? scaled : 0);
      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  disconnect() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.source) {
      try {
        this.source.disconnect();
      } catch (error) {
        console.warn("Failed to disconnect audio source", error);
      }
      this.source = null;
    }

    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch (error) {
        console.warn("Failed to disconnect analyser", error);
      }
      this.analyser = null;
    }
  }
}

const DEFAULT_ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const parseIceServers = (): RTCIceServer[] => {
  const raw = process.env.NEXT_PUBLIC_WEBRTC_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;

  const servers = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((urls) => ({ urls }));

  return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS;
};

export const createPeerConnection = () => {
  return new RTCPeerConnection({
    iceServers: parseIceServers(),
  });
};

export const applySinkId = async (
  element: HTMLMediaElement | null,
  deviceId: string | undefined,
) => {
  if (!element || !deviceId) return;
  const sinkSetter = (element as HTMLMediaElement & {
    setSinkId?: (sinkId: string) => Promise<void>;
  }).setSinkId;

  if (!sinkSetter) return;

  try {
    await sinkSetter.call(element, deviceId);
  } catch (error) {
    console.warn("Unable to set audio sink", error);
  }
};

export interface TranscriptionFragment {
  id: string;
  text: string;
  speaker: "user" | "assistant";
  timestamp: number;
}
