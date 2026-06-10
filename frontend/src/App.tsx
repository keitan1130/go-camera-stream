import { useEffect, useRef, useState } from 'react';
import './App.css';

const RESOLUTIONS = [
  { label: '4K (3840x2160)', width: 3840, height: 2160 },
  { label: 'FHD (1920x1080)', width: 1920, height: 1080 },
  { label: 'HD (1280x720)', width: 1280, height: 720 },
  { label: 'VGA (640x480)', width: 640, height: 480 },
  { label: 'QVGA (320x240)', width: 320, height: 240 },
];

const FPS_OPTIONS = [30, 24, 15, 10, 5, 1];

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [status, setStatus] = useState('初期化中...');

  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[1]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[1]);

  const lastSentAtRef = useRef(0);
  const encodingRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus(`接続完了 [ID: ${streamId}]`);
    ws.onerror = () => setStatus('接続エラー');
    ws.onclose = () => setStatus('切断されました');

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    async function startCamera() {
      // 既存のストリームがあれば停止
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

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

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setStatus(`カメラ起動失敗: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [selectedResolution, selectedFps]); // 設定が変更されたら再実行

  // フレーム送信ループ
  useEffect(() => {
    let animationFrameId: number;
    const sendIntervalMs = 1000 / selectedFps; // FPSから送信間隔を計算

    const sendFrame = (now: number) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ws = wsRef.current;

      if (
        video &&
        canvas &&
        ws?.readyState === WebSocket.OPEN &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        !encodingRef.current &&
        now - lastSentAtRef.current >= sendIntervalMs && // 計算した間隔で送信
        ws.bufferedAmount < 2 * 1024 * 1024
      ) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          lastSentAtRef.current = now;
          encodingRef.current = true;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            encodingRef.current = false;
            if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(blob);
            }
          }, 'image/jpeg', 0.7); // 画質も必要に応じて調整可能
        }
      }
      animationFrameId = requestAnimationFrame(sendFrame);
    };

    animationFrameId = requestAnimationFrame(sendFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [selectedFps]); // FPSが変わったらループを再設定

  return (
    <div className="app-container">
      <div className="header-controls">
        <div className="status-badge">{status}</div>

        <div className="controls">
          <label>
            解像度:
            <select
              value={selectedResolution.label}
              onChange={(e) => {
                const res = RESOLUTIONS.find(r => r.label === e.target.value);
                if (res) setSelectedResolution(res);
              }}
            >
              {RESOLUTIONS.map(res => (
                <option key={res.label} value={res.label}>{res.label}</option>
              ))}
            </select>
          </label>

          <label>
            FPS:
            <select
              value={selectedFps}
              onChange={(e) => setSelectedFps(Number(e.target.value))}
            >
              {FPS_OPTIONS.map(fps => (
                <option key={fps} value={fps}>{fps} fps</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <video ref={videoRef} autoPlay muted playsInline className="video-stream" />
      <canvas ref={canvasRef} className="hidden-canvas" />
    </div>
  );
}
