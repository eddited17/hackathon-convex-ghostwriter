"use client";

import type { NoiseReductionProfile } from "@/lib/realtimeAudio";

export type DeviceSelectProps = {
  label: string;
  devices: MediaDeviceInfo[];
  value?: string;
  onChange: (deviceId: string) => Promise<void>;
  disabled?: boolean;
};

export function DeviceSelect({
  label,
  devices,
  value,
  onChange,
  disabled,
}: DeviceSelectProps) {
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

export type LevelMeterProps = {
  label: string;
  level: number;
  active: boolean;
  tone: "primary" | "secondary";
};

export function LevelMeter({ label, level, active, tone }: LevelMeterProps) {
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

export function LevelRing({
  label,
  level,
  tone,
  mode = "value",
  size = "standard",
}: {
  label: string;
  level: number;
  tone: "primary" | "secondary";
  mode?: "value" | "label";
  size?: "standard" | "compact";
}) {
  const percent = Math.min(1, Math.max(0, level)) * 100;
  const gradient = `conic-gradient(var(--level-${tone}) ${percent}%, var(--level-track) ${percent}% 100%)`;
  const centerText = mode === "value" ? Math.round(percent).toString() : label.slice(0, 2).toUpperCase();
  const gaugeSize = size === "compact" ? 56 : 64;
  return (
    <div className={`level-ring level-${tone}`}>
      <div
        className="level-ring-gauge"
        style={{ background: gradient, width: gaugeSize, height: gaugeSize }}
      >
        <span>{centerText}</span>
      </div>
      <p>{label}</p>
    </div>
  );
}

export type NoiseReductionToggleProps = {
  value: NoiseReductionProfile;
  options: { value: NoiseReductionProfile; label: string; description: string }[];
  onChange: (profile: NoiseReductionProfile) => void;
  disabled?: boolean;
};

export function NoiseReductionToggle({
  value,
  options,
  onChange,
  disabled,
}: NoiseReductionToggleProps) {
  return (
    <fieldset className="noise-toggle" disabled={disabled}>
      <legend>Noise reduction</legend>
      {options.map((option) => (
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
