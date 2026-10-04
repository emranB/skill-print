interface Props {
  recording: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  startLabel?: string;
}

export function RecordingControls({ recording, onStart, onStop, disabled, startLabel = "Start recording" }: Props) {
  return (
    <div className="recording-controls">
      {!recording ? (
        <button type="button" className="primary" disabled={disabled} onClick={onStart}>
          {startLabel}
        </button>
      ) : (
        <button type="button" className="primary" onClick={onStop}>
          Stop recording
        </button>
      )}
    </div>
  );
}
