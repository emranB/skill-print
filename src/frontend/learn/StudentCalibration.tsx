import { CalibrationFlow } from "../calibration/CalibrationFlow";

interface Props {
  legacy?: boolean;
  representation?: string;
  onComplete: () => void;
  onCancel: () => void;
}

export function StudentCalibration({ onComplete, onCancel, legacy, representation }: Props) {
  return <CalibrationFlow mode="learn" legacy={legacy} representation={representation} onComplete={onComplete} onCancel={onCancel} />;
}
