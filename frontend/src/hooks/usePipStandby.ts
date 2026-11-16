import { useEffect, useRef, useState } from "react";

import { createPipPreview } from "../util/pipPreview";

import type { RefObject } from "react";
import type { ScreenQuality } from "../util/screenQuality";
import type { VideoPresentation } from "../util/videoPresentation";

export type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

interface PipStandbyOptions {
  enabled: boolean;
  streamRef: RefObject<MediaStream | null>;
  presentationRef: RefObject<VideoPresentation>;
  qualityRef: RefObject<ScreenQuality>;
  onActive: (active: boolean) => void;
  onError: (error: string) => void;
}

// Safari must enter PiP directly from the click. Prepare its video beforehand,
// then keep the input paused and the canvas idle until the user enters PiP.
export default function usePipStandby({
  enabled,
  streamRef,
  presentationRef,
  qualityRef,
  onActive,
  onError,
}: PipStandbyOptions) {
  const standbyRef = useRef<{
    video: SafariVideo;
    preview: ReturnType<typeof createPipPreview>;
    ready: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const stream = streamRef.current;
    if (!enabled || !stream) return;
    const video: SafariVideo = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    video.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    const preview = createPipPreview({
      video,
      stream,
      getPresentation: () => presentationRef.current,
      getQuality: () => qualityRef.current,
      canRestore: () => streamRef.current === stream,
      isPreviewVisible: () => false,
      standby: true,
    });
    const entry = { video, preview, ready: false };
    standbyRef.current = entry;
    const update = () => {
      const active =
        document.pictureInPictureElement === video ||
        video.webkitPresentationMode === "picture-in-picture";
      if (!active) preview.deactivate();
      onActive(active);
    };
    video.addEventListener("enterpictureinpicture", update);
    video.addEventListener("leavepictureinpicture", update);
    video.addEventListener("webkitpresentationmodechanged", update);
    void preview.ready.then(
      () => {
        if (standbyRef.current !== entry) return;
        entry.ready = true;
        setReady(true);
      },
      (error: unknown) => {
        if (standbyRef.current !== entry) return;
        preview.dispose();
        onError(`PiP: ${error instanceof Error ? error.message : "Failed"}`);
      },
    );
    return () => {
      standbyRef.current = null;
      video.removeEventListener("enterpictureinpicture", update);
      video.removeEventListener("leavepictureinpicture", update);
      video.removeEventListener("webkitpresentationmodechanged", update);
      preview.dispose();
      video.pause();
      video.srcObject = null;
      video.remove();
    };
  }, [enabled, streamRef, presentationRef, qualityRef, onActive, onError]);

  return { standbyRef, ready };
}
