import { DEFAULT_FPS, DEFAULT_RESOLUTION } from "../src/constants.ts";
import {
  getScreenCorrection,
  normalizeDisplayOrientation,
  resolveScreenCorrection,
} from "../src/util/displayOrientation.ts";
import { getEffectiveRotation } from "../src/util/videoPresentation.ts";

import assert from "node:assert/strict";
import test from "node:test";

test("camera and screen start at 1080p and 30fps", () => {
  assert.equal(DEFAULT_RESOLUTION.height, 1080);
  assert.equal(DEFAULT_FPS, 30);
});

test("fixed portrait capture is corrected in both landscape directions", () => {
  assert.equal(
    getScreenCorrection(720, 1280, { angle: 90, portrait: false }, 0),
    270,
  );
  assert.equal(
    getScreenCorrection(720, 1280, { angle: 270, portrait: false }, 0),
    90,
  );
});

test("native orientation changes never receive a second rotation", () => {
  assert.equal(
    getScreenCorrection(1280, 720, { angle: 90, portrait: false }, 90),
    0,
  );
  assert.equal(
    getScreenCorrection(720, 1280, { angle: 0, portrait: true }, 0),
    0,
  );
  assert.equal(
    getScreenCorrection(1280, 720, { angle: 0, portrait: true }, 90),
    90,
  );
});

test("iPad landscape natural orientation is normalized to a portrait reference", () => {
  assert.deepEqual(
    normalizeDisplayOrientation("landscape-primary", 0, undefined, 1366, 1024),
    { angle: 90, portrait: false },
  );
  assert.deepEqual(
    normalizeDisplayOrientation("portrait-primary", 270, undefined, 1024, 1366),
    { angle: 0, portrait: true },
  );
  assert.deepEqual(
    normalizeDisplayOrientation(
      "landscape-secondary",
      180,
      undefined,
      1366,
      1024,
    ),
    { angle: 270, portrait: false },
  );
});

test("left/right and upside-down turns keep the capture baseline", () => {
  const basis = {};
  assert.equal(
    resolveScreenCorrection(720, 1280, { angle: 0, portrait: true }, basis),
    0,
  );
  assert.equal(
    resolveScreenCorrection(720, 1280, { angle: 90, portrait: false }, basis),
    270,
  );
  assert.equal(
    resolveScreenCorrection(720, 1280, { angle: 270, portrait: false }, basis),
    90,
  );
  assert.equal(
    resolveScreenCorrection(720, 1280, { angle: 180, portrait: true }, basis),
    180,
  );
  assert.equal(
    resolveScreenCorrection(1280, 720, { angle: 90, portrait: false }, basis),
    0,
  );
  assert.equal(
    resolveScreenCorrection(1280, 720, { angle: 270, portrait: false }, basis),
    180,
  );
  assert.equal(
    resolveScreenCorrection(720, 1280, { angle: 0, portrait: true }, basis),
    0,
  );
});

test("CSS and PiP share the same native-rotation and manual-rotation policy", () => {
  const auto = { rotation: 270, auto: true, portrait: false };
  assert.equal(getEffectiveRotation(auto, 720, 1280), 270);
  assert.equal(getEffectiveRotation(auto, 1280, 720), 0);
  assert.equal(getEffectiveRotation({ ...auto, auto: false }, 1280, 720), 270);
  assert.equal(
    getEffectiveRotation({ ...auto, rotation: 180 }, 1280, 720),
    180,
  );
});
