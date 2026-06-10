import { useEffect, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState('初期化中...');
  const lastSentAtRef = useRef(0);
  const encodingRef = useRef(false);

  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);
    wsRef.current = ws;

    ws.onopen = () => setStatus(`接続完了 [ID: ${streamId}]`);
    ws.onerror = () => setStatus('接続エラー');
    ws.onclose = () => setStatus('切断されました');

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setStatus(`[ID: ${streamId}]`);
      } catch (err) {
        setStatus(`カメラ起動失敗: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    startCamera();

    let animationFrameId: number;
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
        now - lastSentAtRef.current >= 100 &&
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
          }, 'image/jpeg', 0.7);
        }
      }
      animationFrameId = requestAnimationFrame(sendFrame);
    };

    animationFrameId = requestAnimationFrame(sendFrame);

    return () => {
      cancelAnimationFrame(animationFrameId);
      ws.close();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="app-container">
      <div className="status-badge">{status}</div>
      <video ref={videoRef} autoPlay muted playsInline className="video-stream" />
      <canvas ref={canvasRef} className="hidden-canvas" />
    </div>
  );
}
