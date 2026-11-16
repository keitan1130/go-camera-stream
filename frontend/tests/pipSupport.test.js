import { canRequestPip } from "../src/util/pipSupport.ts";

import assert from "node:assert/strict";
import test from "node:test";

test("Safari's media support probe does not disable an available PiP API", () => {
  assert.equal(
    canRequestPip(
      {
        webkitSupportsPresentationMode: () => false,
        webkitSetPresentationMode: () => {},
      },
      false,
    ),
    true,
  );
});

test("standard PiP requires both permission and a callable API", () => {
  const video = { requestPictureInPicture: () => {} };
  assert.equal(canRequestPip(video, true), true);
  assert.equal(canRequestPip(video, false), false);
  assert.equal(canRequestPip({}, true), false);
  assert.equal(canRequestPip(null, true), false);
  assert.equal(
    canRequestPip({ webkitSetPresentationMode: undefined }, false),
    false,
  );
});
