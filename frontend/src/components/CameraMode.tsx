import { useEffect, useRef, useState } from 'react';
import { RESOLUTIONS, FPS_OPTIONS, ASPECT_RATIOS, rtcConfig } from '../constants';

export default function CameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const streamId = new URLSearchParams(window.location.search).get('id') || 'default';

  // UI表示とステータス用の状態
  const [showLeftUI, setShowLeftUI] = useState(true);
  const [showPreview, setShowPreview] = useState(true);
  const [connectionState, setConnectionState] = useState('new');
  const [iceState, setIceState] = useState('new');
  const [viewerStats, setViewerStats] = useState<any>(null);
  const [localCodec, setLocalCodec] = useState('---'); // 送信側コーデックの動的化

  // カメラデバイスと設定の状態
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[0]);
  const [selectedRatio, setSelectedRatio] = useState(ASPECT_RATIOS[0]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[0]);

  const streamRef = useRef<MediaStream | null>(null);

  // 計算された送信側の現在の理想的な横幅
  const currentWidth = Math.round((selectedResolution.height * selectedRatio.widthRatio) / selectedRatio.heightRatio);

  // 初回のみ実行：カメラ一覧の取得
  useEffect(() => {
    const getDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');

        setVideoDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.error("デバイス一覧の取得に失敗しました:", err);
      }
    };
    getDevices();
  }, []);

  // 送信側（Camera）自身のStatsを定期取得し、エンコード中のコーデックを動的に特定
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

  // WebRTCの接続構築とオファー送信
  const createPeerConnectionAndSendOffer = async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);

      // ★接続中（connected）以外のときは、受信側の数値をすべて「---」にするためStatsをクリア
      if (pc.connectionState !== 'connected') {
        setViewerStats(null);
      }
    };

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
    };

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        const sender = pc.addTrack(track, streamRef.current!);

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

  // WebSocketシグナリング接続
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
        // ★ピア接続が正常に確立しているときのみ受信データを受け入れる
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

  // カメラの起動と設定変更の反映
  useEffect(() => {
    async function updateCamera() {
      try {
        const videoConstraints: any = {
          width: { ideal: currentWidth },
          height: { ideal: selectedResolution.height },
          frameRate: { ideal: selectedFps }
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
          let sender = pcRef.current.getSenders().find(s => s.track?.kind === 'video');

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
  }, [selectedResolution, selectedFps, selectedDeviceId, selectedRatio]);

  return (
    <div className="app-container">
      {showLeftUI && (
        <div className="green-minimal-ui">
          {/* ★追加: streamIdの表記 */}
          <div>streamId: {streamId}</div>
          <div>connectionState: {connectionState}</div>
          <div>iceConnectionState: {iceState}</div>
          <div>currentRoundTripTime: {viewerStats?.currentRoundTripTime !== undefined ? `${(viewerStats.currentRoundTripTime * 1000).toFixed(1)}ms` : '---'}</div>
          <div>bytesReceived: {viewerStats?.bytesReceived || '---'}</div>
          <div>packetsLost: {viewerStats?.packetsLost || '0'}</div>
          <div>jitter: {viewerStats?.jitter !== undefined ? `${viewerStats.jitter.toFixed(4)}s` : '---'}</div>

          {/* ★表示の最適化: 送信縦横ピクセル / 受信縦横ピクセル */}
          <div>
            frameWidth / frameHeight: {currentWidth}x{selectedResolution.height} / {viewerStats?.frameWidth && viewerStats?.frameHeight ? `${viewerStats.frameWidth}x${viewerStats.frameHeight}` : '---'}
          </div>

          <div>
            framesPerSecond: {selectedFps} / {viewerStats?.framesPerSecond ? `${Math.round(viewerStats.framesPerSecond)}` : '---'} fps
          </div>

          <div>framesDropped: {viewerStats?.framesDropped || '0'}</div>

          {/* ★動的化: 送信側実測 / 受信側実測 */}
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
