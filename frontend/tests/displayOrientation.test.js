import { DEFAULT_FPS, DEFAULT_RESOLUTION } from "../src/constants.ts";
import { getScreenCorrection } from "../src/util/displayOrientation.ts";

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
    getScreenCorrection(1280, 720, { angle: 90, portrait: false }, 0),
    0,
  );
  assert.equal(
    getScreenCorrection(720, 1280, { angle: 0, portrait: true }, 90),
    0,
  );
  assert.equal(
    getScreenCorrection(1280, 720, { angle: 0, portrait: true }, 90),
    90,
  );
});
