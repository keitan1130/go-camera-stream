import { useEffect, useRef } from "react";

import {
  getDisplayOrientation,
  isIOSDevice,
  resolveScreenCorrection,
} from "../util/displayOrientation";
import { DEFAULT_VIDEO_PRESENTATION } from "../util/videoPresentation";

import type { RefObject } from "react";
import type {
  ScreenRotation,
  VideoPresentation,
} from "../util/videoPresentation";

interface UseScreenOrientationParams {
  enabled: boolean;
  streamRef: RefObject<MediaStream | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  captureSettings: MediaTrackSettings | null;
  rotationOverride: ScreenRotation;
  onPresentation: (
    presentation: VideoPresentation,
    original: MediaStream,
  ) => void;
}

export default function useScreenOrientation({
  enabled,
  streamRef,
  videoRef,
  captureSettings,
  rotationOverride,
  onPresentation,
}: UseScreenOrientationParams) {
  const basisRef = useRef<{
    stream: MediaStream | null;
    angle?: number;
    portrait?: boolean;
  }>({ stream: null });
  useEffect(() => {
    if (!enabled) return;
    const original = streamRef.current;
    const track = original?.getVideoTracks()[0];
    if (!original || !track) return;
    if (!isIOSDevice() && rotationOverride === "auto") {
      onPresentation(DEFAULT_VIDEO_PRESENTATION, original);
      return;
    }
    if (basisRef.current.stream !== original)
      basisRef.current = { stream: original };
    const video = videoRef.current;
    let timer = 0;
    const update = () => {
      if (streamRef.current !== original || track.readyState !== "live") return;
      const settings = track.getSettings();
      const playingNative = video?.srcObject === original && !video.paused;
      const width =
        (playingNative ? video.videoWidth : 0) ||
        settings.width ||
        captureSettings?.width ||
        0;
      const height =
        (playingNative ? video.videoHeight : 0) ||
        settings.height ||
        captureSettings?.height ||
        0;
      if (!width || !height) return;
      const orientation = getDisplayOrientation();
      const rotation =
        rotationOverride === "auto"
          ? resolveScreenCorrection(
              width,
              height,
              orientation,
              basisRef.current,
            )
          : rotationOverride;
      onPresentation(
        {
          rotation,
          auto: rotationOverride === "auto",
          portrait: orientation.portrait,
        },
        original,
      );
    };
    const onOrientation = () => {
      clearTimeout(timer);
      timer = window.setTimeout(update, 200);
    };
    const onVisibility = () => {
      if (!document.hidden) onOrientation();
    };
    video?.addEventListener("loadedmetadata", update);
    video?.addEventListener("resize", update);
    track.addEventListener("configurationchange", update);
    track.addEventListener("unmute", update);
    screen.orientation?.addEventListener("change", onOrientation);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("visibilitychange", onVisibility);
    update();
    return () => {
      clearTimeout(timer);
      video?.removeEventListener("loadedmetadata", update);
      video?.removeEventListener("resize", update);
      track.removeEventListener("configurationchange", update);
      track.removeEventListener("unmute", update);
      screen.orientation?.removeEventListener("change", onOrientation);
      window.removeEventListener("orientationchange", onOrientation);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [
    enabled,
    streamRef,
    videoRef,
    captureSettings,
    rotationOverride,
    onPresentation,
  ]);
}
