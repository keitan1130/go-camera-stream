import { RESOLUTIONS, FPS_OPTIONS, ASPECT_RATIOS } from '../../constants';
import type { CameraSettingsProps } from './types';

export default function CameraSettings({
  source, isSwitching, videoDevices, selectedDeviceId, setSelectedDeviceId,
  selectedResolution, setSelectedResolution, selectedRatio, setSelectedRatio,
  selectedFps, setSelectedFps, selectedDegradation, setSelectedDegradation,
}: CameraSettingsProps) {
  return (
    <>
      <div className="interactive-item">
        <span>&gt; Camera: </span>
        <select disabled={source === 'screen' || isSwitching} value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          <option value="">Default</option>
          {videoDevices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Camera (${device.deviceId.substring(0, 4)})`}
            </option>
          ))}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; Resolution: </span>
        <select
          disabled={source === 'screen' || isSwitching}
          value={selectedResolution.label}
          onChange={(e) => {
            const res = RESOLUTIONS.find(r => r.label === e.target.value);
            if (res) setSelectedResolution(res);
          }}
        >
          {RESOLUTIONS.map(res => <option key={res.label} value={res.label}>{res.label}</option>)}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; AspectRatio: </span>
        <select
          disabled={source === 'screen' || isSwitching}
          value={selectedRatio.label}
          onChange={(e) => {
            const ratio = ASPECT_RATIOS.find(r => r.label === e.target.value);
            if (ratio) setSelectedRatio(ratio);
          }}
        >
          {ASPECT_RATIOS.map(ratio => <option key={ratio.label} value={ratio.label}>{ratio.label}</option>)}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; FPS: </span>
        <select disabled={source === 'screen' || isSwitching} value={selectedFps} onChange={(e) => setSelectedFps(Number(e.target.value))}>
          {FPS_OPTIONS.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
        </select>
      </div>

      <div className="interactive-item">
        <span>&gt; Degradation: </span>
        <select value={selectedDegradation} onChange={(e) => setSelectedDegradation(e.target.value)}>
          <option value="maintain-resolution">maintain-resolution</option>
          <option value="maintain-framerate">maintain-framerate</option>
          <option value="balanced">balanced</option>
        </select>
      </div>
    </>
  );
}
