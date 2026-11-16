import type { Dispatch, SetStateAction } from "react";
import type { ASPECT_RATIOS, RESOLUTIONS, WebRTCStats } from "../../constants";

type CaptureSource = "camera" | "screen" | "idle";
type Resolution = (typeof RESOLUTIONS)[number];
type AspectRatio = (typeof ASPECT_RATIOS)[number];
type Setter<T> = Dispatch<SetStateAction<T>>;

export interface CameraStatsProps {
  streamId: string;
  connectionState: string;
  iceState: string;
  source: CaptureSource;
  trackMuted: boolean;
  viewerStats: WebRTCStats | null;
  localCodec: string;
  currentWidth: number;
  selectedResolution: Resolution;
  selectedFps: number;
}

export interface CameraSettingsProps {
  source: CaptureSource;
  isSwitching: boolean;
  videoDevices: MediaDeviceInfo[];
  selectedDeviceId: string;
  setSelectedDeviceId: Setter<string>;
  selectedResolution: Resolution;
  setSelectedResolution: Setter<Resolution>;
  selectedRatio: AspectRatio;
  setSelectedRatio: Setter<AspectRatio>;
  selectedFps: number;
  setSelectedFps: Setter<number>;
  selectedDegradation: string;
  setSelectedDegradation: Setter<string>;
}

export interface CameraControlsProps {
  source: CaptureSource;
  isSwitching: boolean;
  screenSupported: boolean;
  pipSupported: boolean;
  previewReady: boolean;
  pipActive: boolean;
  showLeftUI: boolean;
  showPreview: boolean;
  isVideoMuted: boolean;
  onCamera: () => void;
  onScreenShare: () => Promise<void>;
  onPip: () => Promise<void>;
  onToggleUI: () => void;
  onTogglePreview: () => void;
  onToggleMute: () => void;
}
