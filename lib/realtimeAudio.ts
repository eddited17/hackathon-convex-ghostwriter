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

export const createPeerConnection = () => {
  return new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
    ],
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
