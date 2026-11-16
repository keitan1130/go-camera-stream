import {
  constrainScreenTrack,
  getScreenEncoding,
} from "../src/util/screenQuality.ts";

import assert from "node:assert/strict";
import test from "node:test";

test("screen scaling preserves portrait, landscape and non-16:9 content", () => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [3840, 2160, 1920, 1080],
    [2160, 3840, 1080, 1920],
    [2560, 1600, 1728, 1080],
    [1600, 2560, 1080, 1728],
    [800, 600, 800, 600],
  ]) {
    const encoding = getScreenEncoding(width, height, {
      shortEdge: 1080,
      frameRate: 30,
    });
    assert.equal(width / encoding.scaleResolutionDownBy, expectedWidth);
    assert.equal(height / encoding.scaleResolutionDownBy, expectedHeight);
    assert.equal(encoding.maxFramerate, 30);
    assert.ok(encoding.maxBitrate <= 24_000_000);
  }
});

test("FPS changes preserve orientation-neutral capture limits", async () => {
  const existing = { width: { max: 1920 }, height: { max: 1920 } };
  let applied;
  const track = {
    contentHint: "",
    getConstraints: () => existing,
    applyConstraints: async (constraints) => {
      applied = constraints;
    },
  };
  await constrainScreenTrack(track, { shortEdge: 720, frameRate: 15 });
  assert.equal(track.contentHint, "detail");
  assert.deepEqual(applied, { ...existing, frameRate: { ideal: 15, max: 15 } });
});
