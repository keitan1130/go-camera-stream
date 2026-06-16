export const RESOLUTIONS = [
  { label: '4K', height: 2160 },
  { label: '1440p', height: 1440 },
  { label: '1080p', height: 1080 },
  { label: '720p', height: 720 },
  { label: '480p', height: 480 },
  { label: '360p', height: 360 },
  { label: '240p', height: 240 },
  { label: '144p', height: 144 },
];

export const ASPECT_RATIOS = [
  { label: '16:9', widthRatio: 16, heightRatio: 9 },
  { label: '4:3', widthRatio: 4, heightRatio: 3 },
  { label: '1:1', widthRatio: 1, heightRatio: 1 },
];

export const FPS_OPTIONS = [60, 30, 24, 15, 10, 5];

export const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export interface WebRTCStats {
  currentRoundTripTime?: number;
  bytesReceived?: number;
  bitrate?: number;
  packetsLost?: number;
  jitter?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  framesDropped?: number;
  mimeType?: string;
}
