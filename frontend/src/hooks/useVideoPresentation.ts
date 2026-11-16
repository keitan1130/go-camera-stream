import { useEffect, useState } from "react";

import type { CSSProperties, RefObject } from "react";
import type { VideoPresentation } from "../util/videoPresentation";

export default function useVideoPresentation(
  videoRef: RefObject<HTMLVideoElement | null>,
  presentation: VideoPresentation,
): CSSProperties {
  const [size, setSize] = useState({
    width: 0,
    height: 0,
    videoWidth: 0,
    videoHeight: 0,
  });
  useEffect(() => {
    const video = videoRef.current;
    const container = video?.parentElement;
    if (!video || !container) return;
    const refresh = () => {
      const next = {
        width: container.clientWidth,
        height: container.clientHeight,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
      setSize((old) =>
        old.width === next.width &&
        old.height === next.height &&
        old.videoWidth === next.videoWidth &&
        old.videoHeight === next.videoHeight
          ? old
          : next,
      );
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(container);
    video.addEventListener("loadedmetadata", refresh);
    video.addEventListener("resize", refresh);
    refresh();
    return () => {
      observer.disconnect();
      video.removeEventListener("loadedmetadata", refresh);
      video.removeEventListener("resize", refresh);
    };
  }, [videoRef]);

  let rotation = presentation.rotation;
  if (
    presentation.auto &&
    rotation % 180 !== 0 &&
    size.videoWidth &&
    size.videoHeight &&
    size.videoWidth < size.videoHeight === presentation.portrait
  )
    rotation = 0;
  if (!rotation || !size.width || !size.height) return {};
  const swap = rotation % 180 !== 0;
  return {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: swap ? size.height : size.width,
    height: swap ? size.width : size.height,
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}
