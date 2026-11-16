export interface ScreenQuality {
  shortEdge: number;
  frameRate: number;
}

export function getScreenBounds(shortEdge: number, portrait: boolean) {
  const longEdge = Math.round((shortEdge * 16) / 9);
  return portrait
    ? { width: shortEdge, height: longEdge }
    : { width: longEdge, height: shortEdge };
}

export function getScreenEncoding(
  width: number,
  height: number,
  quality: ScreenQuality,
) {
  const bounds = getScreenBounds(quality.shortEdge, width < height);
  const scale = Math.max(1, width / bounds.width, height / bounds.height);
  const pixels = (width / scale) * (height / scale);
  return {
    scaleResolutionDownBy: scale,
    maxFramerate: quality.frameRate,
    maxBitrate: Math.round(
      Math.max(500_000, Math.min(24_000_000, pixels * quality.frameRate * 0.1)),
    ),
  };
}

export async function constrainScreenTrack(
  track: MediaStreamTrack,
  quality: ScreenQuality,
) {
  track.contentHint = "detail";
  await track.applyConstraints({
    // Keep the orientation-neutral acquisition constraints. New width/height
    // constraints can crop a rotated source; scale at the RTP sender instead.
    ...track.getConstraints(),
    frameRate: { ideal: quality.frameRate, max: quality.frameRate },
  });
}
