import { useEffect, useRef, useState } from 'react';
import './App.css';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [status, setStatus] = useState<string>('初期化中...');

  useEffect(() => {
    // 1. ブラウザのURLから "?id=xxx" の値を取得する
    const urlParams = new URLSearchParams(window.location.search);
    const streamId = urlParams.get('id') || 'default'; // 指定がなければ default

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 2. WebSocketの接続先URLの末尾にパラメータを付与
    const wsUrl = `${wsProtocol}//${window.location.host}/ws?id=${streamId}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus(`接続完了 [ID: ${streamId}]。カメラを起動します...`);
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

        let mimeType = 'video/webm; codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/mp4';
        }

        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(event.data);
          }
        };

        recorder.start(100);
        setStatus(`ストリーミング中 [ID: ${streamId}] (${mimeType})`);

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
