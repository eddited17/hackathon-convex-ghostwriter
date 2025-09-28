"use client";

import { useCallback, useMemo } from "react";

import { DeviceSelect, LevelRing, NoiseReductionToggle } from "./SessionControls";
import { useRealtimeSessionContext } from "./RealtimeSessionProvider";
import { NOISE_REDUCTION_OPTIONS } from "./useRealtimeSession";

export default function SessionControlBar() {
  const {
    status,
    statusMessage,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectInputDevice,
    selectedOutputDeviceId,
    selectOutputDevice,
    noiseReduction,
    setNoiseReduction,
    language,
    setLanguage,
    languageOptions,
    microphoneLevel,
    assistantLevel,
  } = useRealtimeSessionContext();

  const statusLabel = useMemo(() => {
    const base = status.charAt(0).toUpperCase() + status.slice(1);
    return base;
  }, [status]);

  const summaryHint = useMemo(() => {
    if (statusMessage) return statusMessage;
    if (status === "connected") return "Realtime session active";
    if (status === "connecting") return "Connecting…";
    if (status === "requesting-permissions") return "Requesting microphone access";
    return "Ready to connect";
  }, [status, statusMessage]);

  const languageLabel = useMemo(() => {
    const option = languageOptions.find((entry) => entry.value === language);
    return option?.label ?? language;
  }, [language, languageOptions]);

  const noiseLabel = useMemo(() => {
    switch (noiseReduction) {
      case "near_field":
        return "Near-field";
      case "far_field":
        return "Far-field";
      default:
        return "Model default";
    }
  }, [noiseReduction]);

  const summarizeDevice = useCallback((deviceId?: string) => {
    if (!deviceId) return "Auto";
    const source = [...inputDevices, ...outputDevices].find(
      (device) => device.deviceId === deviceId,
    );
    if (!source) return "Custom";
    const label = source.label || deviceId;
    return label.length > 24 ? `${label.slice(0, 21)}…` : label;
  }, [inputDevices, outputDevices]);

  const inputLabel = summarizeDevice(selectedInputDeviceId);
  const outputLabel = summarizeDevice(selectedOutputDeviceId);

  return (
    <aside className={`session-control-hub status-${status}`}>
      <div className="control-shell">
        <div className="control-summary">
          <div className="summary-status">
            <span className={`status-indicator status-${status}`} />
            <div>
              <span className="status-text">{statusLabel}</span>
              <span className="summary-sub">{summaryHint}</span>
            </div>
          </div>
          <div className="summary-rings">
            <LevelRing
              label="Mic"
              level={microphoneLevel}
              tone="primary"
              size="compact"
            />
            <LevelRing
              label="Assistant"
              level={assistantLevel}
              tone="secondary"
              size="compact"
            />
          </div>
          <dl className="summary-list">
            <div>
              <dt>Input</dt>
              <dd>{inputLabel}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{outputLabel}</dd>
            </div>
            <div>
              <dt>Noise</dt>
              <dd>{noiseLabel}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{languageLabel}</dd>
            </div>
          </dl>
        </div>

        <div className="control-details">
          <div className="control-row">
            <DeviceSelect
              label="Input"
              devices={inputDevices}
              value={selectedInputDeviceId}
              onChange={selectInputDevice}
            />
            <DeviceSelect
              label="Output"
              devices={outputDevices}
              value={selectedOutputDeviceId}
              onChange={selectOutputDevice}
            />
          </div>
          <div className="control-row">
            <NoiseReductionToggle
              value={noiseReduction}
              options={NOISE_REDUCTION_OPTIONS}
              onChange={setNoiseReduction}
            />
          </div>
          <label className="language-select detailed">
            <span>Response language</span>
            <select
              value={language}
              onChange={(event) => {
                void setLanguage(event.target.value);
              }}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </aside>
  );
}
