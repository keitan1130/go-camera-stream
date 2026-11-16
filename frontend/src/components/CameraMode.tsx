import useCameraMode from "../hooks/useCameraMode";
import CameraControls from "./camera/CameraControls";
import CameraSettings from "./camera/CameraSettings";
import CameraStats from "./camera/CameraStats";

export default function CameraMode() {
  const { stats, settings, controls, videoRef, previewStyle, captureError } =
    useCameraMode();

  return (
    <div className="app-container">
      {controls.showLeftUI && (
        <div className="green-minimal-ui">
          <CameraStats {...stats} />
          <CameraSettings {...settings} />
        </div>
      )}

      <CameraControls {...controls} />

      {captureError && (
        <div className="capture-error" role="alert">
          {captureError}
        </div>
      )}

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className="video-stream"
        style={{
          ...previewStyle,
          display:
            controls.showPreview || controls.pipActive ? "block" : "none",
          opacity: controls.showPreview ? 1 : 0,
        }}
      />
    </div>
  );
}
