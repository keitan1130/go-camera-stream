import { useEffect, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [status, setStatus] = useState<string>('初期化中...');

  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus('接続完了。カメラを起動します...');
    ws.onerror = () => setStatus('接続エラー');
    ws.onclose = () => setStatus('切断されました');

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        // iOS(Safari)とPC(Chrome等)の両方で動くようにフォーマットを自動選択
        let mimeType = 'video/webm; codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/mp4'; // iOS Safari用のフォールバック
        }

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;

        // エンコーダが動画の破片（チャンク）を作るたびにWebSocketで送信
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        };

        // 100ミリ秒（0.1秒）ごとに動画を切り取って送信し続ける
        recorder.start(100);
        setStatus(`ストリーミング中 (${mimeType})...`);

      } catch (err: any) {
        setStatus(`カメラ起動失敗: ${err.message}`);
      }
    }

    startCamera();

    return () => {
      ws.close();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
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
    </div>
  );
}
