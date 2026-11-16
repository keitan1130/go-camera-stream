import { getScreenEncoding } from "./screenQuality";
import { getEffectiveRotation } from "./videoPresentation";

import type { ScreenQuality } from "./screenQuality";
import type { VideoPresentation } from "./videoPresentation";

interface PipPreviewOptions {
  video: HTMLVideoElement;
  stream: MediaStream;
  getPresentation: () => VideoPresentation;
  getQuality: () => ScreenQuality;
  canRestore: () => boolean;
  isPreviewVisible: () => boolean;
}

export function createPipPreview({
  video,
  stream,
  getPresentation,
  getQuality,
  canRestore,
  isPreviewVisible,
}: PipPreviewOptions) {
  const input = document.createElement("video");
  input.muted = true;
  input.playsInline = true;
  input.setAttribute("aria-hidden", "true");
  input.style.cssText =
    "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  input.srcObject = stream;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
  });
  if (!context) throw new Error("PiP preview is unavailable");
  document.body.appendChild(input);
  let output: MediaStream | null = null;
  let disposed = false;
  let frameCallback = 0;
  let animationFrame = 0;
  let lastFrame = -Infinity;
  let cancelReady: (() => void) | undefined;

  const draw = (now: number) => {
    const quality = getQuality();
    const fps = Math.min(30, quality.frameRate);
    if (disposed || input.readyState < 2 || now - lastFrame < 1000 / fps - 1)
      return;
    lastFrame = now;
    const rotation = getEffectiveRotation(
      getPresentation(),
      input.videoWidth,
      input.videoHeight,
    );
    const swap = rotation % 180 !== 0;
    const nativeWidth = swap ? input.videoHeight : input.videoWidth;
    const nativeHeight = swap ? input.videoWidth : input.videoHeight;
    // PiP is a small preview; its canvas never needs the full sending resolution.
    const scale = getScreenEncoding(nativeWidth, nativeHeight, {
      shortEdge: Math.min(720, quality.shortEdge),
      frameRate: fps,
    }).scaleResolutionDownBy;
    const width = Math.max(2, Math.floor(nativeWidth / scale / 2) * 2);
    const height = Math.max(2, Math.floor(nativeHeight / scale / 2) * 2);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(width / 2, height / 2);
    context.rotate((rotation * Math.PI) / 180);
    const inputWidth = swap ? height : width;
    const inputHeight = swap ? width : height;
    context.drawImage(
      input,
      -inputWidth / 2,
      -inputHeight / 2,
      inputWidth,
      inputHeight,
    );
  };
  const schedule = () => {
    if (disposed) return;
    if (typeof input.requestVideoFrameCallback === "function") {
      frameCallback = input.requestVideoFrameCallback((now) => {
        draw(now);
        schedule();
      });
    } else {
      animationFrame = requestAnimationFrame((now) => {
        draw(now);
        schedule();
      });
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelReady?.();
    if (frameCallback) input.cancelVideoFrameCallback(frameCallback);
    if (animationFrame) cancelAnimationFrame(animationFrame);
    if (output && video.srcObject === output && canRestore()) {
      video.srcObject = stream;
      if (isPreviewVisible()) void video.play().catch(() => {});
      else video.pause();
    }
    output?.getTracks().forEach((track) => {
      track.stop();
    });
    input.pause();
    input.srcObject = null;
    input.remove();
  };
  const waitForPlayback = (element: HTMLVideoElement) =>
    new Promise<void>((resolve, reject) => {
      let playing = false;
      const cleanup = () => {
        clearTimeout(timeout);
        element.removeEventListener("loadeddata", loaded);
        cancelReady = undefined;
      };
      const loaded = () => {
        if (!playing) return;
        cleanup();
        resolve();
      };
      const fail = (error: unknown) => {
        cleanup();
        reject(error);
      };
      const timeout = window.setTimeout(
        () => fail(new Error("PiP preview timed out")),
        5000,
      );
      cancelReady = () =>
        fail(new DOMException("PiP preparation cancelled", "AbortError"));
      element.addEventListener("loadeddata", loaded);
      void element
        .play()
        .then(() => {
          playing = true;
          if (element.readyState >= 2) loaded();
        })
        .catch(fail);
    });
  const ready = (async () => {
    await waitForPlayback(input);
    if (disposed || !canRestore())
      throw new DOMException("PiP preparation cancelled", "AbortError");
    draw(performance.now());
    output = canvas.captureStream(30);
    schedule();
    video.srcObject = output;
    await waitForPlayback(video);
    if (disposed || !canRestore())
      throw new DOMException("PiP preparation cancelled", "AbortError");
  })();
  return { ready, dispose };
}
