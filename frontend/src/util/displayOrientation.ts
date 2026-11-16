export function isIOSDevice() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function getDisplayOrientation() {
  const legacyAngle = (window as Window & { orientation?: number }).orientation;
  const angle =
    screen.orientation?.angle ??
    legacyAngle ??
    (screen.width > screen.height ? 90 : 0);
  const type = screen.orientation?.type;
  return {
    angle: ((angle % 360) + 360) % 360,
    portrait: type
      ? type.startsWith("portrait")
      : legacyAngle !== undefined
        ? Math.abs(legacyAngle) % 180 === 0
        : screen.width <= screen.height,
  };
}

export function getScreenCorrection(
  width: number,
  height: number,
  orientation: { angle: number; portrait: boolean },
  nativeAngle: number,
) {
  if (
    !width ||
    !height ||
    width === height ||
    width < height === orientation.portrait
  )
    return 0;
  const delta = (((nativeAngle - orientation.angle) % 360) + 360) % 360;
  return delta === 90 || delta === 270 ? delta : 0;
}
