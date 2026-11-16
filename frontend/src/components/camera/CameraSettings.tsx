import { ASPECT_RATIOS, FPS_OPTIONS, RESOLUTIONS } from "../../constants";

import type { ScreenRotation } from "../../util/videoPresentation";
import type { CameraSettingsProps } from "./types";

export default function CameraSettings({
  source,
  isSwitching,
  videoDevices,
  selectedDeviceId,
  setSelectedDeviceId,
  selectedResolution,
  setSelectedResolution,
  selectedRatio,
  setSelectedRatio,
  screenRotation,
  setScreenRotation,
  selectedFps,
  setSelectedFps,
  selectedDegradation,
  setSelectedDegradation,
}: CameraSettingsProps) {
  return (
    <>
      <div className="interactive-item">
        <span>&gt; Camera: </span>
        <select
          aria-label="Camera"
          disabled={source === "screen" || isSwitching}
          value={selectedDeviceId}
          onChange={(e) => setSelectedDeviceId(e.target.value)}
        >
          <option value="">Default</option>
          {videoDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera (${device.deviceId.substring(0, 4)})`}
            </option>
          ))}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; Resolution: </span>
        <select
          aria-label="Resolution"
          disabled={isSwitching}
          value={selectedResolution.label}
          onChange={(e) => {
            const res = RESOLUTIONS.find((r) => r.label === e.target.value);
            if (res) setSelectedResolution(res);
          }}
        >
          {RESOLUTIONS.map((res) => (
            <option key={res.label} value={res.label}>
              {res.label}
            </option>
          ))}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; AspectRatio: </span>
        <select
          aria-label="Aspect ratio"
          disabled={source === "screen" || isSwitching}
          value={source === "screen" ? "auto" : selectedRatio.label}
          onChange={(e) => {
            const ratio = ASPECT_RATIOS.find((r) => r.label === e.target.value);
            if (ratio) setSelectedRatio(ratio);
          }}
        >
          {source === "screen" && <option value="auto">Auto</option>}
          {ASPECT_RATIOS.map((ratio) => (
            <option key={ratio.label} value={ratio.label}>
              {ratio.label}
            </option>
          ))}
        </select>
      </div>

      {source === "screen" && (
        <div className="interactive-item">
          <span>&gt; Rotation: </span>
          <select
            aria-label="Rotation"
            value={String(screenRotation)}
            onChange={(event) =>
              setScreenRotation(
                event.target.value === "auto"
                  ? "auto"
                  : (Number(event.target.value) as ScreenRotation),
              )
            }
          >
            <option value="auto">Auto</option>
            {[0, 90, 180, 270].map((angle) => (
              <option key={angle} value={angle}>
                {angle}°
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="interactive-item">
        <span>&gt; FPS: </span>
        <select
          aria-label="FPS"
          disabled={isSwitching}
          value={selectedFps}
          onChange={(e) => setSelectedFps(Number(e.target.value))}
        >
          {FPS_OPTIONS.map((fps) => (
            <option key={fps} value={fps}>
              {fps} fps
            </option>
          ))}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; Degradation: </span>
        <select
          aria-label="Degradation"
          value={selectedDegradation}
          onChange={(e) => setSelectedDegradation(e.target.value)}
        >
          <option value="maintain-resolution">maintain-resolution</option>
          <option value="maintain-framerate">maintain-framerate</option>
          <option value="balanced">balanced</option>
        </select>
      </div>
    </>
  );
}
