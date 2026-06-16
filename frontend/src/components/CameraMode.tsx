import { useEffect, useRef, useState } from 'react';
import { RESOLUTIONS, FPS_OPTIONS, ASPECT_RATIOS, rtcConfig, type WebRTCStats } from '../constants';

export default function CameraMode() {
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

  const streamRef = useRef<MediaStream | null>(null);

  const currentWidth = Math.round((selectedResolution.height * selectedRatio.widthRatio) / selectedRatio.heightRatio);

  useEffect(() => {
    localStorage.setItem('camera_showLeftUI', JSON.stringify(showLeftUI));
    localStorage.setItem('camera_showPreview', JSON.stringify(showPreview));
    localStorage.setItem('camera_deviceId', JSON.stringify(selectedDeviceId));
    localStorage.setItem('camera_resolution', JSON.stringify(selectedResolution.label));
    localStorage.setItem('camera_ratio', JSON.stringify(selectedRatio.label));
    localStorage.setItem('camera_fps', JSON.stringify(selectedFps));
  }, [showLeftUI, showPreview, selectedDeviceId, selectedResolution, selectedRatio, selectedFps]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');

        setVideoDevices(videoInputs);
        setSelectedDeviceId(prev => prev ? prev : (videoInputs.length > 0 ? videoInputs[0].deviceId : ''));
      } catch (err) {
        console.error("デバイス一覧の取得に失敗しました:", err);
      }
    };
    getDevices();
  }, []);

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

  const createPeerConnectionAndSendOffer = async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState !== 'connected') {
        setViewerStats(null);
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
    };

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        const sender = pc.addTrack(track, streamRef.current);

        if (track.kind === 'video') {
          const parameters = sender.getParameters();
          if (!parameters.encodings) {
            parameters.encodings = [{}];
          }
          parameters.degradationPreference = 'maintain-resolution';
          parameters.encodings[0].maxBitrate = 5000 * 1000;
          await sender.setParameters(parameters);
        }
      }
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
  };

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
        if (pcRef.current && pcRef.current.connectionState === 'connected') {
          setViewerStats(msg.stats);
        }
      }
    };

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, [streamId]);

  useEffect(() => {
    async function updateCamera() {
      try {
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: currentWidth, max: currentWidth },
          height: { ideal: selectedResolution.height, max: selectedResolution.height },
          frameRate: { ideal: selectedFps, max: selectedFps }
        };

        if (selectedDeviceId) {
          videoConstraints.deviceId = { exact: selectedDeviceId };
        } else {
          videoConstraints.facingMode = { ideal: 'environment' };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraints
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const newVideoTrack = stream.getVideoTracks()[0];
        if (pcRef.current && newVideoTrack) {
          const sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');

          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          } else {
            pcRef.current.addTrack(newVideoTrack, stream);
          }
        }
      } catch (err) {
        console.error("Camera Error:", err);
      }
    }
    updateCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedResolution, selectedFps, selectedDeviceId, selectedRatio, currentWidth]);

  const formatBitrate = (bps?: number) => {
    if (bps === undefined || isNaN(bps)) return '---';
    if (bps >= 1000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
    if (bps >= 1000) return `${(bps / 1000).toFixed(0)} Kbps`;
    return `${Math.round(bps)} bps`;
  };

  return (
    <div className="app-container">
      {showLeftUI && (
        <div className="green-minimal-ui">
          <div>streamId: {streamId}</div>
          <div>connectionState: {connectionState}</div>
          <div>iceConnectionState: {iceState}</div>
          <div>currentRoundTripTime: {viewerStats?.currentRoundTripTime !== undefined ? `${(viewerStats.currentRoundTripTime * 1000).toFixed(1)}ms` : '---'}</div>

          <div>bitrate: {formatBitrate(viewerStats?.bitrate)}</div>

          <div>packetsLost: {viewerStats?.packetsLost || '0'}</div>
          <div>jitter: {viewerStats?.jitter !== undefined ? `${viewerStats.jitter.toFixed(4)}s` : '---'}</div>

          <div>
            frameWidth / frameHeight: {currentWidth}x{selectedResolution.height} / {viewerStats?.frameWidth && viewerStats?.frameHeight ? `${viewerStats.frameWidth}x${viewerStats.frameHeight}` : '---'}
          </div>

          <div>
            framesPerSecond: {selectedFps} / {viewerStats?.framesPerSecond ? `${Math.round(viewerStats.framesPerSecond)}` : '---'} fps
          </div>

          <div>framesDropped: {viewerStats?.framesDropped || '0'}</div>

          <div>
            mimeType: {localCodec} / {viewerStats?.mimeType || '---'}
          </div>

          <div className="interactive-item">
            <span>&gt; Camera: </span>
            <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
              {videoDevices.length === 0 && <option value="">Loading...</option>}
              {videoDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera (${device.deviceId.substring(0, 4)})`}
                </option>
              ))}
            </select>
          </div>

          <div className="interactive-item">
            <span>&gt; Resolution: </span>
            <select
              value={selectedResolution.label}
              onChange={(e) => {
                const res = RESOLUTIONS.find(r => r.label === e.target.value);
                if (res) setSelectedResolution(res);
              }}
            >
              {RESOLUTIONS.map(res => <option key={res.label} value={res.label}>{res.label}</option>)}
            </select>
          </div>

          <div className="interactive-item">
            <span>&gt; AspectRatio: </span>
            <select
              value={selectedRatio.label}
              onChange={(e) => {
                const ratio = ASPECT_RATIOS.find(r => r.label === e.target.value);
                if (ratio) setSelectedRatio(ratio);
              }}
            >
              {ASPECT_RATIOS.map(ratio => <option key={ratio.label} value={ratio.label}>{ratio.label}</option>)}
            </select>
          </div>

          <div className="interactive-item">
            <span>&gt; FPS: </span>
            <select value={selectedFps} onChange={(e) => setSelectedFps(Number(e.target.value))}>
              {FPS_OPTIONS.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="right-control-panel">
        <button onClick={() => setShowLeftUI(!showLeftUI)}>
          {showLeftUI ? 'Hide UI' : 'Show UI'}
        </button>
        <button onClick={() => setShowPreview(!showPreview)}>
          {showPreview ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="video-stream"
        style={{ display: showPreview ? 'block' : 'none' }}
      />
    </div>
  );
}
