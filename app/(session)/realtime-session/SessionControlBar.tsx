"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  DeviceSelect,
  LevelRing,
  NoiseReductionToggle,
  TurnDetectionToggle,
} from "./SessionControls";
import { useRealtimeSessionContext } from "./RealtimeSessionProvider";
import { NOISE_REDUCTION_OPTIONS, TURN_DETECTION_OPTIONS } from "./useRealtimeSession";

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  "requesting-permissions": "Requesting permissions",
  connecting: "Connecting",
  connected: "Connected",
  ended: "Ended",
  error: "Error",
};

const MODE_LABELS: Record<string, string> = {
  intake: "Intake",
  blueprint: "Blueprint",
  ghostwriting: "Ghostwriting",
};

export default function SessionControlBar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const controlRef = useRef<HTMLElement>(null);

  const {
    status,
    isConnected,
    startSession,
    stopSession,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectInputDevice,
    selectedOutputDeviceId,
    selectOutputDevice,
    noiseReduction,
    setNoiseReduction,
    turnDetection,
    turnDetectionPreset,
    setTurnDetectionPreset,
    language,
    setLanguage,
    languageOptions,
    microphoneLevel,
    assistantLevel,
    isMuted,
    toggleMute,
    instructionContext,
  } = useRealtimeSessionContext();

  const modeLabel = useMemo(() => {
    return MODE_LABELS[instructionContext.mode] ?? instructionContext.mode;
  }, [instructionContext.mode]);

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

  const turnDetectionLabel = useMemo(() => {
    const option = TURN_DETECTION_OPTIONS.find(
      (entry) => entry.value === turnDetectionPreset,
    );
    if (option) {
      return option.label;
    }
    if (turnDetection.type === "semantic_vad") {
      const mode = turnDetection.eagerness ?? "auto";
      return `Semantic (${mode})`;
    }
    return "Silence detection";
  }, [turnDetection, turnDetectionPreset]);

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

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleStart = useCallback(() => {
    void startSession();
  }, [startSession]);

  const handleStop = useCallback(() => {
    void stopSession("Session ended by user");
  }, [stopSession]);

  // Button styling logic
  const isConnecting = status === "connecting" || status === "requesting-permissions";
  const startButtonClass = isConnected
    ? "session-action-btn session-stop-btn"
    : isConnecting
      ? "session-action-btn session-connecting-btn"
      : "session-action-btn session-start-btn";

  const startButtonLabel = isConnected ? "Stop" : isConnecting ? "Connecting" : "Start";

  const muteButtonClass = `session-action-btn session-mute-btn ${
    !isConnected ? "disabled" : isMuted ? "active" : ""
  }`;

  // Click outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isExpanded &&
        controlRef.current &&
        !controlRef.current.contains(event.target as Node)
      ) {
        setIsExpanded(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  return (
    <aside ref={controlRef} className={`session-control-hub ${isExpanded ? "expanded" : "collapsed"} status-${status}`}>
      <div className="control-shell">
        {/* Collapsed view - minimal */}
        <div className="control-collapsed">
          <div className="control-buttons-vertical">
            <button
              className={startButtonClass}
              onClick={isConnected ? handleStop : handleStart}
              disabled={isConnecting}
              title={startButtonLabel}
              aria-label={startButtonLabel}
            >
              {isConnected ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="4" y="4" width="8" height="8" />
                </svg>
              ) : isConnecting ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="connecting-spinner">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="9.42 31.42" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 2 L4 14 L13 8 Z" />
                </svg>
              )}
            </button>
            <button
              className={muteButtonClass}
              onClick={toggleMute}
              disabled={!isConnected}
              title={isMuted ? "Unmute" : "Mute"}
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {isMuted ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1 C 6.5 1 5.5 2 5.5 3.5 L 5.5 8 C 5.5 9.5 6.5 10.5 8 10.5 C 9.5 10.5 10.5 9.5 10.5 8 L 10.5 3.5 C 10.5 2 9.5 1 8 1 Z M 8 12 C 5.8 12 4 10.2 4 8 L 2.5 8 C 2.5 10.8 4.7 13.1 7.2 13.4 L 7.2 15 L 8.8 15 L 8.8 13.4 C 11.3 13.1 13.5 10.8 13.5 8 L 12 8 C 12 10.2 10.2 12 8 12 Z" />
                  <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="2"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1 C 6.5 1 5.5 2 5.5 3.5 L 5.5 8 C 5.5 9.5 6.5 10.5 8 10.5 C 9.5 10.5 10.5 9.5 10.5 8 L 10.5 3.5 C 10.5 2 9.5 1 8 1 Z M 8 12 C 5.8 12 4 10.2 4 8 L 2.5 8 C 2.5 10.8 4.7 13.1 7.2 13.4 L 7.2 15 L 8.8 15 L 8.8 13.4 C 11.3 13.1 13.5 10.8 13.5 8 L 12 8 C 12 10.2 10.2 12 8 12 Z" />
                </svg>
              )}
            </button>
          </div>
          <div className="collapsed-mode-indicator">
            <span className={`collapsed-mode-badge mode-${instructionContext.mode}`}>
              {modeLabel}
            </span>
          </div>
          <dl className="collapsed-device-list">
            <div>
              <dt>In</dt>
              <dd>{inputLabel}</dd>
            </div>
            <div>
              <dt>Out</dt>
              <dd>{outputLabel}</dd>
            </div>
            <div>
              <dt>Lang</dt>
              <dd>{languageLabel}</dd>
            </div>
          </dl>
        </div>

        {/* Expand/collapse button - always visible */}
        <button
          className="control-expand-btn"
          onClick={handleToggleExpand}
          title={isExpanded ? "Collapse settings" : "Expand settings"}
          aria-label={isExpanded ? "Collapse session settings" : "Expand session settings"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d={isExpanded ? "M10 4 L6 8 L10 12" : "M6 4 L10 8 L6 12"} stroke="currentColor" strokeWidth="2" fill="none"/>
          </svg>
        </button>

        {/* Expanded view - full controls */}
        {isExpanded && (
          <div className="control-expanded">
            <div className="control-summary">
              <div className="summary-mode">
                <span className="mode-label">Mode:</span>
                <span className={`mode-value mode-${instructionContext.mode}`}>
                  {modeLabel}
                </span>
              </div>
              <div className="control-buttons-horizontal">
                <button
                  className={startButtonClass}
                  onClick={isConnected ? handleStop : handleStart}
                  disabled={isConnecting}
                >
                  {isConnected ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <rect x="4" y="4" width="8" height="8" />
                      </svg>
                      <span>Stop session</span>
                    </>
                  ) : isConnecting ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className="connecting-spinner">
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" strokeDasharray="9.42 31.42" />
                      </svg>
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4 2 L4 14 L13 8 Z" />
                      </svg>
                      <span>Start session</span>
                    </>
                  )}
                </button>
                <button
                  className={muteButtonClass}
                  onClick={toggleMute}
                  disabled={!isConnected}
                >
                  {isMuted ? (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1 C 6.5 1 5.5 2 5.5 3.5 L 5.5 8 C 5.5 9.5 6.5 10.5 8 10.5 C 9.5 10.5 10.5 9.5 10.5 8 L 10.5 3.5 C 10.5 2 9.5 1 8 1 Z M 8 12 C 5.8 12 4 10.2 4 8 L 2.5 8 C 2.5 10.8 4.7 13.1 7.2 13.4 L 7.2 15 L 8.8 15 L 8.8 13.4 C 11.3 13.1 13.5 10.8 13.5 8 L 12 8 C 12 10.2 10.2 12 8 12 Z" />
                        <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" strokeWidth="2"/>
                      </svg>
                      <span>Unmute</span>
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1 C 6.5 1 5.5 2 5.5 3.5 L 5.5 8 C 5.5 9.5 6.5 10.5 8 10.5 C 9.5 10.5 10.5 9.5 10.5 8 L 10.5 3.5 C 10.5 2 9.5 1 8 1 Z M 8 12 C 5.8 12 4 10.2 4 8 L 2.5 8 C 2.5 10.8 4.7 13.1 7.2 13.4 L 7.2 15 L 8.8 15 L 8.8 13.4 C 11.3 13.1 13.5 10.8 13.5 8 L 12 8 C 12 10.2 10.2 12 8 12 Z" />
                      </svg>
                      <span>Mute</span>
                    </>
                  )}
                </button>
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
                  <dt>Turn detection</dt>
                  <dd>{turnDetectionLabel}</dd>
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
              <div className="control-row">
                <TurnDetectionToggle
                  value={turnDetectionPreset}
                  options={TURN_DETECTION_OPTIONS}
                  onChange={setTurnDetectionPreset}
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
        )}
      </div>
    </aside>
  );
}
