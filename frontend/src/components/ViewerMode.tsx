import { useEffect, useRef } from 'react';
import { rtcConfig } from '../constants';

export default function ViewerMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    const streamId = new URLSearchParams(window.location.search).get('id') || 'default';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);

    const createPeerConnection = () => {
      if (pcRef.current) pcRef.current.close();
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;

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
      ws.send(JSON.stringify({ role: 'viewer', type: 'join' }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.role === 'viewer') return;

      if (msg.type === 'offer') {
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
