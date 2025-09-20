"use client";

import { useCallback, useMemo, useState } from "react";

import type { NoiseReductionProfile } from "@/lib/realtimeAudio";

import {
  NOISE_REDUCTION_OPTIONS,
  useRealtimeSession,
} from "./useRealtimeSession";

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);

type DeviceSelectProps = {
  label: string;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange: (deviceId: string) => Promise<void>;
  disabled?: boolean;
};

function DeviceSelect({ label, devices, value, onChange, disabled }: DeviceSelectProps) {
  return (
    <label className="device-select">
      <span>{label}</span>
      <select
        disabled={disabled || devices.length === 0}
        value={value ?? ""}
        onChange={(event) => {
          void onChange(event.target.value);
        }}
      >
        {devices.length === 0 && <option value="">No devices detected</option>}
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${device.kind} (${device.deviceId})`}
          </option>
        ))}
      </select>
    </label>
  );
}

type LevelMeterProps = {
  label: string;
  level: number;
  active: boolean;
  tone: "primary" | "secondary";
};

function LevelMeter({ label, level, active, tone }: LevelMeterProps) {
  const width = Math.min(100, Math.round(level * 100));
  return (
    <div className={`level-meter level-${tone}`}>
      <div className="level-header">
        <span>{label}</span>
        <span className={`badge ${active ? "badge-active" : ""}`}>
          {active ? "speaking" : "idle"}
        </span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

type NoiseReductionToggleProps = {
  value: NoiseReductionProfile;
  onChange: (profile: NoiseReductionProfile) => void;
  disabled?: boolean;
};

function NoiseReductionToggle({ value, onChange, disabled }: NoiseReductionToggleProps) {
  return (
    <fieldset className="noise-toggle" disabled={disabled}>
      <legend>Noise reduction</legend>
      {NOISE_REDUCTION_OPTIONS.map((option) => (
        <label key={option.value} className="noise-option">
          <input
            type="radio"
            name="noise-profile"
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            disabled={disabled}
          />
          <div>
            <span className="noise-label">{option.label}</span>
            <span className="noise-description">{option.description}</span>
          </div>
        </label>
      ))}
    </fieldset>
  );
}

type TranscriptListProps = {
  transcripts: ReturnType<typeof useRealtimeSession>["transcripts"];
  partialUserTranscript: string | null;
  partialAssistantTranscript: string | null;
};

function TranscriptList({ transcripts, partialAssistantTranscript, partialUserTranscript }: TranscriptListProps) {
  return (
    <ol className="transcript-list">
      {transcripts.length === 0 && !partialAssistantTranscript && !partialUserTranscript ? (
        <li className="placeholder">Start speaking to populate the transcript.</li>
      ) : null}
      {transcripts.map((entry) => (
        <li key={entry.id} className={`transcript transcript-${entry.speaker}`}>
          <div className="transcript-meta">
            <span className="speaker">{entry.speaker === "user" ? "You" : "Assistant"}</span>
            <time dateTime={new Date(entry.timestamp).toISOString()}>
              {formatTime(entry.timestamp)}
            </time>
          </div>
          <p>{entry.text}</p>
        </li>
      ))}
      {partialUserTranscript ? (
        <li className="transcript transcript-user transcript-partial">
          <div className="transcript-meta">
            <span className="speaker">You</span>
            <span className="partial-indicator">capturing…</span>
          </div>
          <p>{partialUserTranscript}</p>
        </li>
      ) : null}
      {partialAssistantTranscript ? (
        <li className="transcript transcript-assistant transcript-partial">
          <div className="transcript-meta">
            <span className="speaker">Assistant</span>
            <span className="partial-indicator">responding…</span>
          </div>
          <p>{partialAssistantTranscript}</p>
        </li>
      ) : null}
    </ol>
  );
}

type DiagnosticsProps = {
  connectionLog: ReturnType<typeof useRealtimeSession>["connectionLog"];
  serverEvents: ReturnType<typeof useRealtimeSession>["serverEvents"];
};

function Diagnostics({ connectionLog, serverEvents }: DiagnosticsProps) {
  const recentServerEvents = serverEvents.slice(-12).reverse();
  return (
    <div className="diagnostics">
      <section>
        <h3>Connection log</h3>
        <ul>
          {connectionLog.length === 0 ? (
            <li className="placeholder">No connection activity yet.</li>
          ) : (
            connectionLog
              .slice(-12)
              .reverse()
              .map((event) => (
                <li key={event.id}>
                  <span className="time">{formatTime(event.timestamp)}</span>
                  <span>{event.message}</span>
                </li>
              ))
          )}
        </ul>
      </section>
      <section>
        <h3>Realtime events</h3>
        <ul>
          {recentServerEvents.length === 0 ? (
            <li className="placeholder">Events will appear after the session starts.</li>
          ) : (
            recentServerEvents.map((event) => (
              <li key={event.id}>
                <span className="time">{formatTime(event.timestamp)}</span>
                <span>{event.type}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

const statusDescriptions: Record<string, string> = {
  idle: "Idle — ready to connect",
  "requesting-permissions": "Awaiting microphone permission",
  connecting: "Connecting to OpenAI Realtime",
  connected: "Streaming audio",
  ended: "Session ended",
  error: "Connection error",
};

export default function RealtimeSessionShell() {
  const {
    status,
    statusMessage,
    isConnected,
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
  } = useRealtimeSession();

  const [manualMessage, setManualMessage] = useState("");

  const statusLabel = useMemo(() => {
    const base = statusDescriptions[status] ?? status;
    if (status === "error" && error) {
      return `${base}: ${error}`;
    }
    if (statusMessage) {
      return `${base}${statusMessage ? ` — ${statusMessage}` : ""}`;
    }
    return base;
  }, [error, status, statusMessage]);

  const audioRef = useCallback(
    (element: HTMLAudioElement | null) => {
      registerAudioElement(element);
    },
    [registerAudioElement],
  );

  const handleStart = useCallback(() => {
    void startSession();
  }, [startSession]);

  const handleStop = useCallback(() => {
    void stopSession("Session ended by user");
  }, [stopSession]);

  const handleManualSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!manualMessage.trim()) return;
      void sendTextMessage(manualMessage).then(() => setManualMessage(""));
    },
    [manualMessage, sendTextMessage],
  );

  return (
    <div className="realtime-shell">
      <header className="shell-header">
        <div className="title-block">
          <h1>Realtime Session Shell</h1>
          <p>
            Connect to OpenAI&apos;s Realtime API, monitor audio activity, and persist
            transcripts directly into Convex.
          </p>
        </div>
        <div className="status-block">
          <span className={`status-indicator status-${status}`}></span>
          <span className="status-label">{statusLabel}</span>
        </div>
        <div className="header-actions">
          {isConnected ? (
            <button className="danger" onClick={handleStop}>
              End session
            </button>
          ) : (
            <button
              className="primary"
              onClick={handleStart}
              disabled={status === "connecting" || status === "requesting-permissions"}
            >
              Start session
            </button>
          )}
          <button
            onClick={() => {
              void refreshDevices();
            }}
            disabled={status === "requesting-permissions"}
          >
            Refresh devices
          </button>
        </div>
      </header>

      {error && status !== "error" ? (
        <div className="alert">{error}</div>
      ) : null}

      <div className="shell-grid">
        <section className="panel controls">
          <h2>Audio devices</h2>
          <DeviceSelect
            label="Microphone"
            devices={inputDevices}
            value={selectedInputDeviceId}
            onChange={selectInputDevice}
            disabled={status === "requesting-permissions"}
          />
          <DeviceSelect
            label="Playback"
            devices={outputDevices}
            value={selectedOutputDeviceId}
            onChange={selectOutputDevice}
            disabled={status === "requesting-permissions"}
          />
          <NoiseReductionToggle
            value={noiseReduction}
            onChange={setNoiseReduction}
            disabled={status === "requesting-permissions" || status === "connecting"}
          />
          <div className="meters">
            <LevelMeter
              label="Microphone"
              level={microphoneLevel}
              active={voiceActivity.user}
              tone="primary"
            />
            <LevelMeter
              label="Assistant audio"
              level={assistantLevel}
              active={voiceActivity.assistant}
              tone="secondary"
            />
          </div>
          <form className="manual-entry" onSubmit={handleManualSubmit}>
            <label>
              Manual text reply
              <textarea
                value={manualMessage}
                onChange={(event) => setManualMessage(event.target.value)}
                placeholder="Type a quick response when you can&apos;t speak"
                disabled={!isConnected}
              />
            </label>
            <button type="submit" disabled={!isConnected || !manualMessage.trim()}>
              Send to assistant
            </button>
          </form>
        </section>

        <section className="panel transcripts">
          <h2>Transcript</h2>
          <TranscriptList
            transcripts={transcripts}
            partialAssistantTranscript={partialAssistantTranscript}
            partialUserTranscript={partialUserTranscript}
          />
        </section>

        <section className="panel diagnostics">
          <h2>Diagnostics</h2>
          <Diagnostics connectionLog={connectionLog} serverEvents={serverEvents} />
        </section>
      </div>

      <audio ref={audioRef} className="hidden-audio" />
    </div>
  );
}
