import { useRef } from "react";
import { useApp } from "../app/AppContext";
import type { InputSourceKind } from "../app/app.types";
import { DebugBus } from "../debug/DebugBus";
import { cameraManager } from "./CameraManager";
import { Icon } from "../components/Icon";
import { CameraControls } from "./CameraControls";
import { commitUpload } from "./uploadCommit";

/**
 * Camera and uploaded video are exclusive. Choosing upload turns the camera off
 * and shows a working file picker in this panel, not a hidden recording-step control.
 */
export function CaptureSourceControls() {
  const { state, inputSource, uploadFile, dispatch, goTo } = useApp();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inLearn = state.startsWith("LEARN_");

  const setSource = (source: InputSourceKind) => {
    if (source !== "live") cameraManager.releaseAll();
    dispatch({ type: "SET_INPUT_SOURCE", source });
  };

  const onFile = (file: File | null) => {
    dispatch({ type: "SET_UPLOAD_FILE", file });
    if (file) {
      cameraManager.releaseAll();
      dispatch({ type: "SET_INPUT_SOURCE", source: "upload" });
      DebugBus.emit({
        category: "MEDIA",
        event: "UPLOAD_FILE_SELECTED",
        data: { name: file.name, bytes: file.size, type: file.type },
      });
    }
  };

  const useVideo = () => {
    if (!uploadFile) return;
    DebugBus.emit({
      category: "MEDIA",
      event: "UPLOAD_FILE_ACCEPTED",
      data: { name: uploadFile.name, bytes: uploadFile.size },
    });
    if (commitUpload()) return;
    if (state === "HOME" || state === "LEARN_LIBRARY" || state === "LEARN_COMPLETE" || state === "TEACH_COMPLETE") {
      goTo("TEACH_CALIBRATION");
    }
  };

  const showCamera = inputSource === "live" || inLearn;
  const showUpload = inputSource === "upload" && !inLearn;

  return (
    <div className="capture-source side-card" data-testid="capture-source">
      <p className="side-kicker">Capture</p>
      <div className="source-switch" role="group" aria-label="Capture source">
        <button
          type="button"
          data-testid="source-camera"
          aria-pressed={inputSource === "live"}
          onClick={() => setSource("live")}
        >
          <Icon name="camera" />
          Camera
        </button>
        <button
          type="button"
          data-testid="source-upload"
          aria-pressed={inputSource === "upload"}
          onClick={() => setSource("upload")}
        >
          <Icon name="upload" />
          Upload
        </button>
        <button
          type="button"
          data-testid="source-fixture"
          aria-pressed={inputSource === "fixture"}
          onClick={() => setSource("fixture")}
        >
          <Icon name="fixture" />
          Fixture
        </button>
      </div>

      {showCamera ? <CameraControls /> : null}

      {showUpload ? (
        <div className="upload-picker">
          <input
            ref={fileRef}
            id="upload-video-input"
            type="file"
            accept="video/*"
            data-testid="upload-video-input"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <button type="button" className="secondary" onClick={() => fileRef.current?.click()}>
            {uploadFile ? "Change video" : "Choose video"}
          </button>
          {uploadFile ? (
            <>
              <p className="muted" data-testid="upload-video-name">
                {uploadFile.name}
              </p>
              <button type="button" className="primary" data-testid="upload-video-submit" onClick={useVideo}>
                Use this video
              </button>
            </>
          ) : (
            <p className="muted">MP4, WebM, or MOV.</p>
          )}
        </div>
      ) : null}

      {inputSource === "fixture" ? (
        <p className="muted">Recorded poses stand in for the camera.</p>
      ) : null}
    </div>
  );
}
