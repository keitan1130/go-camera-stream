import { useEffect, useRef, useState } from 'react';
import './App.css';

const RESOLUTIONS = [
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'QHD (2560x1440)', width: 2560, height: 1440 },
  { label: 'FHD (1920x1080)', width: 1920, height: 1080 },
  { label: 'HD (1280x720)', width: 1280, height: 720 },
  { label: 'VGA (640x480)', width: 640, height: 480 },
  { label: 'QVGA (320x240)', width: 320, height: 240 },
];
const FPS_OPTIONS = [60, 30, 24, 15, 10, 5];

const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

export default function App() {
  const isViewer = new URLSearchParams(window.location.search).get('mode') === 'viewer';
  return isViewer ? <ViewerMode /> : <CameraMode />;
}

// ==========================================
// カメラモード（iPhone側: 映像を送信する）
// ==========================================
function CameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [wsStatus, setWsStatus] = useState('通信: 初期化中');
  const [camStatus, setCamStatus] = useState('待機中');

  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[2]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[1]);
  const streamRef = useRef<MediaStream | null>(null);

  // WebRTC接続を新規作成し、視聴者へOfferを送信する関数
  const createPeerConnectionAndSendOffer = async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

    // 現在のカメラ映像トラックがあれば追加する
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

  // 1. WebSocketシグナリングサーバーへの接続
  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus(`通信: 接続完了 [ID: ${streamId}]`);
      // 部屋に「カメラが参加した」ことを知らせる
      ws.send(JSON.stringify({ role: 'camera', type: 'join' }));
      // 既に視聴者がいる場合を想定してOfferを送信する
      createPeerConnectionAndSendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'camera') return; // 自分自身のメッセージは無視

      if (msg.type === 'join' && msg.role === 'viewer') {
        // 視聴者が新しく参加(またはOBSリロード)した => 接続を作り直してOfferを送信
        console.log("視聴者の参加を検知しました。接続を再構築します。");
        createPeerConnectionAndSendOffer();
      } else if (msg.type === 'answer' && pcRef.current) {
        await pcRef.current.setRemoteDescription(msg.sdp);
      } else if (msg.type === 'candidate' && pcRef.current) {
        await pcRef.current.addIceCandidate(msg.candidate);
      }
    };

    ws.onerror = () => setWsStatus('通信: エラー');
    ws.onclose = () => setWsStatus('通信: 切断されました');

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, []);

  // 2. カメラの起動と設定変更処理
  useEffect(() => {
    async function updateCamera() {
      setCamStatus('適用中');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: selectedResolution.width },
            height: { ideal: selectedResolution.height },
            frameRate: { ideal: selectedFps }
          }
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // WebRTCの通信が確立済みなら、トラックだけを差し替える
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
  }, [selectedResolution, selectedFps]);

  return (
    <div className="app-container">
      <div className="header-controls">
        <div className="status-badge"><div>{wsStatus}</div></div>
        <div className="controls">
          <div className={`camera-status ${camStatus === '起動失敗' ? 'error' : ''}`}>
            {camStatus}
          </div>
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

// ==========================================
// 視聴モード（OBS / ブラウザ側: 映像を受信する）
// ==========================================
function ViewerMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);

    // カメラ側からOfferが来たときに接続を作る関数
    const createPeerConnection = () => {
      if (pcRef.current) pcRef.current.close();
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;

      // 受信専用として準備
      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (e) => {
        console.log("映像データを受信しました！");
        if (videoRef.current) {
          videoRef.current.srcObject = e.streams[0] || new MediaStream([e.track]);
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ role: 'viewer', type: 'candidate', candidate: e.candidate }));
        }
      };
      return pc;
    };

    ws.onopen = () => {
      // 部屋に「視聴者が参加した」ことを知らせ、カメラからのOfferを待つ
      ws.send(JSON.stringify({ role: 'viewer', type: 'join' }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'viewer') return;

      if (msg.type === 'offer') {
        // カメラからOfferが届いた => PCを作り、Answerを返す
        const pc = createPeerConnection();
        await pc.setRemoteDescription(msg.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ role: 'viewer', type: 'answer', sdp: answer }));
      } else if (msg.type === 'candidate' && pcRef.current) {
        await pcRef.current.addIceCandidate(msg.candidate);
      }
    };

    return () => {
      ws.close();
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="app-container" style={{ backgroundColor: 'transparent' }}>
      <video ref={videoRef} autoPlay muted playsInline className="video-stream" />
    </div>
  );
}
