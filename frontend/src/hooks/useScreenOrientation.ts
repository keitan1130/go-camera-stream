import { useEffect, useRef } from "react";

import {
  getDisplayOrientation,
  isIOSDevice,
  resolveScreenCorrection,
} from "../util/displayOrientation";
import { getScreenEncoding } from "../util/screenQuality";

import type { RefObject } from "react";
import type {
  ScreenRotation,
  VideoPresentation,
} from "../util/videoPresentation";

interface UseScreenOrientationParams {
  enabled: boolean;
  streamRef: RefObject<MediaStream | null>;
  shortEdge: number;
  frameRate: number;
  rotationOverride: ScreenRotation;
  onOutput: (
    output: MediaStream,
    original: MediaStream,
    presentation: VideoPresentation,
  ) => Promise<void>;
  onError: (message: string) => void;
}

export default function useScreenOrientation({
  enabled,
  streamRef,
  shortEdge,
  frameRate,
  rotationOverride,
  onOutput,
  onError,
}: UseScreenOrientationParams) {
  const basisRef = useRef<{
    stream: MediaStream | null;
    angle?: number;
    portrait?: boolean;
  }>({ stream: null });
  useEffect(() => {
    if (!enabled || (!isIOSDevice() && rotationOverride === "auto")) return;
    const original = streamRef.current;
    if (!original) return;
    // Keep the unmodified source separately: the visible preview can become the
    // corrected output, and must never be drawn back into itself.
    const input = document.createElement("video");
    input.muted = true;
    input.playsInline = true;
    input.autoplay = true;
    input.style.cssText =
      "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    input.setAttribute("aria-hidden", "true");
    input.srcObject = original;
    document.body.appendChild(input);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
    if (!context) {
      input.srcObject = null;
      input.remove();
      return;
    }
    let stopped = false;
    let rotation = 0;
    if (basisRef.current.stream !== original)
      basisRef.current = { stream: original };
    let previousPresentation = "";
    let output: MediaStream | null = null;
    let timer = 0;
    let frameCallback = 0;
    let animationFrame = 0;
    let lastFrame = -Infinity;
    const report = (error: unknown) => {
      if (!stopped)
        onError(
          `Screen: ${error instanceof Error ? error.message : "Rotation failed"}`,
        );
    };
    const cancelFrame = () => {
      if (frameCallback) input.cancelVideoFrameCallback(frameCallback);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      frameCallback = animationFrame = 0;
    };
    const draw = (now: number) => {
      if (stopped || !rotation) return;
      if (now - lastFrame >= 1000 / frameRate - 1 && input.readyState >= 2) {
        lastFrame = now;
        const swap = rotation % 180 !== 0;
        const outputWidth = swap ? input.videoHeight : input.videoWidth;
        const outputHeight = swap ? input.videoWidth : input.videoHeight;
        const scale = getScreenEncoding(outputWidth, outputHeight, {
          shortEdge,
          frameRate,
        }).scaleResolutionDownBy;
        const width = Math.max(2, Math.floor(outputWidth / scale / 2) * 2);
        const height = Math.max(2, Math.floor(outputHeight / scale / 2) * 2);
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
      }
    };
    const scheduleFrame = () => {
      if (stopped || !rotation) return;
      if (typeof input.requestVideoFrameCallback === "function") {
        frameCallback = input.requestVideoFrameCallback((now) => {
          draw(now);
          scheduleFrame();
        });
      } else {
        animationFrame = requestAnimationFrame((now) => {
          draw(now);
          scheduleFrame();
        });
      }
    };
    const update = () => {
      if (stopped || !input.videoWidth || !input.videoHeight) return;
      const orientation = getDisplayOrientation();
      const next =
        rotationOverride === "auto"
          ? resolveScreenCorrection(
              input.videoWidth,
              input.videoHeight,
              orientation,
              basisRef.current,
            )
          : rotationOverride;
      const presentation: VideoPresentation = {
        rotation: next,
        auto: rotationOverride === "auto",
        portrait: orientation.portrait,
      };
      const serialized = JSON.stringify(presentation);
      if (next === rotation) {
        if (serialized !== previousPresentation) {
          previousPresentation = serialized;
          void onOutput(output ?? original, original, presentation).catch(
            report,
          );
        }
        return;
      }
      previousPresentation = serialized;
      rotation = next;
      cancelFrame();
      if (!rotation) {
        void onOutput(original, original, presentation).catch(report);
        output?.getTracks().forEach((track) => {
          track.stop();
        });
        output = null;
        return;
      }
      lastFrame = -Infinity;
      draw(performance.now());
      if (!output) {
        output = canvas.captureStream(frameRate);
      }
      void onOutput(output, original, presentation).catch(report);
      scheduleFrame();
    };
    const onOrientation = () => {
      clearTimeout(timer);
      // Safari can update its native stream after the orientation event.
      timer = window.setTimeout(update, 200);
    };
    const onVisibility = () => {
      if (!document.hidden) onOrientation();
    };
    input.addEventListener("loadedmetadata", update);
    input.addEventListener("resize", update);
    screen.orientation?.addEventListener("change", onOrientation);
    window.addEventListener("orientationchange", onOrientation);
    document.addEventListener("visibilitychange", onVisibility);
    void input.play().catch(report);
    return () => {
      stopped = true;
      clearTimeout(timer);
      cancelFrame();
      input.removeEventListener("loadedmetadata", update);
      input.removeEventListener("resize", update);
      screen.orientation?.removeEventListener("change", onOrientation);
      window.removeEventListener("orientationchange", onOrientation);
      document.removeEventListener("visibilitychange", onVisibility);
      if (output) {
        void onOutput(original, original, {
          rotation: 0,
          auto: false,
          portrait: false,
        });
        output.getTracks().forEach((track) => {
          track.stop();
        });
      }
      input.srcObject = null;
      input.remove();
    };
  }, [
    enabled,
    streamRef,
    shortEdge,
    frameRate,
    rotationOverride,
    onOutput,
    onError,
  ]);
}
