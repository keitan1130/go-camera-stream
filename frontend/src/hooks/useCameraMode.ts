import { useCallback, useEffect, useRef, useState } from 'react';
import { RESOLUTIONS, FPS_OPTIONS, ASPECT_RATIOS, rtcConfig, type WebRTCStats } from '../constants';

type SafariVideo = HTMLVideoElement & {
  webkitSupportsPresentationMode?: (mode: string) => boolean;
  webkitSetPresentationMode?: (mode: string) => void;
  webkitPresentationMode?: string;
};

export default function useCameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const streamId = new URLSearchParams(window.location.search).get('id') || 'default';

  const getSavedState = <T,>(key: string, defaultValue: T): T => {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      try { return JSON.parse(saved); } catch { return defaultValue; }
    }
    return defaultValue;
  };

  const [showLeftUI, setShowLeftUI] = useState(() => getSavedState('camera_showLeftUI', true));
  const [showPreview, setShowPreview] = useState(() => getSavedState('camera_showPreview', true));
  const [isVideoMuted, setIsVideoMuted] = useState(() => getSavedState('camera_isVideoMuted', false));

  const [source, setSource] = useState<'camera' | 'screen' | 'idle'>('idle');
  const [captureMode, setCaptureMode] = useState<'camera' | 'screen' | 'idle'>('camera');
  const [cameraRequest, setCameraRequest] = useState(0);
  const [isSwitching, setIsSwitching] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const [trackMuted, setTrackMuted] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const captureRequestRef = useRef(0);

  const screenSupported = typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  const [connectionState, setConnectionState] = useState('new');
  const [iceState, setIceState] = useState('new');
  const [viewerStats, setViewerStats] = useState<WebRTCStats | null>(null);
  const [localCodec, setLocalCodec] = useState('---');

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => getSavedState('camera_deviceId', ''));
  const [selectedResolution, setSelectedResolution] = useState(() => {
    const savedLabel = getSavedState('camera_resolution', RESOLUTIONS[0].label);
    return RESOLUTIONS.find(r => r.label === savedLabel) || RESOLUTIONS[0];
  });
  const [selectedRatio, setSelectedRatio] = useState(() => {
    const savedLabel = getSavedState('camera_ratio', ASPECT_RATIOS[0].label);
    return ASPECT_RATIOS.find(r => r.label === savedLabel) || ASPECT_RATIOS[0];
  });
  const [selectedFps, setSelectedFps] = useState(() => getSavedState('camera_fps', FPS_OPTIONS[0]));

  const [selectedDegradation, setSelectedDegradation] = useState<string>(() => getSavedState('camera_degradation', 'maintain-resolution'));
  const degradationRef = useRef(selectedDegradation);

  const isVideoMutedRef = useRef(isVideoMuted);
  useEffect(() => {
    isVideoMutedRef.current = isVideoMuted;
  }, [isVideoMuted]);

  const streamRef = useRef<MediaStream | null>(null);
  const rtcTrackRef = useRef<MediaStreamTrack | null>(null);

  const currentWidth = Math.round((selectedResolution.height * selectedRatio.widthRatio) / selectedRatio.heightRatio);

  useEffect(() => {
    localStorage.setItem('camera_showLeftUI', JSON.stringify(showLeftUI));
    localStorage.setItem('camera_showPreview', JSON.stringify(showPreview));
    localStorage.setItem('camera_isVideoMuted', JSON.stringify(isVideoMuted));
    localStorage.setItem('camera_deviceId', JSON.stringify(selectedDeviceId));
    localStorage.setItem('camera_resolution', JSON.stringify(selectedResolution.label));
    localStorage.setItem('camera_ratio', JSON.stringify(selectedRatio.label));
    localStorage.setItem('camera_fps', JSON.stringify(selectedFps));
    localStorage.setItem('camera_degradation', JSON.stringify(selectedDegradation));
  }, [showLeftUI, showPreview, isVideoMuted, selectedDeviceId, selectedResolution, selectedRatio, selectedFps, selectedDegradation]);

  useEffect(() => {
    degradationRef.current = selectedDegradation;
    if (pcRef.current) {
      const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        const params = sender.getParameters();
        params.degradationPreference = selectedDegradation as RTCDegradationPreference;
        sender.setParameters(params).catch(e => console.error("Degradation update failed:", e));
      }
    }
  }, [selectedDegradation]);

  useEffect(() => {
    const localStatsInterval = setInterval(async () => {
      if (pcRef.current && pcRef.current.connectionState === 'connected') {
        const stats = await pcRef.current.getStats();
        stats.forEach(report => {
          if (report.type === 'outbound-rtp' && report.kind === 'video' && report.codecId) {
            const codec = stats.get(report.codecId);
            if (codec) {
              setLocalCodec(codec.mimeType.replace('video/', ''));
            }
          }
        });
      } else {
        setLocalCodec('---');
      }
    }, 2000);

    return () => clearInterval(localStatsInterval);
  }, []);

  const createPeerConnectionAndSendOffer = useCallback(async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        setViewerStats(null);
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
    };

    if (rtcTrackRef.current && streamRef.current) {
      const sender = pc.addTrack(rtcTrackRef.current, streamRef.current);
      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }
      parameters.degradationPreference = degradationRef.current as RTCDegradationPreference;
      parameters.encodings[0].maxBitrate = 300 * 1000 * 1000;
      await sender.setParameters(parameters);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ role: 'camera', type: 'candidate', candidate: e.candidate }));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ role: 'camera', type: 'offer', sdp: offer }));
    }
  }, []);

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ role: 'camera', type: 'join' }));
      createPeerConnectionAndSendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'camera') return;

      if (msg.type === 'join' && msg.role === 'viewer') {
        createPeerConnectionAndSendOffer();
      } else if (msg.type === 'answer' && pcRef.current) {
        await pcRef.current.setRemoteDescription(msg.sdp);
      } else if (msg.type === 'candidate' && pcRef.current) {
        await pcRef.current.addIceCandidate(msg.candidate);
      } else if (msg.type === 'stats') {
        setViewerStats(msg.stats);
      }
    };

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, [streamId, createPeerConnectionAndSendOffer]);

  const installStream = useCallback(async (stream: MediaStream, request: number) => {
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended' || request !== captureRequestRef.current) {
      stream.getTracks().forEach(t => t.stop());
      return false;
    }

    const clonedTrack = track.clone();
    clonedTrack.enabled = !isVideoMutedRef.current;
    const previousStream = streamRef.current;
    const previousTrack = rtcTrackRef.current;
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video' || s.track === null);
    try {
      if (sender) await sender.replaceTrack(clonedTrack);
      if (request !== captureRequestRef.current || stream.getVideoTracks()[0]?.readyState === 'ended') {
        if (sender) await sender.replaceTrack(previousTrack);
        clonedTrack.stop();
        stream.getTracks().forEach(t => t.stop());
        return false;
      }
    } catch (error) {
      // A different capture size/codec can require renegotiation.
      if (!(error instanceof DOMException) || error.name !== 'InvalidModificationError') {
        clonedTrack.stop();
        stream.getTracks().forEach(t => t.stop());
        throw error;
      }
    }

    streamRef.current = stream;
    rtcTrackRef.current = clonedTrack;
    previousStream?.getTracks().forEach(t => t.stop());
    previousTrack?.stop();
    setTrackMuted(track.muted);
    track.onmute = () => setTrackMuted(true);
    track.onunmute = () => setTrackMuted(false);
    track.onended = () => {
      if (streamRef.current !== stream) return;
      clonedTrack.stop();
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      rtcTrackRef.current = null;
      setSource('idle');
      setCaptureMode('idle');
      setPreviewReady(false);
      setTrackMuted(false);
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      // Preview playback failure must not prevent transmission.
      void videoRef.current.play().catch(() => {});
    }
    if (pcRef.current && (!sender || sender.track !== clonedTrack)) {
      await createPeerConnectionAndSendOffer();
    }
    return true;
  }, [createPeerConnectionAndSendOffer]);

  useEffect(() => {
    if (captureMode !== 'camera') return;
    const request = ++captureRequestRef.current;
    let cancelled = false;
    async function updateCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: currentWidth, max: currentWidth },
            height: { ideal: selectedResolution.height, max: selectedResolution.height },
            frameRate: { ideal: selectedFps, max: selectedFps },
            ...(selectedDeviceId
              ? { deviceId: { exact: selectedDeviceId } }
              : { facingMode: { ideal: 'environment' } }),
          },
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        if (await installStream(stream, request)) {
          setSource('camera');
          setCaptureError('');
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!cancelled) setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
        }
      } catch (error) {
        if (!cancelled && request === captureRequestRef.current) {
          setCaptureError(`Camera: ${error instanceof Error ? error.message : 'Failed'}`);
        }
      }
    }
    void updateCamera();
    return () => { cancelled = true; };
  }, [captureMode, cameraRequest, selectedDeviceId, selectedResolution, selectedFps, currentWidth, installStream]);

  useEffect(() => () => {
    ++captureRequestRef.current;
    streamRef.current?.getTracks().forEach(t => t.stop());
    rtcTrackRef.current?.stop();
  }, []);

  const startScreenShare = async () => {
    if (!screenSupported || isSwitching) return;
    const request = ++captureRequestRef.current;
    setIsSwitching(true);
    setCaptureError('');
    try {
      // Keep this call directly in the click handler: browsers require user activation.
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: selectedFps, max: selectedFps } },
        audio: false,
      });
      if (await installStream(stream, request)) {
        setCaptureMode('screen');
        setSource('screen');
      }
    } catch (error) {
      if (request === captureRequestRef.current) {
        setCaptureError(`Screen: ${error instanceof Error ? error.message : 'Failed'}`);
      }
    } finally {
      if (request === captureRequestRef.current) setIsSwitching(false);
    }
  };

  useEffect(() => {
    const video = videoRef.current as SafariVideo | null;
    if (!video) return;
    const updatePip = () => {
      setPipSupported(Boolean(
        (document.pictureInPictureEnabled && video.requestPictureInPicture) ||
        video.webkitSupportsPresentationMode?.('picture-in-picture'),
      ));
      setPipActive(document.pictureInPictureElement === video ||
        video.webkitPresentationMode === 'picture-in-picture');
    };
    const onReady = () => { setPreviewReady(true); updatePip(); };
    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('enterpictureinpicture', updatePip);
    video.addEventListener('leavepictureinpicture', updatePip);
    video.addEventListener('webkitpresentationmodechanged', updatePip);
    return () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('enterpictureinpicture', updatePip);
      video.removeEventListener('leavepictureinpicture', updatePip);
      video.removeEventListener('webkitpresentationmodechanged', updatePip);
    };
  }, []);

  const togglePip = async () => {
    const video = videoRef.current as SafariVideo | null;
    if (!video) return;
    setCaptureError('');
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      } else if (video.webkitSupportsPresentationMode?.('picture-in-picture')) {
        video.webkitSetPresentationMode?.(video.webkitPresentationMode === 'picture-in-picture'
          ? 'inline' : 'picture-in-picture');
      }
    } catch (error) {
      setCaptureError(`PiP: ${error instanceof Error ? error.message : 'Failed'}`);
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
      streamId, connectionState, iceState, source, trackMuted, viewerStats,
      localCodec, currentWidth, selectedResolution, selectedFps,
    },
    settings: {
      source, isSwitching, videoDevices, selectedDeviceId, setSelectedDeviceId,
      selectedResolution, setSelectedResolution, selectedRatio, setSelectedRatio,
      selectedFps, setSelectedFps, selectedDegradation, setSelectedDegradation,
    },
    controls: {
      source, isSwitching, screenSupported, pipSupported, previewReady, pipActive,
      showLeftUI, showPreview, isVideoMuted,
      onCamera: () => { setCaptureMode('camera'); setCameraRequest(n => n + 1); },
      onScreenShare: startScreenShare,
      onPip: togglePip,
      onToggleUI: () => setShowLeftUI(!showLeftUI),
      onTogglePreview: () => setShowPreview(!showPreview),
      onToggleMute: toggleVideoMute,
    },
    videoRef,
    captureError,
  };
}
