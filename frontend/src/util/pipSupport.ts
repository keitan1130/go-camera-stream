export type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

// webkitSupportsPresentationMode describes the current media state. A false
// result while preparing a stream must not permanently disable the control.
export function canRequestPip(
  video: SafariVideo | null,
  standardEnabled: boolean,
): boolean {
  return Boolean(
    video &&
      ((standardEnabled &&
        typeof video.requestPictureInPicture === "function") ||
        typeof video.webkitSetPresentationMode === "function"),
  );
}
