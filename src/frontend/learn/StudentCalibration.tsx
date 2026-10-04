import { CalibrationFlow } from "../calibration/CalibrationFlow";

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

export function StudentCalibration({ onComplete, onCancel }: Props) {
  return <CalibrationFlow mode="learn" onComplete={onComplete} onCancel={onCancel} />;
}
