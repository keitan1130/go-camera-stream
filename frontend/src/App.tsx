import { useEffect, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>('初期化中...');
  const lastSentAtRef = useRef<number>(0);
  const encodingRef = useRef<boolean>(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const streamId = urlParams.get('id') || 'default';

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus(`接続完了 [ID: ${streamId}]。カメラを起動します...`);
    ws.onerror = () => setStatus('接続エラー');
    ws.onclose = (event) => {
      setStatus(`切断されました [code: ${event.code}, reason: ${event.reason || 'none'}]`);
    };

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setStatus(`ストリーミング中 [ID: ${streamId}]...`);
      } catch (err: any) {
        setStatus(`カメラ起動失敗: ${err.message}`);
      }
    }

    startCamera();

    const frameIntervalMs = 100;
    let animationFrameId: number;
    const sendFrame = (now: number) => {
      if (
        videoRef.current &&
        canvasRef.current &&
        wsRef.current?.readyState === WebSocket.OPEN &&
        videoRef.current.readyState === videoRef.current.HAVE_CURRENT_DATA &&
        !encodingRef.current &&
        now - lastSentAtRef.current >= frameIntervalMs &&
        wsRef.current.bufferedAmount < 2 * 1024 * 1024
      ) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        if (ctx) {
          lastSentAtRef.current = now;
          encodingRef.current = true;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            encodingRef.current = false;
            if (blob && wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(blob);
            }
          }, 'image/jpeg', 0.7);
        }
      }
      animationFrameId = requestAnimationFrame(sendFrame);
    };

    animationFrameId = requestAnimationFrame(sendFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
      ws.close();
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  return (
    <div className="app-container">
      <div className="status-badge">
        {status}
      </div>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="video-stream"
      />
      <canvas
        ref={canvasRef}
        className="hidden-canvas"
      />
    </div>
  );
}
