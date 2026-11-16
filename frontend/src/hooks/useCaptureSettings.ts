import { useCallback, useEffect, useState } from "react";

import type { RefObject } from "react";

export default function useCaptureSettings(
  videoRef: RefObject<HTMLVideoElement | null>,
  streamRef: RefObject<MediaStream | null>,
) {
  const [captureSettings, setCaptureSettings] =
    useState<MediaTrackSettings | null>(null);
  const refreshCaptureSettings = useCallback(() => {
    const video = videoRef.current;
    const output =
      video?.srcObject instanceof MediaStream
        ? video.srcObject
        : streamRef.current;
    const track = output?.getVideoTracks()[0];
    const settings = track?.readyState === "live" ? track.getSettings() : null;
    if (settings && video?.readyState && video.srcObject === output) {
      // Intrinsic video dimensions follow rotation, unlike the requested camera size.
      settings.width = video.videoWidth || settings.width;
      settings.height = video.videoHeight || settings.height;
    }
    setCaptureSettings((previous) =>
      previous?.width === settings?.width &&
      previous?.height === settings?.height &&
      previous?.frameRate === settings?.frameRate
        ? previous
        : settings,
    );
  }, [streamRef, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.addEventListener("loadedmetadata", refreshCaptureSettings);
    video.addEventListener("resize", refreshCaptureSettings);
    video.addEventListener("emptied", refreshCaptureSettings);
    return () => {
      video.removeEventListener("loadedmetadata", refreshCaptureSettings);
      video.removeEventListener("resize", refreshCaptureSettings);
      video.removeEventListener("emptied", refreshCaptureSettings);
    };
  }, [videoRef, refreshCaptureSettings]);

  return { captureSettings, refreshCaptureSettings };
}
