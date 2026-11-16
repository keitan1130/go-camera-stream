export function isIOSDevice() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function normalizeDisplayOrientation(
  type: OrientationType | undefined,
  angle: number | undefined,
  legacyAngle: number | undefined,
  width: number,
  height: number,
) {
  const portrait = type
    ? type.startsWith("portrait")
    : legacyAngle !== undefined
      ? Math.abs(legacyAngle) % 180 === 0
      : width <= height;
  const canonical =
    type === "portrait-secondary"
      ? 180
      : type === "landscape-secondary"
        ? 270
        : portrait
          ? 0
          : 90;
  // iPad can use landscape as its natural (zero-degree) orientation. Normalize
  // to a portrait reference, preferring Apple's legacy angle when consistent.
  const candidate = legacyAngle ?? angle;
  const normalized =
    candidate === undefined ? canonical : ((candidate % 360) + 360) % 360;
  return {
    portrait,
    angle: (normalized % 180 === 0) === portrait ? normalized : canonical,
  };
}

export function getDisplayOrientation() {
  return normalizeDisplayOrientation(
    screen.orientation?.type,
    screen.orientation?.angle,
    (window as Window & { orientation?: number }).orientation,
    screen.width,
    screen.height,
  );
}

export function getScreenCorrection(
  width: number,
  height: number,
  orientation: { angle: number; portrait: boolean },
  nativeAngle: number,
) {
  if (!width || !height || width === height) return 0;
  const delta = (((nativeAngle - orientation.angle) % 360) + 360) % 360;
  return delta as 0 | 90 | 180 | 270;
}

export interface ScreenOrientationBasis {
  angle?: number;
  portrait?: boolean;
}

export function resolveScreenCorrection(
  width: number,
  height: number,
  orientation: { angle: number; portrait: boolean },
  basis: ScreenOrientationBasis,
) {
  const portrait = width < height;
  const matches = portrait === orientation.portrait;
  if (basis.angle === undefined)
    basis.angle = matches ? orientation.angle : portrait ? 0 : 90;
  else if (basis.portrait !== portrait && matches)
    basis.angle = orientation.angle;
  basis.portrait = portrait;
  return getScreenCorrection(width, height, orientation, basis.angle);
}
