import { useCallback, useEffect, useState } from "react";
import { cameraErrorMessage, cameraManager, isSupersededError } from "./CameraManager";

export function useCameraStream(): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(() => cameraManager.getStream());

  useEffect(() => {
    const sync = () => setStream(cameraManager.getStream());
    sync();
    return cameraManager.subscribe(sync);
  }, []);

  return stream;
}

export function useCameraControls() {
  const stream = useCameraStream();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = cameraManager.isVideoLive();

  const turnOn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cameraManager.ensure({ video: true, audio: false });
      cameraManager.setKeepOpen(true);
    } catch (caught) {
      if (!isSupersededError(caught)) setError(cameraErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const turnOff = useCallback(() => {
    cameraManager.releaseAll();
    setError(null);
  }, []);

  return { stream, live, busy, error, turnOn, turnOff };
}
