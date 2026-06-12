import { useEffect, useRef, useState } from 'react';
import { RESOLUTIONS, FPS_OPTIONS, rtcConfig } from '../constants';

export default function CameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const streamId = new URLSearchParams(window.location.search).get('id') || 'default';

  // 統合された分かりやすいステータス管理
  const [connectionPhase, setConnectionPhase] = useState(`オフライン`);
  const [camStatus, setCamStatus] = useState('待機中');

  // カメラデバイスと設定の状態
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[2]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[1]);
  const streamRef = useRef<MediaStream | null>(null);

  // 初回のみ実行：カメラ一覧の取得
  useEffect(() => {
    const getDevices = async () => {
      try {
        // iOS対策: 一度カメラのアクセス許可を得ないとラベル名が空になるため
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(device => device.kind === 'videoinput');

        setVideoDevices(videoInputs);
        // 最初から選択状態を作っておく
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.error("デバイス一覧の取得に失敗しました:", err);
      }
    };
    getDevices();
  }, []);

  // WebRTCの接続構築とオファー送信
  const createPeerConnectionAndSendOffer = async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    // P2Pの実際の接続状態を監視してUIに反映
    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connecting':
          setConnectionPhase('接続試行中');
          break;
        case 'connected':
          setConnectionPhase(`配信中 [ID: ${streamId}]`);
          break;
        case 'disconnected':
        case 'failed':
        case 'closed':
          setConnectionPhase(`スタンバイ [ID: ${streamId}]`);
          break;
      }
    };

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, streamRef.current!);
      });
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
      setConnectionPhase(`スタンバイ [ID: ${streamId}]`);
      ws.send(JSON.stringify({ role: 'camera', type: 'join' }));
      createPeerConnectionAndSendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'camera') return;

      if (msg.type === 'join' && msg.role === 'viewer') {
        setConnectionPhase('接続試行中');
        createPeerConnectionAndSendOffer();
      } else if (msg.type === 'answer' && pcRef.current) {
        await pcRef.current.setRemoteDescription(msg.sdp);
      } else if (msg.type === 'candidate' && pcRef.current) {
        await pcRef.current.addIceCandidate(msg.candidate);
      }
    };

    ws.onerror = () => setConnectionPhase('ネットワークエラー');
    ws.onclose = () => setConnectionPhase('ネットワーク切断');

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, [streamId]);

  // カメラの起動と設定変更の反映
  useEffect(() => {
    async function updateCamera() {
      setCamStatus('適用中');
      try {
        const videoConstraints: any = {
          width: { ideal: selectedResolution.width },
          height: { ideal: selectedResolution.height },
          frameRate: { ideal: selectedFps }
        };

        // デバイスIDが選択されていれば特定レンズを指定、なければ環境カメラにフォールバック
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
        setCamStatus('動作中');
      } catch (err) {
        setCamStatus('起動失敗');
        console.error("Camera Error:", err);
      }
    }
    updateCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [selectedResolution, selectedFps, selectedDeviceId]);

  return (
    <div className="app-container">
      <div className="header-controls">
        <div className="status-badge">
          <div>{connectionPhase}</div>
        </div>

        <div className="controls">
          <div className={`camera-status ${camStatus === '起動失敗' ? 'error' : ''}`}>
            {camStatus}
          </div>

          <label>
            <select
              className="device-select"
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              {videoDevices.length === 0 && <option value="">読込中</option>}
              {videoDevices.map(device => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `カメラ (${device.deviceId.substring(0, 4)})`}
                </option>
              ))}
            </select>
          </label>

          <label>
            <select
              value={selectedResolution.label}
              onChange={(e) => {
                const res = RESOLUTIONS.find(r => r.label === e.target.value);
                if (res) setSelectedResolution(res);
              }}
            >
              {RESOLUTIONS.map(res => <option key={res.label} value={res.label}>{res.label}</option>)}
            </select>
          </label>

          <label>
            <select
              value={selectedFps}
              onChange={(e) => setSelectedFps(Number(e.target.value))}
            >
              {FPS_OPTIONS.map(fps => <option key={fps} value={fps}>{fps} fps</option>)}
            </select>
          </label>
        </div>
      </div>
      <video ref={videoRef} autoPlay muted playsInline className="video-stream" />
    </div>
  );
}
