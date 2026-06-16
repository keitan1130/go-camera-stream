import { useEffect, useRef, useState } from 'react';
import { rtcConfig, type WebRTCStats } from '../constants';

export default function ViewerMode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const [connectionState, setConnectionState] = useState('new');

  const streamId = new URLSearchParams(window.location.search).get('id') || 'default';

  useEffect(() => {
    let statsInterval: ReturnType<typeof setInterval> | undefined;
    let lastBytesReceived = 0;
    let lastTimestamp = 0;

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws?id=${encodeURIComponent(streamId)}`);

    const createPeerConnection = () => {
      if (pcRef.current) pcRef.current.close();
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
      };

      pc.addTransceiver('video', { direction: 'recvonly' });

      pc.ontrack = (e) => {
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

      statsInterval = setInterval(async () => {
        if (pcRef.current && pcRef.current.connectionState === 'connected') {
          const stats = await pcRef.current.getStats();
          const statsData: WebRTCStats = {};

          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
              statsData.currentRoundTripTime = report.currentRoundTripTime;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
              statsData.bytesReceived = report.bytesReceived;

              const now = report.timestamp;
              if (lastBytesReceived > 0 && lastTimestamp > 0) {
                const deltaBytes = report.bytesReceived - lastBytesReceived;
                const deltaTime = (now - lastTimestamp) / 1000;
                if (deltaTime > 0) {
                  statsData.bitrate = (deltaBytes * 8) / deltaTime;
                }
              }
              lastBytesReceived = report.bytesReceived;
              lastTimestamp = now;

              statsData.packetsLost = report.packetsLost;
              statsData.jitter = report.jitter;
              statsData.frameWidth = report.frameWidth;
              statsData.frameHeight = report.frameHeight;
              statsData.framesPerSecond = report.framesPerSecond;
              statsData.framesDropped = report.framesDropped;

              if (report.codecId) {
                const codec = stats.get(report.codecId);
                if (codec) {
                  statsData.mimeType = codec.mimeType.replace('video/', '');
                }
              }
            }
          });

          ws.send(JSON.stringify({
            role: 'viewer',
            type: 'stats',
            stats: statsData
          }));
        }
      }, 2000);
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
      if (statsInterval) clearInterval(statsInterval);
      ws.close();
      pcRef.current?.close();
    };
  }, [streamId]);

  return (
    <div className="app-container" style={{ backgroundColor: 'transparent' }}>
      {connectionState !== 'connected' && (
        <div className="green-minimal-ui" style={{ pointerEvents: 'none' }}>
          <div>Stream: {streamId}</div>
          <div>disconnect</div>
        </div>
      )}

      <video ref={videoRef} autoPlay muted playsInline className="video-stream" />
    </div>
  );
}
