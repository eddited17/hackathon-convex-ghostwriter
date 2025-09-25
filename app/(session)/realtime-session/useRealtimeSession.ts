"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";

import {
  AudioLevelMonitor,
  NOISE_REDUCTION_OPTIONS,
  NoiseReductionProfile,
  TranscriptionFragment,
  VoiceActivityState,
  applySinkId,
  createPeerConnection,
} from "@/lib/realtimeAudio";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

type SessionStatus =
  | "idle"
  | "requesting-permissions"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

type ConnectionEvent = {
  id: string;
  message: string;
  timestamp: number;
};

type ServerEventLog = {
  id: string;
  type: string;
  timestamp: number;
  payload: unknown;
};

type SessionBootstrap = {
  sessionId: Id<"sessions">;
  projectId: Id<"projects">;
  startedAt: number;
};

type ServerMessage = {
  type?: string;
  event_id?: string;
  session?: { id?: string; model?: string };
  response_id?: string;
  response?: { id?: string; output?: unknown };
  item_id?: string;
  item?: {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
  };
  delta?: unknown;
  transcript?: unknown;
  text?: unknown;
  output_text?: unknown;
  participant?: string;
};

type ManualMessageOptions = {
  skipPersist?: boolean;
};

export interface RealtimeSessionState {
  status: SessionStatus;
  statusMessage: string | null;
  isConnected: boolean;
  startSession: () => Promise<void>;
  stopSession: (reason?: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  selectedInputDeviceId?: string;
  selectInputDevice: (deviceId: string) => Promise<void>;
  selectedOutputDeviceId?: string;
  selectOutputDevice: (deviceId: string) => Promise<void>;
  noiseReduction: NoiseReductionProfile;
  setNoiseReduction: (profile: NoiseReductionProfile) => void;
  microphoneLevel: number;
  assistantLevel: number;
  voiceActivity: VoiceActivityState;
  transcripts: TranscriptionFragment[];
  partialUserTranscript: string | null;
  partialAssistantTranscript: string | null;
  connectionLog: ConnectionEvent[];
  serverEvents: ServerEventLog[];
  error: string | null;
  sendTextMessage: (message: string, options?: ManualMessageOptions) => Promise<void>;
  registerAudioElement: (element: HTMLAudioElement | null) => void;
}

const extractText = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");
    return joined || null;
  }
  if (typeof value === "object") {
    if (
      "text" in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).text === "string"
    ) {
      return (value as Record<string, unknown>).text as string;
    }
    if (
      "transcript" in (value as Record<string, unknown>) &&
      typeof (value as Record<string, unknown>).transcript === "string"
    ) {
      return (value as Record<string, unknown>).transcript as string;
    }
    if ("content" in (value as Record<string, unknown>)) {
      return extractText((value as Record<string, unknown>).content);
    }
  }
  return null;
};

const sanitizeTranscript = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim() ?? "";

export function useRealtimeSession(): RealtimeSessionState {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState<string>();
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] =
    useState<string>();
  const [noiseReduction, setNoiseReduction] =
    useState<NoiseReductionProfile>("near_field");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [assistantLevel, setAssistantLevel] = useState(0);
  const [voiceActivity, setVoiceActivity] = useState<VoiceActivityState>({
    user: false,
    assistant: false,
  });
  const [transcripts, setTranscripts] = useState<TranscriptionFragment[]>([]);
  const [partialUserTranscript, setPartialUserTranscript] =
    useState<string | null>(null);
  const [partialAssistantTranscript, setPartialAssistantTranscript] =
    useState<string | null>(null);
  const [connectionLog, setConnectionLog] = useState<ConnectionEvent[]>([]);
  const [serverEvents, setServerEvents] = useState<ServerEventLog[]>([]);
  const [sessionRecord, setSessionRecord] =
    useState<SessionBootstrap | null>(null);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micMonitorRef = useRef<AudioLevelMonitor | null>(null);
  const assistantMonitorRef = useRef<AudioLevelMonitor | null>(null);
  const userFragmentsRef = useRef<Map<string, string>>(new Map());
  const assistantFragmentsRef = useRef<Map<string, string>>(new Map());
  const persistedMessageIdsRef = useRef<Set<string>>(new Set());
  const completeOnceRef = useRef(false);

  const createSessionMutation = useMutation(api.sessions.createSession);
  const updateRealtimeMutation = useMutation(
    api.sessions.updateRealtimeSessionId,
  );
  const completeSessionMutation = useMutation(api.sessions.completeSession);
  const setNoiseProfileMutation = useMutation(api.sessions.setNoiseProfile);
  const appendMessageMutation = useMutation(api.messages.appendMessage);

  const logConnection = useCallback((message: string) => {
    setConnectionLog((previous) => {
      const entry: ConnectionEvent = {
        id: randomId(),
        message,
        timestamp: Date.now(),
      };
      const next = [...previous, entry];
      return next.slice(-40);
    });
  }, []);

  const resetMonitors = useCallback(() => {
    micMonitorRef.current?.disconnect();
    assistantMonitorRef.current?.disconnect();
    micMonitorRef.current = null;
    assistantMonitorRef.current = null;
    setMicrophoneLevel(0);
    setAssistantLevel(0);
  }, []);

  const resetFragments = useCallback(() => {
    userFragmentsRef.current.clear();
    assistantFragmentsRef.current.clear();
    persistedMessageIdsRef.current.clear();
    setPartialUserTranscript(null);
    setPartialAssistantTranscript(null);
  }, []);

  const registerAudioElement = useCallback(
    (element: HTMLAudioElement | null) => {
      audioElementRef.current = element;
      if (element) {
        element.autoplay = true;
        element.muted = false;
        element.setAttribute("playsinline", "true");
      }
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator?.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((device) => device.kind === "audioinput");
      const outputs = devices.filter(
        (device) => device.kind === "audiooutput",
      );

      setInputDevices(inputs);
      setOutputDevices(outputs);

      if (!selectedInputDeviceId && inputs.length > 0) {
        setSelectedInputDeviceId(inputs[0]!.deviceId);
      }

      if (!selectedOutputDeviceId && outputs.length > 0) {
        setSelectedOutputDeviceId(outputs[0]!.deviceId);
      }
    } catch (deviceError) {
      console.error("Failed to enumerate devices", deviceError);
    }
  }, [selectedInputDeviceId, selectedOutputDeviceId]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (!navigator?.mediaDevices?.addEventListener) return;
    const handler = () => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [refreshDevices]);

  const finalizeTranscript = useCallback(
    async (
      speaker: "user" | "assistant",
      key: string,
      rawText: string | null | undefined,
    ) => {
      const text = sanitizeTranscript(rawText);
      if (!text || persistedMessageIdsRef.current.has(key)) {
        return;
      }

      const message: TranscriptionFragment = {
        id: key,
        speaker,
        text,
        timestamp: Date.now(),
      };

      persistedMessageIdsRef.current.add(key);
      setTranscripts((previous) => {
        const filtered = previous.filter((entry) => entry.id !== key);
        const next = [...filtered, message];
        next.sort((a, b) => a.timestamp - b.timestamp);
        return next;
      });

      if (speaker === "user") {
        setPartialUserTranscript(null);
        setVoiceActivity((current) => ({ ...current, user: false }));
      } else {
        setPartialAssistantTranscript(null);
        setVoiceActivity((current) => ({ ...current, assistant: false }));
      }

      if (sessionRecord?.sessionId) {
        try {
          await appendMessageMutation({
            sessionId: sessionRecord.sessionId,
            speaker,
            transcript: text,
            timestamp: message.timestamp,
            eventId: key,
          });
        } catch (persistError) {
          console.error("Failed to persist transcript", persistError);
        }
      }
    },
    [appendMessageMutation, sessionRecord],
  );

  const handleServerEvent = useCallback(
    async (payload: string | ArrayBuffer) => {
      try {
        const textPayload =
          typeof payload === "string"
            ? payload
            : new TextDecoder().decode(payload as ArrayBuffer);
        const event: ServerMessage = JSON.parse(textPayload);
        const eventId = event.event_id ?? randomId();

        setServerEvents((previous) => {
          const entry: ServerEventLog = {
            id: eventId,
            type: event.type ?? "unknown",
            timestamp: Date.now(),
            payload: event,
          };
          const next = [...previous, entry];
          return next.slice(-50);
        });

        switch (event.type) {
          case "session.created": {
            if (event.session?.id && sessionRecord?.sessionId) {
              logConnection(`Realtime session ready (${event.session.id})`);
              try {
                await updateRealtimeMutation({
                  sessionId: sessionRecord.sessionId,
                  realtimeSessionId: event.session.id,
                });
              } catch (sessionError) {
                console.error("Failed to sync realtime session id", sessionError);
              }
            }
            break;
          }
          case "input_audio_buffer.speech_started": {
            setVoiceActivity((current) => ({ ...current, user: true }));
            break;
          }
          case "input_audio_buffer.speech_stopped": {
            setVoiceActivity((current) => ({ ...current, user: false }));
            if (event.item_id) {
              userFragmentsRef.current.delete(event.item_id);
            }
            setPartialUserTranscript(null);
            break;
          }
          case "response.audio.delta": {
            setVoiceActivity((current) => ({ ...current, assistant: true }));
            break;
          }
          case "response.audio.completed":
          case "response.done":
          case "response.completed": {
            setVoiceActivity((current) => ({ ...current, assistant: false }));
            break;
          }
          case "conversation.item.input_audio_transcription.delta": {
            const key = event.item_id ?? eventId;
            const deltaText = extractText(event.delta) ?? extractText(event.text);
            if (deltaText) {
              const currentText =
                userFragmentsRef.current.get(key) ?? "";
              const nextText = `${currentText}${deltaText}`;
              userFragmentsRef.current.set(key, nextText);
              setPartialUserTranscript(nextText);
            }
            break;
          }
          case "conversation.item.input_audio_transcription.completed": {
            const key = event.item_id ?? eventId;
            const text =
              extractText(event.transcript) ??
              userFragmentsRef.current.get(key) ??
              extractText(event.text);
            await finalizeTranscript("user", key, text);
            userFragmentsRef.current.delete(key);
            break;
          }
          case "response.output_text.delta": {
            const key =
              event.response_id ?? event.response?.id ?? "assistant";
            const deltaText =
              extractText(event.delta) ?? extractText(event.output_text);
            if (deltaText) {
              const currentText =
                assistantFragmentsRef.current.get(key) ?? "";
              const nextText = `${currentText}${deltaText}`;
              assistantFragmentsRef.current.set(key, nextText);
              setPartialAssistantTranscript(nextText);
              setVoiceActivity((current) => ({
                ...current,
                assistant: true,
              }));
            }
            break;
          }
          case "response.output_text.done": {
            const key =
              event.response_id ?? event.response?.id ?? eventId;
            const text =
              extractText(event.output_text) ??
              assistantFragmentsRef.current.get(key);
            await finalizeTranscript("assistant", key, text);
            assistantFragmentsRef.current.delete(key);
            break;
          }
          case "conversation.item.created": {
            if (event.item?.type === "message") {
              const role = event.item.role;
              if (role === "user" || role === "assistant") {
                const key = `${role}-${event.item.id ?? eventId}`;
                const text = extractText(event.item.content);
                await finalizeTranscript(
                  role === "user" ? "user" : "assistant",
                  key,
                  text,
                );
              }
            }
            break;
          }
          default: {
            break;
          }
        }
      } catch (eventError) {
        console.error("Failed to process realtime event", eventError);
      }
    },
    [finalizeTranscript, logConnection, sessionRecord, updateRealtimeMutation],
  );

  const tearDownConnection = useCallback(async () => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerConnectionRef.current?.getSenders().forEach((sender) => {
      sender.track?.stop();
    });
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    resetMonitors();
    resetFragments();
    setVoiceActivity({ user: false, assistant: false });
  }, [resetFragments, resetMonitors]);

  const startSession = useCallback(async () => {
    if (status === "connecting" || status === "connected") return;
    if (!audioElementRef.current) {
      setError("Audio element not ready");
      return;
    }

    setStatus("requesting-permissions");
    setStatusMessage("Requesting microphone access");
    setError(null);
    logConnection("Requesting microphone access");

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInputDeviceId
            ? { exact: selectedInputDeviceId }
            : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      localStreamRef.current = mediaStream;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      if (!micMonitorRef.current) {
        micMonitorRef.current = new AudioLevelMonitor(
          audioContextRef.current,
          setMicrophoneLevel,
        );
      }
      micMonitorRef.current.connect(mediaStream);

      setStatus("connecting");
      setStatusMessage("Opening Convex session");
      logConnection("Creating Convex session record");

      const createdSession = await createSessionMutation({
        noiseProfile: noiseReduction,
      });
      completeOnceRef.current = false;
      setSessionRecord(createdSession);

      const secretResponse = await fetch("/api/realtime/secret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noiseReduction,
        }),
      });

      if (!secretResponse.ok) {
        throw new Error(
          `Failed to fetch realtime client secret (${secretResponse.status})`,
        );
      }

      const secretPayload = await secretResponse.json();
      const ephemeralKey: string | undefined =
        secretPayload?.client_secret?.value ?? secretPayload?.value;
      const model: string =
        secretPayload?.session?.model ??
        secretPayload?.model ??
        process.env.NEXT_PUBLIC_OPENAI_REALTIME_MODEL ??
        "gpt-realtime";

      if (!ephemeralKey) {
        throw new Error("Realtime client secret missing in response");
      }

      logConnection("Opening peer connection");
      const peerConnection = createPeerConnection();
      peerConnectionRef.current = peerConnection;

      peerConnection.addEventListener("connectionstatechange", () => {
        const connectionState = peerConnection.connectionState;
        logConnection(`Peer connection state: ${connectionState}`);
        if (connectionState === "failed") {
          setStatus("error");
          setError("Peer connection failed");
        }
        if (connectionState === "closed") {
          setStatus("ended");
        }
      });

      peerConnection.ontrack = (event) => {
        const [remoteStream] = event.streams;
        const element = audioElementRef.current;
        if (remoteStream && element) {
          element.srcObject = remoteStream;
          void element.play().catch((playError) => {
            console.warn("Autoplay blocked", playError);
          });
          if (!audioContextRef.current) {
            audioContextRef.current = new AudioContext();
          }
          if (audioContextRef.current) {
            if (!assistantMonitorRef.current) {
              assistantMonitorRef.current = new AudioLevelMonitor(
                audioContextRef.current,
                setAssistantLevel,
              );
            }
            assistantMonitorRef.current.connect(remoteStream);
          }
          if (selectedOutputDeviceId) {
            void applySinkId(element, selectedOutputDeviceId);
          }
        }
      };

      const dataChannel = peerConnection.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;

      dataChannel.addEventListener("open", () => {
        logConnection("Realtime data channel open");
        setStatus("connected");
        setStatusMessage("Listening");
      });

      dataChannel.addEventListener("close", () => {
        logConnection("Realtime data channel closed");
        if (status !== "ended") {
          setStatus("ended");
        }
      });

      dataChannel.addEventListener("error", (event) => {
        console.error("Data channel error", event);
        setError("Realtime data channel error");
        setStatus("error");
      });

      dataChannel.addEventListener("message", (event) => {
        void handleServerEvent(event.data as string | ArrayBuffer);
      });

      mediaStream.getAudioTracks().forEach((track) => {
        peerConnection.addTrack(track, mediaStream);
      });

      if (peerConnection.getTransceivers().length === 0) {
        peerConnection.addTransceiver("audio", { direction: "sendrecv" });
      }

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      logConnection("Sending SDP offer to OpenAI");
      const response = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(
          model,
        )}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp ?? "",
        },
      );

      if (!response.ok) {
        throw new Error(
          `OpenAI Realtime handshake failed (${response.status})`,
        );
      }

      const answerSdp = await response.text();
      await peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answerSdp,
      });
      logConnection("Realtime session established");
      setStatusMessage("Connected");

      if (selectedOutputDeviceId) {
        await applySinkId(audioElementRef.current, selectedOutputDeviceId);
      }
    } catch (startError) {
      console.error("Failed to start realtime session", startError);
      setError(startError instanceof Error ? startError.message : String(startError));
      setStatus("error");
      setStatusMessage("Unable to start session");
      await tearDownConnection();
    }
  }, [
    audioElementRef,
    createSessionMutation,
    handleServerEvent,
    logConnection,
    noiseReduction,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    status,
    tearDownConnection,
  ]);

  const stopSession = useCallback(
    async (reason?: string) => {
      if (status === "idle") return;
      await tearDownConnection();
      if (reason) {
        setStatusMessage(reason);
      }
      if (sessionRecord?.sessionId && !completeOnceRef.current) {
        try {
          await completeSessionMutation({
            sessionId: sessionRecord.sessionId,
          });
          completeOnceRef.current = true;
        } catch (completionError) {
          console.error("Failed to mark session complete", completionError);
        }
      }
      setSessionRecord(null);
      setStatus("ended");
    },
    [completeSessionMutation, sessionRecord, status, tearDownConnection],
  );

  const stopSessionRef = useRef(stopSession);
  useEffect(() => {
    stopSessionRef.current = stopSession;
  }, [stopSession]);

  useEffect(() => {
    return () => {
      const cleanup = stopSessionRef.current;
      void cleanup();
    };
  }, []);

  const selectInputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedInputDeviceId(deviceId);
      if (!peerConnectionRef.current) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        const [newTrack] = newStream.getAudioTracks();
        const sender = peerConnectionRef.current
          .getSenders()
          .find((candidate) => candidate.track?.kind === "audio");
        if (sender && newTrack) {
          await sender.replaceTrack(newTrack);
        }
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        localStreamRef.current = newStream;
        if (micMonitorRef.current) {
          micMonitorRef.current.connect(newStream);
        }
        logConnection("Switched microphone input");
      } catch (deviceError) {
        console.error("Failed to switch microphone", deviceError);
        setError("Unable to access selected microphone");
      }
    },
    [logConnection],
  );

  const selectOutputDevice = useCallback(
    async (deviceId: string) => {
      setSelectedOutputDeviceId(deviceId);
      if (audioElementRef.current) {
        await applySinkId(audioElementRef.current, deviceId);
        logConnection("Routed audio to selected output");
      }
    },
    [logConnection],
  );

  useEffect(() => {
    if (status !== "connected") return;
    if (!dataChannelRef.current) return;
    try {
      if (noiseReduction && noiseReduction !== "default") {
        dataChannelRef.current.send(
          JSON.stringify({
            type: "session.update",
            session: {
              audio: {
                input: { noise_reduction: { type: noiseReduction } },
              },
            },
          }),
        );
      }
      if (sessionRecord?.sessionId) {
        void setNoiseProfileMutation({
          sessionId: sessionRecord.sessionId,
          noiseProfile: noiseReduction,
        });
      }
      logConnection(`Noise reduction set to ${noiseReduction}`);
    } catch (updateError) {
      console.error("Failed to update noise profile", updateError);
    }
  }, [
    logConnection,
    noiseReduction,
    sessionRecord,
    setNoiseProfileMutation,
    status,
  ]);

  const sendTextMessage = useCallback(
    async (message: string, options?: ManualMessageOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;
      if (!dataChannelRef.current) {
        throw new Error("Realtime connection not ready");
      }
      const clientEvent = {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: trimmed,
            },
          ],
        },
      };
      dataChannelRef.current.send(JSON.stringify(clientEvent));
      dataChannelRef.current.send(JSON.stringify({ type: "response.create" }));
      if (!options?.skipPersist) {
        const key = `manual-${Date.now()}`;
        await finalizeTranscript("user", key, trimmed);
      }
    },
    [finalizeTranscript],
  );

  return useMemo(
    () => ({
      status,
      statusMessage,
      isConnected: status === "connected",
      startSession,
      stopSession,
      refreshDevices,
      inputDevices,
      outputDevices,
      selectedInputDeviceId,
      selectInputDevice,
      selectedOutputDeviceId,
      selectOutputDevice,
      noiseReduction,
      setNoiseReduction,
      microphoneLevel,
      assistantLevel,
      voiceActivity,
      transcripts,
      partialUserTranscript,
      partialAssistantTranscript,
      connectionLog,
      serverEvents,
      error,
      sendTextMessage,
      registerAudioElement,
    }),
    [
      assistantLevel,
      connectionLog,
      error,
      inputDevices,
      noiseReduction,
      outputDevices,
      partialAssistantTranscript,
      partialUserTranscript,
      refreshDevices,
      registerAudioElement,
      selectInputDevice,
      selectOutputDevice,
      selectedInputDeviceId,
      selectedOutputDeviceId,
      sendTextMessage,
      startSession,
      status,
      statusMessage,
      stopSession,
      transcripts,
      voiceActivity,
      microphoneLevel,
      serverEvents,
      setNoiseReduction,
    ],
  );
}

export { NOISE_REDUCTION_OPTIONS };
