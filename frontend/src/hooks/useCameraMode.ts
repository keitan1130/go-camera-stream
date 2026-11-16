import { useCallback, useEffect, useRef, useState } from "react";

import {
  ASPECT_RATIOS,
  DEFAULT_FPS,
  DEFAULT_RESOLUTION,
  FPS_OPTIONS,
  RESOLUTIONS,
  rtcConfig,
  type WebRTCStats,
} from "../constants";
import { createPipPreview } from "../util/pipPreview";
import {
  constrainScreenTrack,
  getScreenBounds,
  getScreenEncoding,
} from "../util/screenQuality";
import { DEFAULT_VIDEO_PRESENTATION } from "../util/videoPresentation";
import useCaptureSettings from "./useCaptureSettings";
import useScreenOrientation from "./useScreenOrientation";
import useVideoPresentation from "./useVideoPresentation";

import type {
  ScreenRotation,
  VideoPresentation,
} from "../util/videoPresentation";

type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

export default function useCameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const streamId =
    new URLSearchParams(window.location.search).get("id") || "default";

  const getSavedState = <T>(key: string, defaultValue: T): T => {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  };

  const [showLeftUI, setShowLeftUI] = useState(() =>
    getSavedState("camera_showLeftUI", true),
  );
  const [showPreview, setShowPreview] = useState(() =>
    getSavedState("camera_showPreview", true),
  );
  const [isVideoMuted, setIsVideoMuted] = useState(() =>
    getSavedState("camera_isVideoMuted", false),
  );

  const [source, setSource] = useState<"camera" | "screen" | "idle">("idle");
  const [captureMode, setCaptureMode] = useState<"camera" | "screen" | "idle">(
    "camera",
  );
  const [cameraRequest, setCameraRequest] = useState(0);
  const [isSwitching, setIsSwitching] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [trackMuted, setTrackMuted] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipPreparing, setPipPreparing] = useState(false);
  const [pipPreviewActive, setPipPreviewActive] = useState(false);
  const pipPreparingRef = useRef(false);
  const pipRequestRef = useRef(0);
  const pipPreviewRef = useRef<ReturnType<typeof createPipPreview> | null>(
    null,
  );
  const previewVisibleRef = useRef(showPreview);
  const [pipSupported, setPipSupported] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const captureRequestRef = useRef(0);

  const screenSupported =
    typeof navigator.mediaDevices?.getDisplayMedia === "function";

  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [viewerStats, setViewerStats] = useState<WebRTCStats | null>(null);
  const [localCodec, setLocalCodec] = useState("---");

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() =>
    getSavedState("camera_deviceId", ""),
  );
  const [selectedResolution, setSelectedResolution] = useState(() => {
    const savedLabel = getSavedState(
      "camera_resolution",
      DEFAULT_RESOLUTION.label,
    );
    return (
      RESOLUTIONS.find((r) => r.label === savedLabel) || DEFAULT_RESOLUTION
    );
  });
  const [selectedRatio, setSelectedRatio] = useState(() => {
    const savedLabel = getSavedState("camera_ratio", ASPECT_RATIOS[0].label);
    return (
      ASPECT_RATIOS.find((r) => r.label === savedLabel) || ASPECT_RATIOS[0]
    );
  });
  const [selectedFps, setSelectedFps] = useState(() => {
    const saved = getSavedState("camera_fps", DEFAULT_FPS);
    return FPS_OPTIONS.includes(saved) ? saved : DEFAULT_FPS;
  });

  const [screenResolution, setScreenResolution] = useState(() => {
    const saved = getSavedState("screen_resolution", DEFAULT_RESOLUTION.label);
    return RESOLUTIONS.find((r) => r.label === saved) || DEFAULT_RESOLUTION;
  });
  const [screenFps, setScreenFps] = useState(() => {
    const saved = getSavedState("screen_fps", DEFAULT_FPS);
    return FPS_OPTIONS.includes(saved) ? saved : DEFAULT_FPS;
  });

  const [screenRotation, setScreenRotation] = useState<ScreenRotation>(() => {
    const saved = getSavedState<ScreenRotation>("screen_rotation", "auto");
    return saved === "auto" || [0, 90, 180, 270].includes(saved)
      ? saved
      : "auto";
  });
  const presentationRef = useRef<VideoPresentation>(DEFAULT_VIDEO_PRESENTATION);
  const [presentation, setPresentation] = useState(DEFAULT_VIDEO_PRESENTATION);
  const previewStyle = useVideoPresentation(
    videoRef,
    pipPreviewActive ? DEFAULT_VIDEO_PRESENTATION : presentation,
  );
  const sendPresentation = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          role: "camera",
          type: "presentation",
          presentation: presentationRef.current,
        }),
      );
    }
  }, []);

  const [selectedDegradation, setSelectedDegradation] = useState<string>(() =>
    getSavedState("camera_degradation", "maintain-resolution"),
  );

  const isVideoMutedRef = useRef(isVideoMuted);
  useEffect(() => {
    isVideoMutedRef.current = isVideoMuted;
  }, [isVideoMuted]);

  const streamRef = useRef<MediaStream | null>(null);
  const rtcTrackRef = useRef<MediaStreamTrack | null>(null);
  const streamKindRef = useRef<"camera" | "screen">("camera");
  const { captureSettings, refreshCaptureSettings } = useCaptureSettings(
    videoRef,
    streamRef,
  );
  const qualityRef = useRef({
    shortEdge: screenResolution.height,
    frameRate: screenFps,
    cameraFps: selectedFps,
    degradation: selectedDegradation,
  });
  const senderQueueRef = useRef(Promise.resolve());
  const screenQueueRef = useRef(Promise.resolve());

  const configureSender = useCallback((sender: RTCRtpSender) => {
    const update = async () => {
      if (sender.track?.readyState !== "live") return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      const quality = qualityRef.current;
      params.degradationPreference =
        quality.degradation as RTCDegradationPreference;
      if (streamKindRef.current === "screen") {
        const { width = 1, height = 1 } = sender.track.getSettings();
        Object.assign(
          params.encodings[0],
          getScreenEncoding(width, height, quality),
        );
      } else {
        // Restore the camera profile after leaving screen sharing.
        Object.assign(params.encodings[0], {
          maxBitrate: 300_000_000,
          maxFramerate: quality.cameraFps,
          scaleResolutionDownBy: 1,
        });
      }
      try {
        await sender.setParameters(params);
      } catch {
        // Some Safari versions do not support encoder scaling. Capture constraints
        // still bound the size; keep the bitrate/FPS limits where supported.
        const fallback = sender.getParameters();
        if (!fallback.encodings?.length) return;
        fallback.encodings[0].maxBitrate = params.encodings[0].maxBitrate;
        fallback.encodings[0].maxFramerate = params.encodings[0].maxFramerate;
        await sender.setParameters(fallback);
      }
    };
    senderQueueRef.current = senderQueueRef.current
      .then(update)
      .catch((error) => {
        if (pcRef.current?.getSenders().includes(sender)) {
          setCaptureError(
            `Video: ${error instanceof Error ? error.message : "Failed"}`,
          );
        }
      });
    return senderQueueRef.current;
  }, []);

  const restorePreview = useCallback(() => {
    const pipPreview = pipPreviewRef.current;
    if (!pipPreview) return;
    pipPreviewRef.current = null;
    pipPreview.dispose();
    setPipPreviewActive(false);
  }, []);

  const closePip = useCallback(() => {
    ++pipRequestRef.current;
    pipPreparingRef.current = false;
    setPipPreparing(false);
    const video = videoRef.current as SafariVideo | null;
    if (video && document.pictureInPictureElement === video) {
      void document.exitPictureInPicture().catch(() => {});
    } else if (video?.webkitPresentationMode === "picture-in-picture") {
      video.webkitSetPresentationMode?.("inline");
    }
    restorePreview();
    setPipActive(false);
  }, [restorePreview]);

  useEffect(() => {
    previewVisibleRef.current = showPreview;
    const video = videoRef.current;
    if (!video || source === "idle") return;
    if (showPreview || pipActive || pipPreparing)
      void video.play().catch(() => {});
    else video.pause();
  }, [showPreview, source, pipActive, pipPreparing]);

  useEffect(() => {
    if (!pipActive && !pipPreparing) restorePreview();
  }, [pipActive, pipPreparing, restorePreview]);

  useEffect(() => closePip, [closePip]);

  const currentWidth = Math.round(
    (selectedResolution.height * selectedRatio.widthRatio) /
      selectedRatio.heightRatio,
  );

  useEffect(() => {
    localStorage.setItem("screen_rotation", JSON.stringify(screenRotation));
  }, [screenRotation]);

  useEffect(() => {
    localStorage.setItem(
      "screen_resolution",
      JSON.stringify(screenResolution.label),
    );
    localStorage.setItem("screen_fps", JSON.stringify(screenFps));
  }, [screenResolution, screenFps]);

  useEffect(() => {
    localStorage.setItem("camera_showLeftUI", JSON.stringify(showLeftUI));
    localStorage.setItem("camera_showPreview", JSON.stringify(showPreview));
    localStorage.setItem("camera_isVideoMuted", JSON.stringify(isVideoMuted));
    localStorage.setItem("camera_deviceId", JSON.stringify(selectedDeviceId));
    localStorage.setItem(
      "camera_resolution",
      JSON.stringify(selectedResolution.label),
    );
    localStorage.setItem("camera_ratio", JSON.stringify(selectedRatio.label));
    localStorage.setItem("camera_fps", JSON.stringify(selectedFps));
    localStorage.setItem(
      "camera_degradation",
      JSON.stringify(selectedDegradation),
    );
  }, [
    showLeftUI,
    showPreview,
    isVideoMuted,
    selectedDeviceId,
    selectedResolution,
    selectedRatio,
    selectedFps,
    selectedDegradation,
  ]);

  useEffect(() => {
    qualityRef.current = {
      shortEdge: screenResolution.height,
      frameRate: screenFps,
      cameraFps: selectedFps,
      degradation: selectedDegradation,
    };
    const sender = pcRef.current
      ?.getSenders()
      .find((s) => s.track?.kind === "video");
    if (sender) void configureSender(sender);
  }, [
    screenResolution,
    screenFps,
    selectedFps,
    selectedDegradation,
    configureSender,
  ]);

  useEffect(() => {
    if (source !== "screen" || streamKindRef.current !== "screen") return;
    let cancelled = false;
    const stream = streamRef.current;
    const tracks = [stream?.getVideoTracks()[0], rtcTrackRef.current];
    screenQueueRef.current = screenQueueRef.current
      .then(async () => {
        if (
          cancelled ||
          streamRef.current !== stream ||
          streamKindRef.current !== "screen"
        )
          return;
        const quality = {
          shortEdge: screenResolution.height,
          frameRate: screenFps,
        };
        const results = await Promise.allSettled(
          tracks.map((track) =>
            track?.readyState === "live"
              ? constrainScreenTrack(track, quality)
              : undefined,
          ),
        );
        if (
          cancelled ||
          streamRef.current !== stream ||
          streamKindRef.current !== "screen"
        )
          return;
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          setCaptureError(
            `Screen: ${failure.reason instanceof Error ? failure.reason.message : "Quality update failed"}`,
          );
        } else {
          setCaptureError("");
        }
        const sender = pcRef.current
          ?.getSenders()
          .find((s) => s.track?.kind === "video");
        if (sender) await configureSender(sender);
        refreshCaptureSettings();
      })
      .catch((error) => {
        if (!cancelled)
          setCaptureError(
            `Screen: ${error instanceof Error ? error.message : "Failed"}`,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [
    source,
    screenResolution,
    screenFps,
    configureSender,
    refreshCaptureSettings,
  ]);

  useEffect(() => {
    const sender = pcRef.current
      ?.getSenders()
      .find((s) => s.track?.kind === "video");
    if (source === "screen" && captureSettings && sender)
      void configureSender(sender);
  }, [source, captureSettings, configureSender]);

  useEffect(() => {
    const localStatsInterval = setInterval(async () => {
      refreshCaptureSettings();
      if (pcRef.current && pcRef.current.connectionState === "connected") {
        const stats = await pcRef.current.getStats();
        stats.forEach((report) => {
          if (
            report.type === "outbound-rtp" &&
            report.kind === "video" &&
            report.codecId
          ) {
            const codec = stats.get(report.codecId);
            if (codec) {
              setLocalCodec(codec.mimeType.replace("video/", ""));
            }
          }
        });
      } else {
        setLocalCodec("---");
      }
    }, 2000);

    return () => clearInterval(localStatsInterval);
  }, [refreshCaptureSettings]);

  const createPeerConnectionAndSendOffer = useCallback(async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        setViewerStats(null);
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
    };

    if (rtcTrackRef.current && streamRef.current) {
      const sender = pc.addTrack(rtcTrackRef.current, streamRef.current);
      await configureSender(sender);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            role: "camera",
            type: "candidate",
            candidate: e.candidate,
          }),
        );
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ role: "camera", type: "offer", sdp: offer }),
      );
    }
  }, [configureSender]);

  useEffect(() => {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ role: "camera", type: "join" }));
      sendPresentation();
      createPeerConnectionAndSendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === "camera") return;

      if (msg.type === "join" && msg.role === "viewer") {
        sendPresentation();
        createPeerConnectionAndSendOffer();
      } else if (msg.type === "answer" && pcRef.current) {
        await pcRef.current.setRemoteDescription(msg.sdp);
      } else if (msg.type === "candidate" && pcRef.current) {
        await pcRef.current.addIceCandidate(msg.candidate);
      } else if (msg.type === "stats") {
        setViewerStats(msg.stats);
      }
    };

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, [streamId, createPeerConnectionAndSendOffer, sendPresentation]);

  const installStream = useCallback(
    async (stream: MediaStream, request: number, kind: "camera" | "screen") => {
      const track = stream.getVideoTracks()[0];
      if (
        !track ||
        track.readyState === "ended" ||
        request !== captureRequestRef.current
      ) {
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        return false;
      }

      track.contentHint = kind === "screen" ? "detail" : "motion";
      const clonedTrack = track.clone();
      clonedTrack.contentHint = track.contentHint;
      clonedTrack.enabled = !isVideoMutedRef.current;
      const previousStream = streamRef.current;
      const previousTrack = rtcTrackRef.current;
      const sender = pcRef.current
        ?.getSenders()
        .find((s) => s.track?.kind === "video" || s.track === null);
      try {
        if (sender) await sender.replaceTrack(clonedTrack);
        if (
          request !== captureRequestRef.current ||
          stream.getVideoTracks()[0]?.readyState === "ended"
        ) {
          if (sender) await sender.replaceTrack(previousTrack);
          clonedTrack.stop();
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return false;
        }
      } catch (error) {
        // A different capture size/codec can require renegotiation.
        if (
          !(error instanceof DOMException) ||
          error.name !== "InvalidModificationError"
        ) {
          clonedTrack.stop();
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          throw error;
        }
      }

      if (previousStream) closePip();
      streamKindRef.current = kind;
      presentationRef.current = DEFAULT_VIDEO_PRESENTATION;
      setPresentation(DEFAULT_VIDEO_PRESENTATION);
      sendPresentation();
      streamRef.current = stream;
      rtcTrackRef.current = clonedTrack;
      previousStream?.getTracks().forEach((t) => {
        t.stop();
      });
      previousTrack?.stop();
      setTrackMuted(track.muted);
      setPreviewReady(true);
      track.onmute = () => setTrackMuted(true);
      track.onunmute = () => setTrackMuted(false);
      track.onended = () => {
        if (streamRef.current !== stream) return;
        closePip();
        rtcTrackRef.current?.stop();
        stream.getTracks().forEach((t) => {
          t.stop();
        });
        streamRef.current = null;
        rtcTrackRef.current = null;
        setSource("idle");
        setCaptureMode("idle");
        setPreviewReady(false);
        setTrackMuted(false);
        if (videoRef.current) videoRef.current.srcObject = null;
        refreshCaptureSettings();
      };

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Preview playback and RTP transmission have independent lifecycles.
        if (previewVisibleRef.current)
          void videoRef.current.play().catch(() => {});
        else videoRef.current.pause();
      }
      if (pcRef.current && (!sender || sender.track !== clonedTrack)) {
        await createPeerConnectionAndSendOffer();
      } else if (sender) {
        await configureSender(sender);
      }
      return true;
    },
    [
      createPeerConnectionAndSendOffer,
      configureSender,
      refreshCaptureSettings,
      sendPresentation,
      closePip,
    ],
  );

  const updateScreenPresentation = useCallback(
    (next: VideoPresentation, original: MediaStream) => {
      if (streamRef.current !== original || streamKindRef.current !== "screen")
        return;
      const previous = presentationRef.current;
      if (
        previous.rotation === next.rotation &&
        previous.auto === next.auto &&
        previous.portrait === next.portrait
      )
        return;
      presentationRef.current = next;
      setPresentation(next);
      sendPresentation();
    },
    [sendPresentation],
  );

  useScreenOrientation({
    enabled: source === "screen",
    streamRef,
    videoRef,
    captureSettings,
    rotationOverride: screenRotation,
    onPresentation: updateScreenPresentation,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: cameraRequest intentionally restarts capture when retrying the same camera.
  useEffect(() => {
    if (captureMode !== "camera") return;
    const request = ++captureRequestRef.current;
    let cancelled = false;
    async function updateCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: currentWidth, max: currentWidth },
            height: {
              ideal: selectedResolution.height,
              max: selectedResolution.height,
            },
            frameRate: { ideal: selectedFps, max: selectedFps },
            ...(selectedDeviceId
              ? { deviceId: { exact: selectedDeviceId } }
              : { facingMode: { ideal: "environment" } }),
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => {
            t.stop();
          });
          return;
        }
        if (await installStream(stream, request, "camera")) {
          setSource("camera");
          setCaptureError("");
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled)
            setVideoDevices(devices.filter((d) => d.kind === "videoinput"));
        }
      } catch (error) {
        if (!cancelled && request === captureRequestRef.current) {
          setCaptureError(
            `Camera: ${error instanceof Error ? error.message : "Failed"}`,
          );
        }
      }
    }
    void updateCamera();
    return () => {
      cancelled = true;
    };
  }, [
    captureMode,
    cameraRequest,
    selectedDeviceId,
    selectedResolution,
    selectedFps,
    currentWidth,
    installStream,
  ]);

  useEffect(
    () => () => {
      ++captureRequestRef.current;
      streamRef.current?.getTracks().forEach((t) => {
        t.stop();
      });
      rtcTrackRef.current?.stop();
    },
    [],
  );

  const startScreenShare = async () => {
    if (!screenSupported || isSwitching) return;
    const request = ++captureRequestRef.current;
    setIsSwitching(true);
    setCaptureError("");
    try {
      // Keep this call directly in the click handler: browsers require user activation.
      const longEdge = getScreenBounds(screenResolution.height, false).width;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        // Start with symmetric limits so a portrait display isn't forced into
        // landscape bounds. Refine the bounds after reading the actual stream.
        video: {
          width: { max: longEdge },
          height: { max: longEdge },
          frameRate: { ideal: screenFps, max: screenFps },
        },
        audio: false,
      });
      if (await installStream(stream, request, "screen")) {
        setCaptureMode("screen");
        setSource("screen");
      }
    } catch (error) {
      if (request === captureRequestRef.current) {
        setCaptureError(
          `Screen: ${error instanceof Error ? error.message : "Failed"}`,
        );
      }
    } finally {
      if (request === captureRequestRef.current) setIsSwitching(false);
    }
  };

  useEffect(() => {
    const video = videoRef.current as SafariVideo | null;
    if (!video) return;
    const updatePip = () => {
      setPipSupported(
        Boolean(
          (document.pictureInPictureEnabled && video.requestPictureInPicture) ||
            video.webkitSupportsPresentationMode?.("picture-in-picture"),
        ),
      );
      setPipActive(
        document.pictureInPictureElement === video ||
          video.webkitPresentationMode === "picture-in-picture",
      );
    };
    const onReady = () => {
      updatePip();
    };
    updatePip();
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("enterpictureinpicture", updatePip);
    video.addEventListener("leavepictureinpicture", updatePip);
    video.addEventListener("webkitpresentationmodechanged", updatePip);
    return () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("enterpictureinpicture", updatePip);
      video.removeEventListener("leavepictureinpicture", updatePip);
      video.removeEventListener("webkitpresentationmodechanged", updatePip);
    };
  }, []);

  const togglePip = async () => {
    const video = videoRef.current as SafariVideo | null;
    const original = streamRef.current;
    if (!video || !original || pipPreparingRef.current) return;
    if (
      document.pictureInPictureElement === video ||
      video.webkitPresentationMode === "picture-in-picture"
    ) {
      closePip();
      return;
    }
    const request = ++pipRequestRef.current;
    pipPreparingRef.current = true;
    setPipPreparing(true);
    setCaptureError("");
    try {
      if (streamKindRef.current === "screen") {
        const pipPreview = createPipPreview({
          video,
          stream: original,
          getPresentation: () => presentationRef.current,
          getQuality: () => qualityRef.current,
          canRestore: () => streamRef.current === original,
          isPreviewVisible: () => previewVisibleRef.current,
        });
        pipPreviewRef.current = pipPreview;
        await pipPreview.ready;
        if (request !== pipRequestRef.current) return;
        setPipPreviewActive(true);
      } else {
        await video.play();
      }
      if (request !== pipRequestRef.current || streamRef.current !== original)
        return;
      if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (video.webkitSupportsPresentationMode?.("picture-in-picture")) {
        video.webkitSetPresentationMode?.("picture-in-picture");
        if (video.webkitPresentationMode !== "picture-in-picture") {
          await new Promise<void>((resolve, reject) => {
            const check = () => {
              if (video.webkitPresentationMode === "picture-in-picture") {
                clearTimeout(timeout);
                video.removeEventListener(
                  "webkitpresentationmodechanged",
                  check,
                );
                resolve();
              }
            };
            const timeout = window.setTimeout(() => {
              video.removeEventListener("webkitpresentationmodechanged", check);
              reject(new Error("PiP did not start"));
            }, 1500);
            video.addEventListener("webkitpresentationmodechanged", check);
          });
        }
      } else {
        throw new Error("PiP is unavailable for this stream");
      }
      if (request === pipRequestRef.current) setPipActive(true);
    } catch (error) {
      if (
        request === pipRequestRef.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        setCaptureError(
          `PiP: ${error instanceof Error ? error.message : "Failed"}`,
        );
      }
      if (request === pipRequestRef.current) restorePreview();
    } finally {
      if (request === pipRequestRef.current) {
        pipPreparingRef.current = false;
        setPipPreparing(false);
        if (
          document.pictureInPictureElement !== video &&
          video.webkitPresentationMode !== "picture-in-picture"
        )
          restorePreview();
      }
    }
  };

  const toggleVideoMute = () => {
    const nextMutedState = !isVideoMuted;
    setIsVideoMuted(nextMutedState);
    if (rtcTrackRef.current) {
      rtcTrackRef.current.enabled = !nextMutedState;
    }
  };

  return {
    stats: {
      streamId,
      connectionState,
      iceState,
      source,
      trackMuted,
      viewerStats,
      localCodec,
      captureSettings,
    },
    settings: {
      source,
      isSwitching,
      videoDevices,
      selectedDeviceId,
      setSelectedDeviceId,
      selectedResolution:
        source === "screen" ? screenResolution : selectedResolution,
      setSelectedResolution:
        source === "screen" ? setScreenResolution : setSelectedResolution,
      selectedRatio,
      setSelectedRatio,
      screenRotation,
      setScreenRotation,
      selectedFps: source === "screen" ? screenFps : selectedFps,
      setSelectedFps: source === "screen" ? setScreenFps : setSelectedFps,
      selectedDegradation,
      setSelectedDegradation,
    },
    controls: {
      source,
      isSwitching,
      screenSupported,
      pipSupported,
      previewReady: previewReady && !pipPreparing,
      pipActive,
      showLeftUI,
      showPreview,
      isVideoMuted,
      onCamera: () => {
        setCaptureMode("camera");
        setCameraRequest((n) => n + 1);
      },
      onScreenShare: startScreenShare,
      onPip: togglePip,
      onToggleUI: () => setShowLeftUI(!showLeftUI),
      onTogglePreview: () => setShowPreview(!showPreview),
      onToggleMute: toggleVideoMute,
    },
    videoRef,
    previewStyle,
    captureError,
  };
}
