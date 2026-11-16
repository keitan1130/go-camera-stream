import type { CameraStatsProps } from './types';

export default function CameraStats({
  streamId, connectionState, iceState, source, trackMuted, viewerStats,
  localCodec, currentWidth, selectedResolution, selectedFps,
}: CameraStatsProps) {
  const formatBitrate = (bps?: number) => {
    if (bps === undefined || isNaN(bps) || bps < 0) return '---';
    if (bps >= 1000000) return `${(bps / 1000000).toFixed(2)} Mbps`;
    if (bps >= 1000) return `${(bps / 1000).toFixed(0)} kbps`;
    return `${Math.round(bps)} bps`;
  };

  return (
    <>
      <div>Room ID: {streamId}</div>
      <div>connectionState: {connectionState}</div>
      <div>iceConnectionState: {iceState}</div>
      <div>source: {source}{trackMuted ? ' (paused)' : ''}</div>
      <div>ping: {viewerStats?.currentRoundTripTime !== undefined ? `${(viewerStats.currentRoundTripTime * 1000).toFixed(1)}ms` : '---'}</div>

      <div>bitrate: {formatBitrate(viewerStats?.bitrate)}</div>

      <div>packetsLost: {viewerStats?.packetsLost || '0'}</div>
      <div>jitter: {viewerStats?.jitter !== undefined ? `${viewerStats.jitter.toFixed(4)}s` : '---'}</div>

      <div>
        {currentWidth}x{selectedResolution.height} / {viewerStats?.frameWidth && viewerStats?.frameHeight ? `${viewerStats.frameWidth}x${viewerStats.frameHeight}` : '---'}
      </div>

      <div>
        {selectedFps} / {viewerStats?.framesPerSecond ? `${Math.round(viewerStats.framesPerSecond)}` : '---'} fps
      </div>

      <div>framesDropped: {viewerStats?.framesDropped || '0'}</div>

      <div>
        mimeType: {localCodec} / {viewerStats?.mimeType || '---'}
      </div>
    </>
  );
}
