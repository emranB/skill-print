import { Icon } from "../components/Icon";
import { useCameraControls } from "./useCamera";

/** Turns capture on or off from any screen without restarting the app. */
export function CameraControls() {
  const { live, busy, error, turnOn, turnOff } = useCameraControls();

  return (
    <div className="camera-controls" data-testid="camera-controls">
      <p className={`cam-pill${live ? " on" : ""}`} data-testid="camera-status">
        {live ? "Camera on" : "Camera off"}
      </p>
      <div className="icon-toolbar" role="group" aria-label="Camera power">
        <button
          type="button"
          className="icon-button"
          data-testid="camera-on"
          aria-label="Camera on"
          disabled={busy || live}
          onClick={() => void turnOn()}
        >
          <Icon name="on" />
        </button>
        <button
          type="button"
          className="icon-button"
          data-testid="camera-off"
          aria-label="Camera off"
          disabled={busy || !live}
          onClick={turnOff}
        >
          <Icon name="off" />
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
