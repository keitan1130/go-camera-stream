import { useEffect, useRef, useState } from 'react';
import { RESOLUTIONS, FPS_OPTIONS, rtcConfig } from '../constants';

export default function CameraMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [wsStatus, setWsStatus] = useState('通信: 初期化中');
  const [camStatus, setCamStatus] = useState('待機中');

  const [selectedResolution, setSelectedResolution] = useState(RESOLUTIONS[2]);
  const [selectedFps, setSelectedFps] = useState(FPS_OPTIONS[1]);
  const streamRef = useRef<MediaStream | null>(null);

  const createPeerConnectionAndSendOffer = async () => {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(rtcConfig);
    pcRef.current = pc;

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

  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus(`通信: 接続完了 [ID: ${streamId}]`);
      ws.send(JSON.stringify({ role: 'camera', type: 'join' }));
      createPeerConnectionAndSendOffer();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'camera') return;

      if (msg.type === 'join' && msg.role === 'viewer') {
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
