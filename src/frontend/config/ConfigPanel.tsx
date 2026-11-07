import { RuntimeConfigManager } from "./RuntimeConfig";
import { useApp } from "../app/AppContext";

export function ConfigPanel() {
  const { config, setConfig } = useApp();

  if (!config.debug.enabled) return null;

  const leniency = config.pose.leniency.toFixed(2);

  return (
    <details className="config-panel tune">
      <summary>
        <span className="side-kicker">Tuning</span>
        <span className="tune-meta">
          {leniency}, {config.pose.sampleFps} fps
        </span>
      </summary>
      <div className="tune-body">
        <label className="tune-row">
          <span className="tune-label">Match Difficulty Level<strong>{config.pose.matchDifficulty}</strong></span>
          <span className="tune-hint">Controls how closely SkillPrint follows each stage of the learned movement.</span>
          <input type="range" min={1} max={100} step={1} value={config.pose.matchDifficulty}
            onChange={(e) => setConfig(RuntimeConfigManager.update({ pose: { ...config.pose, matchDifficulty: Number(e.target.value) } }))} />
        </label>
        <label className="tune-row">
          <span className="tune-label">
            Legacy leniency
            <strong>{leniency}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={config.pose.leniency}
            aria-valuetext={leniency}
            onChange={(e) =>
              setConfig(
                RuntimeConfigManager.update({
                  pose: { ...config.pose, leniency: Number(e.target.value) },
                }),
              )
            }
          />
          <span className="tune-hint">Legacy 2D tolerance. Articulated lessons use fixed tolerance 0.25.</span>
        </label>
        <label className="tune-row">
          <span className="tune-label">
            Sample rate
            <strong>{config.pose.sampleFps} fps</strong>
          </span>
          <input
            type="number"
            min={5}
            max={30}
            value={config.pose.sampleFps}
            onChange={(e) =>
              setConfig(
                RuntimeConfigManager.update({
                  pose: { ...config.pose, sampleFps: Number(e.target.value) },
                }),
              )
            }
          />
          <span className="tune-hint">How often the camera pose is read. 5 to 30.</span>
        </label>
        <button type="button" className="text-button" onClick={() => setConfig(RuntimeConfigManager.resetOverrides())}>
          Reset to defaults
        </button>
      </div>
    </details>
  );
}
