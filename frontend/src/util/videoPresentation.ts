export type VideoRotation = 0 | 90 | 180 | 270;
export type ScreenRotation = "auto" | VideoRotation;

export interface VideoPresentation {
  rotation: VideoRotation;
  auto: boolean;
  portrait: boolean;
}

export const DEFAULT_VIDEO_PRESENTATION: VideoPresentation = {
  rotation: 0,
  auto: false,
  portrait: false,
};

export function isVideoPresentation(
  value: unknown,
): value is VideoPresentation {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<VideoPresentation>;
  return (
    [0, 90, 180, 270].includes(data.rotation as number) &&
    typeof data.auto === "boolean" &&
    typeof data.portrait === "boolean"
  );
}
