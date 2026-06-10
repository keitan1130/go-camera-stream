import { useEffect, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<string>('初期化中...');
  const lastSentAtRef = useRef<number>(0);
  const encodingRef = useRef<boolean>(false);
  const sentFramesRef = useRef<number>(0);

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

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setStatus(`カメラ起動完了 [ID: ${streamId}]。フレーム送信待機中...`);
      } catch (err: any) {
        setStatus(`カメラ起動失敗: ${err.message}`);
      }
    }

    startCamera();

    const frameIntervalMs = 100;
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
        now - lastSentAtRef.current >= frameIntervalMs &&
        ws.bufferedAmount < 2 * 1024 * 1024
      ) {
        const ctx = canvas.getContext('2d');

        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
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
              sentFramesRef.current += 1;
              if (sentFramesRef.current === 1 || sentFramesRef.current % 30 === 0) {
                setStatus(`ストリーミング中 [ID: ${streamId}] 送信フレーム: ${sentFramesRef.current}`);
              }
            } else if (!blob) {
              setStatus('JPEG生成失敗: canvas.toBlob が空を返しました');
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
