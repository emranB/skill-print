import type { InputSourceKind } from "../app/app.types";
import { useObjectUrl } from "../media/useObjectUrl";
import { VideoViewport } from "../components/VideoViewport";
import type { Demonstration, DemonstrationClassification } from "../pose/pose.types";
import { RecordingDownload } from "./RecordingDownload";

interface Props {
  demonstrations: Demonstration[];
  onClassify: (id: string, classification: DemonstrationClassification) => void;
  onAnalyze: () => void;
  onRerecord: () => void;
  analyzing?: boolean;
  analysisStage?: string | null;
  error?: string | null;
  source: InputSourceKind;
  video?: Blob | null;
  lessonName?: string;
}

const CLASSIFICATIONS: DemonstrationClassification[] = ["good", "bad", "fragment", "ignore"];

export function RecordingReview({
  demonstrations,
  onClassify,
  onAnalyze,
  onRerecord,
  analyzing,
  analysisStage,
  error,
  source,
  video,
  lessonName,
}: Props) {
  const videoUrl = useObjectUrl(video);
  const hasCycles = demonstrations.length > 0;

  return (
    <div className="recording-review flow-panel">
      <h2>{analyzing ? "Analyzing your teaching" : source === "fixture" ? "Review cycles" : "Review your recording"}</h2>
      {videoUrl ? (
        <div className="stage-stack">
          <VideoViewport srcObjectUrl={videoUrl} />
        </div>
      ) : null}
      {analyzing ? (
        <p className="analysis-stage" data-testid="analysis-stage" aria-live="polite">
          {analysisStage ?? "Analyzing..."}
        </p>
      ) : hasCycles ? (
        <ul className="cycle-list">
          {demonstrations.map((demo, index) => (
            <li key={demo.id}>
              <span>
                Cycle {index + 1}: {(demo.startMs / 1000).toFixed(1)}s to {(demo.endMs / 1000).toFixed(1)}s
              </span>
              <div className="cycle-classify">
                {CLASSIFICATIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={demo.classification === c ? "primary" : ""}
                    onClick={() => onClassify(demo.id, c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          Repetitions are found during analysis. SkillPrint then asks you about the moments it could not work out.
        </p>
      )}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="home-actions">
        <button type="button" className="secondary" disabled={analyzing} onClick={onRerecord}>
          {source === "upload" ? "Back" : "Re-record"}
        </button>
        <RecordingDownload video={video} baseName={lessonName} />
        <button type="button" className="primary" disabled={analyzing} onClick={onAnalyze}>
          {analyzing ? "Analyzing..." : "Analyze"}
        </button>
      </div>
    </div>
  );
}
