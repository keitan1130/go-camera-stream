export const RESOLUTIONS = [
  { label: 'FHD (1920x1080)', width: 1920, height: 1080 },
  { label: 'HD (1280x720)', width: 1280, height: 720 },
  { label: 'VGA (640x480)', width: 640, height: 480 },
  { label: 'QVGA (320x240)', width: 320, height: 240 },
];

export const FPS_OPTIONS = [30, 24, 15, 10, 5];

export const rtcConfig = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
