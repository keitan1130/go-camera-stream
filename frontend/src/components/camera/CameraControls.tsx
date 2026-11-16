import type { CameraControlsProps } from './types';

export default function CameraControls({
  source, isSwitching, screenSupported, pipSupported, previewReady, pipActive,
  showLeftUI, showPreview, isVideoMuted, onCamera, onScreenShare, onPip,
  onToggleUI, onTogglePreview, onToggleMute,
}: CameraControlsProps) {
  return (
    <div className="right-control-panel">
      <button
        disabled={isSwitching || (source === 'camera' && !screenSupported)}
        onClick={source === 'camera' ? onScreenShare : onCamera}
      >
        {isSwitching ? 'Selecting…' : source === 'camera' ? 'Share Screen' : 'Camera'}
      </button>
      <button disabled={!pipSupported || !previewReady || source === 'idle'} onClick={onPip}>
        {pipActive ? 'Exit PiP' : 'PiP'}
      </button>
      <button onClick={onToggleUI}>
        {showLeftUI ? 'Hide UI' : 'Show UI'}
      </button>
      <button onClick={onTogglePreview}>
        {showPreview ? 'Hide Preview' : 'Show Preview'}
      </button>
      <button onClick={onToggleMute} className={isVideoMuted ? 'is-muted' : 'is-active'}>
        {isVideoMuted ? 'Unmute Video' : 'Mute Video'}
      </button>
    </div>
  );
}
